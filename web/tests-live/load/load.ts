/**
 * Load through the gate, two measurements:
 *
 * 1. steps: closed loop, N concurrent buyer agents (1, 2, 4, ... by default), each running the open-interface purchase
 *    flow back to back for a fixed time per step. Per step: orders decided per minute, latency per call type, errors
 *    by status, gate refusals by rule, the server's memory and CPU. With --fresh-port the harness starts a fresh
 *    server for every step (its own, on that port), so every step starts from an empty store and the steps compare
 *    concurrency alone; without it the steps run against --url and the store grows from step to step.
 * 2. growth (--growth N): two buyers (one per organisation; --buyers for more) closed loop until N orders are decided
 *    on one fresh server, reporting throughput and latency per window of --window orders: how the gate slows as the
 *    store fills.
 *
 *   cd web
 *   pnpm exec tsx tests-live/load/load.ts --fresh-port 4652 [--steps 1,2,4,8,16,32,64] [--step-seconds 60]
 *   pnpm exec tsx tests-live/load/load.ts --fresh-port 4652 --growth 8000 --window 500
 *   pnpm exec tsx tests-live/load/load.ts --url http://localhost:4650 --pid <node pid>      (a server you started)
 *
 * The knee: the last step before throughput stops rising (< 10 % more than the step before) or a call's p95 passes 1 s.
 * Results are merged into --out (default tests-live/results/load-<date>.json) under "steps" or "growth" (or --section).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Recorder, arg, loadAvg, loadDemoKeys, machine, makeBuyers, pickKind, procStats, runFlow, sleep, startServer, stopServer, summarise, MIX, type Buyer, type OrgName } from "./lib";

loadDemoKeys();
const freshPort = arg("fresh-port") ? Number(arg("fresh-port")) : undefined;
const steps = (arg("steps", "1,2,4,8,16,32,64") ?? "").split(",").map(Number).filter((n) => n > 0);
const stepSeconds = Number(arg("step-seconds", "60"));
const growth = arg("growth") ? Number(arg("growth")) : undefined;
const windowSize = Number(arg("window", "500"));
const growthBuyers = Number(arg("buyers", "2"));
const orgs = (arg("orgs", "laakso,kaari") ?? "").split(",") as OrgName[];
const tag = arg("tag", Date.now().toString(36))!;
const section = arg("section");
const out = arg("out", path.join("tests-live", "results", `load-${new Date().toISOString().slice(0, 10)}.json`))!;

type Server = { url: string; pid?: number; owned: boolean };

async function server(): Promise<Server> {
  if (freshPort) {
    const pid = startServer(freshPort, "nolimits");
    return { url: `http://localhost:${freshPort}`, pid, owned: true };
  }
  return { url: arg("url", "http://localhost:4650")!, pid: arg("pid") ? Number(arg("pid")) : undefined, owned: false };
}

async function checkSeed(url: string) {
  const health = await fetch(new URL("/api/health", url)).then((r) => r.json());
  if (health?.catalog?.source !== "seed") throw new Error(`refusing to load a server that is not on the seed catalogue (catalog: ${JSON.stringify(health?.catalog)})`);
  return health;
}

function merge(section: string, value: unknown) {
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  const next = { kind: "dock-load/1", ...prev, updatedAt: new Date().toISOString(), machine: machine(), [section]: value };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(next, null, 2));
}

type StepRow = { concurrency: number; decisionsPerMin: number; latencyMs: Record<string, { p95: number | null }> };
const worstP95 = (r: StepRow) => Math.max(...["request", "availability", "quote", "order"].map((t) => r.latencyMs[t].p95 ?? 0));

async function runSteps() {
  console.log(`steps ${steps.join(",")} x ${stepSeconds}s, ${freshPort ? `fresh server per step on ${freshPort}` : "one server"}, mix ${MIX.map(([k, w]) => `${k} ${w * 100}%`).join(", ")}`);
  const buyers = await makeBuyers(Math.max(...steps), tag, orgs);
  const results: (StepRow & Record<string, unknown>)[] = [];
  let shared: Server | undefined;
  let ordersSoFar = 0;
  let version: unknown;
  for (const c of steps) {
    const srv = freshPort ? await server() : (shared ??= await server());
    version = (await checkSeed(srv.url)).version;
    if (freshPort) ordersSoFar = 0;
    await sleep(1000);
    const rec = new Recorder();
    const before = { proc: procStats(srv.pid), loadAvg: loadAvg() };
    const t0 = performance.now();
    const deadline = t0 + stepSeconds * 1000;
    // Closed loop: each buyer starts its next purchase when the last one is decided.
    await Promise.all(
      buyers.slice(0, c).map(async (b) => {
        while (performance.now() < deadline) await runFlow(rec, srv.url, b, pickKind());
      }),
    );
    const seconds = (performance.now() - t0) / 1000;
    const s = summarise(rec, seconds);
    ordersSoFar += s.decided;
    const after = { proc: procStats(srv.pid), loadAvg: loadAvg() };
    results.push({ concurrency: c, ...s, ordersInStoreAfter: ordersSoFar, server: { pid: srv.pid, before: before.proc, after: after.proc }, loadAvg: { before: before.loadAvg, after: after.loadAvg } });
    const L = s.latencyMs;
    console.log(
      `c=${String(c).padStart(3)}  ${String(s.decisionsPerMin).padStart(7)} decided/min (${s.committedPerMin} committed, ${s.pendingPerMin} to sign-off, ${s.rejectedPerMin} refused)  ` +
        `p50/p95 ms: quote ${L.quote.p50}/${L.quote.p95} order ${L.order.p50}/${L.order.p95} avail ${L.availability.p95} req ${L.request.p95} flow ${L.flow.p95}  ` +
        `errors ${s.errors.total}  store ${ordersSoFar}  rss ${after.proc.rssMb} MB  cpu ${after.proc.cpuPct}%  load ${after.loadAvg[0]}`,
    );
    if (srv.owned) await stopServer(srv.pid!);
    await sleep(2000);
  }
  let knee = results[0];
  for (let i = 1; i < results.length; i++) {
    if (worstP95(results[i]) > 1000 || results[i].decisionsPerMin < results[i - 1].decisionsPerMin * 1.1) break;
    knee = results[i];
  }
  const peak = results.reduce((a, b) => (b.decisionsPerMin > a.decisionsPerMin ? b : a));
  merge(section ?? "steps", {
    at: new Date().toISOString(),
    version,
    settings: { steps, stepSeconds, freshServerPerStep: !!freshPort, mix: Object.fromEntries(MIX), buyers: `${orgs.join(" / ")} alternating; one agent id per buyer; mandates minted with the demo keys (lib.ts makeBuyer)` },
    knee: { concurrency: knee.concurrency, decisionsPerMin: knee.decisionsPerMin, worstCallP95Ms: worstP95(knee), latencyMs: knee.latencyMs, rule: "last step before throughput gains < 10 % or any call's p95 > 1000 ms" },
    peak: { concurrency: peak.concurrency, decisionsPerMin: peak.decisionsPerMin },
    results,
  });
  console.log(`knee: c=${knee.concurrency}, ${knee.decisionsPerMin} decided/min, worst call p95 ${worstP95(knee)} ms; peak c=${peak.concurrency} ${peak.decisionsPerMin}/min. Wrote ${out}`);
}

async function runGrowth(target: number) {
  const srv = await server();
  const health = await checkSeed(srv.url);
  const buyers: Buyer[] = await makeBuyers(growthBuyers, tag, orgs);
  console.log(`growth: ${target} orders on ${srv.url} (pid ${srv.pid}), ${growthBuyers} buyers closed loop, windows of ${windowSize}`);
  const windows: unknown[] = [];
  let total = 0;
  const t00 = performance.now();
  while (total < target) {
    const rec = new Recorder();
    const t0 = performance.now();
    await Promise.all(
      buyers.map(async (b) => {
        while (rec.orders.length < windowSize) await runFlow(rec, srv.url, b, pickKind());
      }),
    );
    const s = summarise(rec, (performance.now() - t0) / 1000);
    total += s.decided;
    const proc = procStats(srv.pid);
    windows.push({ ordersInStoreAfter: total, elapsedS: Math.round((performance.now() - t00) / 1000), decisionsPerMin: s.decisionsPerMin, latencyMs: s.latencyMs, errors: s.errors, other4xx: s.other4xx, unexpectedOutcomes: s.unexpectedOutcomes, server: proc, loadAvg: loadAvg() });
    merge(section ?? "growth", { at: new Date().toISOString(), version: health.version, settings: { target, windowSize, buyers: growthBuyers, mix: Object.fromEntries(MIX) }, complete: total >= target, windows });
    console.log(`store ${String(total).padStart(6)}  ${String(s.decisionsPerMin).padStart(7)} decided/min  p50/p95 ms quote ${s.latencyMs.quote.p50}/${s.latencyMs.quote.p95} order ${s.latencyMs.order.p50}/${s.latencyMs.order.p95}  errors ${s.errors.total}  rss ${proc.rssMb} MB  cpu ${proc.cpuPct}%  load ${loadAvg()[0]}`);
  }
  if (srv.owned) await stopServer(srv.pid!);
}

(growth ? runGrowth(growth) : runSteps()).catch((err) => {
  console.error(err);
  process.exit(1);
});
