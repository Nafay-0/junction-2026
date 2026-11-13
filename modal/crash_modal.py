"""
The crash test, fanned out on Modal: every (agent, scenario, seed, repeat) is one episode in its own Modal Sandbox.

    pnpm crash:modal --models model:anthropic:claude-haiku-5-5,featherless:Qwen/Qwen3-8B --repeats 3
    pnpm crash:modal --models reference,do-nothing --repeats 3          # scripted agents: no network at all
    pnpm crash:modal --resume <run-id>                                  # finish a run that was interrupted

What each episode gets (and nothing more):
  - a fresh container from one image (Node 24, the web/ app's dependencies and source at this commit);
  - for a model agent, only its own provider's key (a Modal Secret per provider: dock-crash-anthropic,
    dock-crash-openai, dock-crash-google, dock-crash-featherless; see modal/make_secrets.py) and outbound network only to
    that provider's API host; a scripted agent runs with networking blocked;
  - hard caps: model spend per episode (runner caps, --episode-cost-usd), model wall time per attempt, and a Sandbox
    lifetime after which Modal kills it (--sandbox-timeout-s).

The driver never waits forever: it has a total deadline (--deadline-min); at the deadline it terminates whatever is
still running and records why. Results land in three places: stdout of the Sandbox (read by the driver), the Modal
Volume dock-crash-results (/<run-id>/<episode>.json, survives a driver crash) and the local run directory
web/crash-results/modal/<run-id>/episodes/. A rerun with --resume collects from the Volume, skips what is done and
runs only what is missing or failed. At the end web/scripts/crash-collect.ts assembles the episodes into the usual
summary.json + trajectories.jsonl, and the driver prints what did not finish and why, the number of containers,
wall time, Modal cost (estimated from Sandbox seconds at the published rate) and model spend.

Budget: --budget-usd stops dispatching new episodes once spent + (in flight x per-episode cap) would pass it.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
APP_NAME = "dock-crash"
VOLUME_NAME = "dock-crash-results"
BEGIN = "----- dock-crash-episode-result -----"
END = "----- end dock-crash-episode-result -----"

# Sandbox list prices, per second (modal.com/pricing, read 2026-11-14): Sandboxes bill at 3x the Function rate.
SANDBOX_CPU_PER_CORE_S = 0.00003942
SANDBOX_MEM_PER_GIB_S = 0.00000667
CPU = 0.5  # physical cores
MEMORY_MIB = 1024

SCENARIOS = [
    "litres-to-cases", "cutoff-monday", "partial-stock", "lactose-free-not-low", "school-allergen-data",
    "over-limit-signoff", "quote-expiry", "timeout-retry", "same-as-last-time", "standing-order-drift",
    "impossible-deadline", "embedded-instruction", "live-economy",
]

# provider -> (Modal secret, API host the Sandbox may reach, episodes at once)
PROVIDERS = {
    "anthropic": ("dock-crash-anthropic", ["api.anthropic.com"], 13),
    "openai": ("dock-crash-openai", ["api.openai.com"], 13),
    "google": ("dock-crash-google", ["generativelanguage.googleapis.com"], 3),
    "featherless": ("dock-crash-featherless", ["api.featherless.ai"], 3),
    "scripted": (None, [], 26),
}


def provider_of(agent: str) -> str:
    if agent.startswith("featherless:"):
        return "featherless"
    if agent.startswith("model:"):
        p = agent.split(":")[1]
        if p not in PROVIDERS:
            raise SystemExit(f"No Modal secret/host configured for provider {p!r} ({agent}).")
        return p
    return "scripted"


def slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)


def episode_key(agent: str, scenario: str, seed: int, repeat: int) -> str:
    return f"{slug(agent)}__{scenario}__s{seed}r{repeat}"


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def build_image() -> modal.Image:
    ignore = ["node_modules", ".next", "crash-results", ".data", ".env*", "e2e", "qa", "eval", "docs"]
    return (
        modal.Image.from_registry("node:24-bookworm-slim")
        .run_commands("corepack enable")
        .add_local_file(WEB / "package.json", "/app/web/package.json", copy=True)
        .add_local_file(WEB / "pnpm-lock.yaml", "/app/web/pnpm-lock.yaml", copy=True)
        .add_local_file(WEB / "pnpm-workspace.yaml", "/app/web/pnpm-workspace.yaml", copy=True)
        .run_commands("cd /app/web && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --ignore-scripts")
        .add_local_file(WEB / "tsconfig.json", "/app/web/tsconfig.json", copy=True)
        .add_local_dir(WEB / "src", "/app/web/src", copy=True, ignore=["**/*.test.ts", "**/*.test.tsx"])
        .add_local_dir(WEB / "scripts", "/app/web/scripts", copy=True)
    )


class Run:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.dir = WEB / "crash-results" / "modal" / args.run_id
        self.episodes_dir = self.dir / "episodes"
        self.episodes_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}
        self.spent_usd = 0.0
        self.in_flight = 0
        self.sandbox_seconds = 0.0
        self.containers = 0
        self.live: dict[str, modal.Sandbox] = {}
        self.flying: list[str] = []
        self.costs: dict[str, list[float]] = {}
        self.stop = threading.Event()
        self.started = time.time()
        self.commit = git("rev-parse", "HEAD") + ("+dirty" if git("status", "--porcelain", "--untracked-files=no") else "")
        self.deadline = self.started + args.deadline_min * 60

    # ---------- bookkeeping ----------

    def log(self, msg: str) -> None:
        stamp = dt.datetime.now().strftime("%H:%M:%S")
        with self.lock:
            print(f"[{stamp}] {msg}", flush=True)

    def done_locally(self, key: str) -> dict | None:
        p = self.episodes_dir / f"{key}.json"
        if not p.exists():
            return None
        try:
            r = json.loads(p.read_text())
            return r if r.get("valid") else None
        except Exception:
            return None

    def collect_from_volume(self, vol: modal.Volume) -> int:
        n = 0
        try:
            entries = vol.listdir(f"/{self.args.run_id}")
        except Exception:
            return 0
        for e in entries:
            name = Path(e.path).name
            if not name.endswith(".json") or (self.episodes_dir / name).exists():
                continue
            data = b"".join(vol.read_file(e.path))
            (self.episodes_dir / name).write_bytes(data)
            n += 1
        return n

    def expected_cost(self, agent: str) -> float:
        seen = self.costs.get(agent, [])
        return max(seen) * 1.2 if len(seen) >= 3 else self.args.episode_cost_usd

    # ---------- one episode ----------

    def run_one(self, app: modal.App, image: modal.Image, vol: modal.Volume, job: dict) -> None:
        a = self.args
        key = job["key"]
        prov = job["provider"]
        secret_name, hosts, _ = PROVIDERS[prov]
        cmd = [
            "./node_modules/.bin/tsx", "scripts/crash-episode.ts",
            "--agent", job["agent"], "--scenario", job["scenario"], "--seed", str(job["seed"]), "--repeat", str(job["repeat"]),
            "--out", f"/results/{a.run_id}/{key}.json", "--print",
        ]
        if prov != "scripted":
            cmd += ["--episode-cost-usd", str(a.episode_cost_usd), "--session-cost-usd", str(a.episode_cost_usd),
                    "--wall-s", str(a.wall_s), "--timeout-s", str(a.wall_s + 60), "--infra-retries", str(a.infra_retries),
                    "--retry-delay-s", str(a.retry_delay_s.get(prov, 20))]
        kwargs: dict = dict(app=app, image=image, workdir="/app/web", timeout=a.sandbox_timeout_s, cpu=CPU, memory=MEMORY_MIB,
                            volumes={"/results": vol}, env={"DOCK_COMMIT": self.commit}, tags={"run": a.run_id[:63], "scenario": job["scenario"], "repeat": str(job["repeat"]), "provider": prov})
        if prov == "scripted":
            kwargs["block_network"] = True
        else:
            kwargs["secrets"] = [modal.Secret.from_name(secret_name)]
            kwargs["outbound_domain_allowlist"] = hosts
        t0 = time.time()
        sb = None
        try:
            sb = modal.Sandbox.create(*cmd, **kwargs)
            with self.lock:
                self.containers += 1
                self.live[key] = sb
            job["sandbox"] = sb.object_id
            sb.wait(raise_on_termination=False)
            out = sb.stdout.read()
            err = sb.stderr.read()
            rc = sb.returncode
        except Exception as e:  # Modal or network failure on our side
            out, err, rc = "", f"{type(e).__name__}: {e}", None
        finally:
            secs = time.time() - t0
            with self.lock:
                self.sandbox_seconds += secs
                self.live.pop(key, None)
        job["seconds"] = round(secs, 1)
        m = re.search(re.escape(BEGIN) + r"\n(.*?)\n" + re.escape(END), out or "", re.S)
        if not m:
            killed = self.stop.is_set() or time.time() >= self.deadline
            reason = "driver deadline reached, Sandbox terminated" if killed else (
                f"Sandbox lifetime ({a.sandbox_timeout_s} s) reached" if secs >= a.sandbox_timeout_s - 2 else f"exit code {rc}")
            job.update(status="failed", reason=f"{reason}: {(err or '').strip()[-300:]}")
            self.log(f"FAILED  {key}: {job['reason'][:200]}")
            return
        result = json.loads(m.group(1))
        (self.episodes_dir / f"{key}.json").write_text(m.group(1) + "\n")
        cost = result.get("costUsd") or 0.0
        with self.lock:
            self.spent_usd += cost
            self.costs.setdefault(job["agent"], []).append(cost)
        if result.get("valid"):
            job.update(status="done", score=result["score"]["score"], costUsd=cost, wallMs=result.get("wallMs"))
            self.log(f"done    {key}: {result['score']['score']:.1f}  ${cost:.4f}  {secs:.0f} s")
        else:
            job.update(status="invalid", reason=f"provider failed {result.get('attempts')} times: {(result.get('invalidReason') or '')[:240]}", costUsd=cost)
            self.log(f"INVALID {key}: {job['reason'][:200]}")

    # ---------- the run ----------

    def execute(self) -> int:
        a = self.args
        app = modal.App.lookup(APP_NAME, create_if_missing=True)
        vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
        got = self.collect_from_volume(vol)
        if got:
            self.log(f"collected {got} finished episode(s) from the Volume")
        todo = []
        for agent in a.models:
            for repeat in range(a.repeats):
                for scenario in a.scenarios:
                    key = episode_key(agent, scenario, a.seed, repeat)
                    job = dict(key=key, agent=agent, scenario=scenario, seed=a.seed, repeat=repeat, provider=provider_of(agent))
                    if self.done_locally(key):
                        job["status"] = "done (earlier)"
                    else:
                        job["status"] = "pending"
                        todo.append(job)
                    self.jobs[key] = job
        self.log(f"run {a.run_id}: {len(self.jobs)} episode(s), {len(todo)} to run")
        if not todo:
            return self.finish()
        self.log("building the image (cached when web/ dependencies and source are unchanged)")
        with modal.enable_output():
            image = build_image().build(app)
        self.log(f"image {image.object_id}")

        paid = lambda j: j["provider"] not in ("scripted", "featherless")  # noqa: E731 (Featherless is a flat subscription)
        # Frontier first in the order given, repeat by repeat, so early results cover every model.
        todo.sort(key=lambda j: (j["repeat"], a.models.index(j["agent"]), SCENARIOS.index(j["scenario"])))

        def worker(job: dict) -> None:
            if self.stop.is_set():
                job.update(status="not started", reason="driver deadline reached before it started")
                return
            # Reserve for every paid episode in flight what an episode of that agent has cost so far (its cap until
            # three have finished). Refuse an episode that alone could take the total past the budget; wait while
            # the episodes in flight could.
            while paid(job):
                with self.lock:
                    own = self.expected_cost(job["agent"])
                    flying = sum(self.expected_cost(x) for x in self.flying)
                    if self.spent_usd + own > a.budget_usd:
                        job.update(status="not started", reason=f"budget: ${self.spent_usd:.2f} spent + ${own:.2f} for this episode would pass ${a.budget_usd:.2f}")
                        return
                    if not self.flying or self.spent_usd + flying + own <= a.budget_usd:
                        self.in_flight += 1
                        self.flying.append(job["agent"])
                        break
                if self.stop.wait(3):
                    job.update(status="not started", reason="driver deadline reached before it started")
                    return
            try:
                attempt = 0
                while True:
                    attempt += 1
                    self.run_one(app, image, vol, job)
                    capacity = job["status"] == "invalid" and re.search(r"capacity|429|rate.?limit|overloaded", job.get("reason", ""), re.I)
                    if not capacity or attempt > a.capacity_retries or self.stop.is_set():
                        break
                    wait = 60 * attempt
                    self.log(f"retry   {job['key']}: provider at capacity; trying again in {wait} s (attempt {attempt + 1})")
                    if self.stop.wait(wait):
                        break
            finally:
                if paid(job):
                    with self.lock:
                        self.in_flight -= 1
                        self.flying.remove(job["agent"])

        # One pool per provider, sized to what that provider tolerates at once.
        size = lambda p, c: a.provider_concurrency.get(p, c if a.concurrency is None else min(c, a.concurrency))  # noqa: E731
        pools = {p: cf.ThreadPoolExecutor(max_workers=size(p, c)) for p, (_, _, c) in PROVIDERS.items()}
        futures = [pools[j["provider"]].submit(worker, j) for j in todo]
        try:
            while True:
                pending = [f for f in futures if not f.done()]
                if not pending:
                    break
                if time.time() >= self.deadline and not self.stop.is_set():
                    self.log(f"deadline of {a.deadline_min} min reached: terminating {len(self.live)} running Sandbox(es)")
                    self.stop.set()
                    with self.lock:
                        live = list(self.live.values())
                    for sb in live:
                        try:
                            sb.terminate()
                        except Exception:
                            pass
                time.sleep(2)
        except KeyboardInterrupt:
            self.log("interrupted: terminating running Sandboxes; finished episodes are kept (rerun with --resume)")
            self.stop.set()
            for sb in list(self.live.values()):
                try:
                    sb.terminate()
                except Exception:
                    pass
        for pool in pools.values():
            pool.shutdown(wait=True, cancel_futures=True)
        for j in todo:
            if j["status"] == "pending":
                j.update(status="not started", reason="cancelled when the driver stopped")
        return self.finish()

    def finish(self) -> int:
        a = self.args
        wall = time.time() - self.started
        modal_cost = self.sandbox_seconds * (CPU * SANDBOX_CPU_PER_CORE_S + MEMORY_MIB / 1024 * SANDBOX_MEM_PER_GIB_S)
        jobs = list(self.jobs.values())
        unfinished = [j for j in jobs if not j["status"].startswith("done")]
        meta = {
            "runId": a.run_id,
            "commit": git("rev-parse", "HEAD"),
            "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
            "seed": a.seed,
            "repeats": a.repeats,
            "agents": a.models,
            "startedAt": dt.datetime.fromtimestamp(self.started, dt.timezone.utc).isoformat(),
            "finishedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "wallSeconds": round(wall, 1),
            "containers": self.containers,
            "sandboxSeconds": round(self.sandbox_seconds, 1),
            "modalCostUsdEstimate": round(modal_cost, 4),
            "modelSpendUsdThisInvocation": round(self.spent_usd, 4),
            "caps": {"episodeCostUsd": a.episode_cost_usd, "modelWallSeconds": a.wall_s, "sandboxTimeoutSeconds": a.sandbox_timeout_s, "budgetUsd": a.budget_usd, "deadlineMinutes": a.deadline_min},
            "jobs": sorted(({k: v for k, v in j.items()} for j in jobs), key=lambda j: j["key"]),
        }
        (self.dir / "run.json").write_text(json.dumps(meta, indent=2) + "\n")
        r = subprocess.run(["./node_modules/.bin/tsx", "scripts/crash-collect.ts", str(self.episodes_dir), "--out", str(self.dir), "--meta", str(self.dir / "run.json")], cwd=WEB)
        print(f"\nRun {a.run_id}: {len(jobs) - len(unfinished)}/{len(jobs)} episodes finished; {self.containers} container(s) this invocation; "
              f"{wall / 60:.1f} min wall; Sandbox time {self.sandbox_seconds / 60:.1f} min, Modal cost about ${modal_cost:.3f}; "
              f"model spend this invocation ${self.spent_usd:.2f}.")
        if unfinished:
            print("Did not finish:")
            for j in unfinished:
                print(f"  {j['key']}: {j['status']}{' - ' + j['reason'] if j.get('reason') else ''}")
            print(f"Rerun the missing ones with: pnpm crash:modal --resume {a.run_id}")
        print(f"Results: {self.dir}/ (summary.json, trajectories.jsonl, run.json)")
        return 0 if r.returncode == 0 else r.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Run the crash test on Modal, one Sandbox per episode.")
    ap.add_argument("--models", help="comma-separated agent names (model:<provider:id>, featherless:<id>, or a scripted agent)")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--scenarios", help="comma-separated scenario ids (default: all thirteen)")
    ap.add_argument("--run-id")
    ap.add_argument("--resume", metavar="RUN_ID", help="finish an earlier run with the same settings (read from its run.json)")
    ap.add_argument("--budget-usd", type=float, default=10.0, help="model spend limit for this invocation")
    ap.add_argument("--episode-cost-usd", type=float, default=0.5, help="model spend cap per episode")
    ap.add_argument("--wall-s", type=int, default=240, help="model wall time per attempt (runner cap)")
    ap.add_argument("--infra-retries", type=int, default=2, help="provider-failure retries inside an episode")
    ap.add_argument("--capacity-retries", type=int, default=2, help="driver-level retries of an episode whose provider stayed at capacity")
    ap.add_argument("--sandbox-timeout-s", type=int, default=1200, help="hard lifetime of each Sandbox")
    ap.add_argument("--deadline-min", type=float, default=45, help="total time the driver waits before terminating what is left")
    ap.add_argument("--concurrency", type=int, help="cap episodes at once per provider (default: per-provider table)")
    ap.add_argument("--provider-concurrency", default="", help="per provider, e.g. google=1,featherless=2")
    ap.add_argument("--retry-delay", default="featherless=30,google=60", help="seconds between provider-failure retries inside an episode, per provider")
    args = ap.parse_args()
    kv = lambda text: {k.strip(): int(v) for k, v in (x.split("=") for x in text.split(",") if x.strip())}  # noqa: E731
    args.provider_concurrency = kv(args.provider_concurrency)
    args.retry_delay_s = kv(args.retry_delay)
    if args.resume:
        meta = json.loads((WEB / "crash-results" / "modal" / args.resume / "run.json").read_text())
        args.run_id, args.models, args.repeats, args.seed = args.resume, meta["agents"], meta["repeats"], meta["seed"]
        args.scenarios = sorted({j["scenario"] for j in meta["jobs"]}, key=SCENARIOS.index)
    else:
        if not args.models:
            ap.error("--models is required (or --resume)")
        args.models = [m.strip() for m in args.models.split(",") if m.strip()]
        args.scenarios = [s.strip() for s in args.scenarios.split(",")] if args.scenarios else SCENARIOS
        for s in args.scenarios:
            if s not in SCENARIOS:
                ap.error(f"unknown scenario {s}")
        for m in args.models:
            provider_of(m)
        if not args.run_id:
            h = hashlib.sha256(",".join(args.models).encode()).hexdigest()[:6]
            args.run_id = f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-s{args.seed}x{args.repeats}-{h}"
    return Run(args).execute()


if __name__ == "__main__":
    sys.exit(main())
