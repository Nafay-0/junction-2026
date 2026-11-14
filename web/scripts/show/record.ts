/**
 * Capture the presenter's fallbacks from a running server: the real system, through the same routes the screens
 * use. Writes src/server/show/recordings/<kind>.json (committed, so a fresh deploy has fallbacks from the start).
 *
 *   pnpm exec tsx scripts/show/record.ts --url http://localhost:3317            all three acts
 *   pnpm exec tsx scripts/show/record.ts --url https://<site> --only week       the newest finished, signed week
 *
 * week     the newest finished week on that server whose Thursday was signed (play one first: /present/table,
 *          or /present and W, with the approver's phone), saved as it played
 * attacks  every attack, run live now against the newest kitchen that has a passkey
 * outside  the outside agent, sent in live now (one run: a few cents of model spend)
 *
 * The operations passcode is read from DOCK_OPS_PASSCODE (.env.local) and never printed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "../lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const base = (args[args.indexOf("--url") + 1] ?? "http://localhost:3000").replace(/\/$/, "");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const OUT = path.join(process.cwd(), "src", "server", "show", "recordings");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let cookie = "";
async function call(method: "GET" | "POST", p: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

async function save(kind: string) {
  const r = await call("GET", `/ui-api/show/recordings/${kind}`);
  if (r.status !== 200) throw new Error(`${kind}: ${r.body.error?.message ?? r.status}`);
  const { where: _where, ...rec } = r.body.recording as Json;
  void _where;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, `${kind}.json`), JSON.stringify(rec));
  console.log(`${kind}: ${rec.frames.length} frames, captured ${rec.capturedAt} (${rec.source})`);
}

async function main() {
  const enter = await call("POST", "/ops-api/session", { passcode: process.env.DOCK_OPS_PASSCODE || undefined, name: "Recorder" });
  if (enter.status !== 200) throw new Error(`Could not enter the operations side: ${enter.body.error?.message ?? enter.status}`);

  if (!only || only === "week") {
    const weeks = (await call("GET", "/ui-api/show/week")).body.weeks as Json[];
    const good = weeks.find((w) => w.state === "finished" && w.steps.find((s: Json) => s.kind === "lastminute")?.signOff?.state === "approved");
    if (!good) throw new Error("No finished week with a signed Thursday on that server yet: play one first.");
    const kept = await call("POST", `/ui-api/show/week/${good.runId}/record`);
    if (kept.status !== 200) throw new Error(kept.body.error?.message);
    await save("week");
  }

  if (!only || only === "attacks") {
    const kitchens = (await call("GET", "/ui-api/show/kitchens")).body.kitchens as Json[];
    const k = kitchens.find((x) => x.passkey && !x.house);
    for (const id of ["tenfold", "forged_mandate", "replay", "self_approve", "split", "relayed_yes", "suspend", "resume"]) {
      const r = await call("POST", "/ui-api/show/attack", { id, sandboxId: k?.sandboxId });
      console.log(`  ${id}: ${r.body.result?.how ?? r.body.error?.message} ${r.body.result?.rule ?? ""}`);
    }
    await save("attacks");
  }

  if (!only || only === "outside") {
    const started = await call("POST", "/ui-api/show/outside", { runner: "builtin" });
    if (started.status !== 201) throw new Error(started.body.error?.message);
    let run = started.body.run as Json;
    for (let v = -1; run.state === "running"; ) {
      run = (await call("GET", `/ui-api/show/outside/${run.runId}?after=${v}`)).body.run;
      v = run.version;
    }
    console.log(`  outside: ${run.state}, ${run.outcome}, $${run.costUsd ?? "?"}`);
    if (run.state === "done") await save("outside");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
