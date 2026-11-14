/**
 * The crowd test's sign-off path over HTTP, no browser: N visitors arrive over ~5 s behind A venue addresses
 * (X-Forwarded-For), each joins with a software passkey (the same assertion a phone makes), asks every 5 s what
 * waits as /approver does, taps "ask my agent", and signs the request with the passkey. Separates the server's own
 * time from a loaded laptop's browsers (e2e/room/crowd.spec.ts drives Chromium).
 *
 *   pnpm exec tsx tests-live/crowd-http.ts --url http://localhost:4722 --visitors 60 --addresses 1 [--idle 30]
 *
 * Against a server with the public limits on (the crowd test's second server, or start-server.mjs with
 * E2E_SERVER_ENV='{"DOCK_RATE_LIMITS":"on"}'). Prints completed, refusals by rule, and join / sign-off times.
 */
import { Http, isVisitor, joinAsVisitor, passkeyDecide } from "./deps/lib/http";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const base = arg("url", "http://localhost:4722");
const visitors = Number(arg("visitors", "60"));
const addresses = Number(arg("addresses", "1"));
const idleMs = Number(arg("idle", "30")) * 1000;

type V = { i: number; ok: boolean; step: string; joinMs?: number; signMs?: number; error?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function visitor(i: number, gate: Promise<void>): Promise<{ v: V; log: Http["log"] }> {
  const http = new Http(base, { "x-forwarded-for": `198.51.100.${(i % addresses) + 1}` }, undefined, 60_000);
  const v: V = { i, ok: false, step: "join" };
  const t0 = Date.now();
  const me = await joinAsVisitor(http);
  if (!isVisitor(me)) return { v: { ...v, error: me.error }, log: http.log };
  v.joinMs = Date.now() - t0;
  v.step = "waiting";
  let polling = true;
  const poll = (async () => {
    while (polling) {
      await me.http.get("/api/v1/approver");
      await sleep(5_000);
    }
  })();
  await gate;
  v.step = "order";
  const t1 = Date.now();
  const o = await me.http.post("/api/v1/approver/demo-order", {});
  // The phone learns of the request from its stream or its next look at /approver; ask once right away.
  const approvalId = o.body?.order?.approval?.approvalId ?? (await me.http.get("/api/v1/approver")).body?.pending?.[0]?.approvalId;
  if (!approvalId) {
    polling = false;
    await poll;
    return { v: { ...v, error: `demo-order ${o.status} ${o.body?.error?.code ?? o.error ?? o.body?.order?.status}` }, log: http.log };
  }
  v.step = "sign";
  await me.http.get(`/api/v1/approvals/${approvalId}`);
  const d = await passkeyDecide(me, approvalId, "approve");
  polling = false;
  await poll;
  if (d.body?.order?.status !== "committed") return { v: { ...v, error: `sign ${d.status} ${d.body?.error?.code ?? d.error ?? d.body?.order?.status}` }, log: http.log };
  v.signMs = Date.now() - t1;
  return { v: { ...v, ok: true, step: "done" }, log: http.log };
}

async function main() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runs = Array.from({ length: visitors }, (_, i) => sleep((i * 5000) / visitors).then(() => visitor(i, gate)));
  setTimeout(release, 8000 + idleMs);
  const out = await Promise.all(runs);
  const vs = out.map((o) => o.v);
  const refusals: Record<string, number> = {};
  for (const o of out) for (const c of o.log) if (c.status === 429) refusals[`${c.path} ${c.code}`] = (refusals[`${c.path} ${c.code}`] ?? 0) + 1;
  const med = (xs: (number | undefined)[]) => {
    const s = xs.filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const max = (xs: (number | undefined)[]) => Math.max(0, ...xs.filter((x): x is number => x !== undefined));
  const summary = {
    visitors,
    addresses,
    completed: vs.filter((v) => v.ok).length,
    refusals,
    joinMsMedian: med(vs.map((v) => v.joinMs)),
    joinMsMax: max(vs.map((v) => v.joinMs)),
    signMsMedian: med(vs.map((v) => v.signMs)),
    signMsMax: max(vs.map((v) => v.signMs)),
    // Server time per call kind (median / max ms), ids folded.
    callsMs: Object.fromEntries(
      Object.entries(
        out.flatMap((o) => o.log).reduce<Record<string, number[]>>((a, c) => {
          const k = `${c.method} ${c.path.replace(/(apr|ord|sbx)_[a-z0-9]+/gi, "$1_x")}`;
          (a[k] ??= []).push(c.ms);
          return a;
        }, {}),
      ).map(([k, ms]) => [k, `${med(ms)} / ${max(ms)}`]),
    ),
    failures: vs.filter((v) => !v.ok).map((v) => `#${v.i} at ${v.step}: ${v.error}`).slice(0, 10),
  };
  console.log(JSON.stringify(summary));
}

void main();
