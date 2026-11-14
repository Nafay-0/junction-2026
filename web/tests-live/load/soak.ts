/* eslint-disable @typescript-eslint/no-explicit-any -- load harness: reads untyped JSON replies. */
/**
 * Soak: an open-loop stream of purchases at a fixed rate for a fixed time, then the checks that matter afterwards.
 *
 *   cd web
 *   pnpm exec tsx tests-live/load/soak.ts --fresh-port 4653 --rate 300 [--minutes 10]
 *   pnpm exec tsx tests-live/load/soak.ts --fresh-port 4653 --knee-share 0.7      (rate = 70 % of the knee in --out)
 *   pnpm exec tsx tests-live/load/soak.ts --url http://localhost:4650 --pid <node pid> --rate 300
 *
 * Every 10 s: the server's RSS and CPU (ps on its PID), /api/health and /ui-api/wall response times, orders decided in
 * the last 10 s, purchases in flight, and the order/quote p95 of that window. One client holds the public event stream
 * (/api/v1/events) open the whole time and counts events and their delay.
 * Afterwards: the ledger read by each organisation's agent (verification.ok; every order placed present exactly once
 * as a decision, once as its commit or sign-off request; no request with two decisions), a sample of orders read
 * back, and the wall's response time. Results merged into --out under "soak" (or --section).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Recorder, arg, http, latency, loadAvg, loadDemoKeys, machine, makeBuyers, pct, pickKind, procStats, runFlow, sleep, startServer, stopServer, summarise, MIX, type Buyer, type OrgName } from "./lib";

loadDemoKeys();
const freshPort = arg("fresh-port") ? Number(arg("fresh-port")) : undefined;
const minutes = Number(arg("minutes", "10"));
const out = arg("out", path.join("tests-live", "results", `load-${new Date().toISOString().slice(0, 10)}.json`))!;
const section = arg("section", "soak")!;
const maxInFlight = Number(arg("max-in-flight", "200"));
const tag = arg("tag", `soak${Date.now().toString(36)}`)!;

function rateFromKnee(): number {
  const share = Number(arg("knee-share", "0.7"));
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;
  const knee = prev?.steps?.knee?.decisionsPerMin;
  if (!knee) throw new Error(`no knee in ${out}; run load.ts first or pass --rate`);
  return Math.round(knee * share);
}

/** One public event-stream client: counts events by type and how late each arrives after its `at`. */
function watchEvents(url: string) {
  const state = { connected: false, events: 0, byType: {} as Record<string, number>, lagMs: [] as number[], errors: [] as string[], heartbeats: 0 };
  const ac = new AbortController();
  void (async () => {
    try {
      const res = await fetch(new URL("/api/v1/events", url), { headers: { accept: "text/event-stream" }, signal: ac.signal });
      state.connected = res.ok;
      if (!res.ok || !res.body) return void state.errors.push(`status ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith(":")) state.heartbeats++;
          const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
          if (!data) continue;
          try {
            const e = JSON.parse(data);
            state.events++;
            state.byType[e.type] = (state.byType[e.type] ?? 0) + 1;
            if (e.at) state.lagMs.push(Date.now() - Date.parse(e.at));
          } catch {
            // not JSON: ignore
          }
        }
      }
      state.errors.push("stream ended");
    } catch (err) {
      if (!ac.signal.aborted) state.errors.push((err as Error).message);
    }
  })();
  return { state, stop: () => ac.abort() };
}

async function timed(url: string, p: string, headers: Record<string, string> = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(new URL(p, url), { headers, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, body: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  } catch (err) {
    return { status: 0, ms: Math.round(performance.now() - t0), bytes: 0, body: undefined, error: (err as Error).message };
  }
}

async function main() {
  const rate = arg("rate") ? Number(arg("rate")) : rateFromKnee();
  let pid = arg("pid") ? Number(arg("pid")) : undefined;
  let url = arg("url", "http://localhost:4650")!;
  if (freshPort) {
    pid = startServer(freshPort, "nolimits");
    url = `http://localhost:${freshPort}`;
  }
  const health = await fetch(new URL("/api/health", url)).then((r) => r.json());
  if (health?.catalog?.source !== "seed") throw new Error("refusing to soak a server that is not on the seed catalogue");
  const buyers: Buyer[] = await makeBuyers(32, tag);
  console.log(`soak: ${url} pid ${pid}, ${rate} purchases/min for ${minutes} min, mix ${MIX.map(([k, w]) => `${k} ${w * 100}%`).join(", ")}, in-flight cap ${maxInFlight}`);

  const rec = new Recorder();
  const ev = watchEvents(url);
  const samples: unknown[] = [];
  const start = performance.now();
  const end = start + minutes * 60_000;
  const interval = 60_000 / rate;
  let inFlight = 0;
  let started = 0;
  let skipped = 0;
  let peakInFlight = 0;
  const pending: Promise<unknown>[] = [];
  const startProc = procStats(pid);

  // Sampler: every 10 s.
  let lastOrders = 0;
  let lastCalls = 0;
  const sampler = (async () => {
    for (let k = 1; performance.now() < end; k++) {
      const wait = start + k * 10_000 - performance.now();
      if (wait > 0) await sleep(wait);
      const proc = procStats(pid);
      const [h, w] = await Promise.all([timed(url, "/api/health"), timed(url, "/ui-api/wall")]);
      const win = rec.calls.slice(lastCalls);
      const decided = rec.orders.length - lastOrders;
      lastOrders = rec.orders.length;
      lastCalls = rec.calls.length;
      const p95 = (t: string) => pct(win.filter((c) => c.type === t).map((c) => c.ms), 95);
      const row = {
        t: Math.round((performance.now() - start) / 1000),
        rssMb: proc.rssMb,
        cpuPct: proc.cpuPct,
        healthMs: h.ms,
        healthStatus: h.status,
        wallMs: w.ms,
        wallStatus: w.status,
        decidedLast10s: decided,
        decidedTotal: rec.orders.length,
        inFlight,
        skippedTotal: skipped,
        p95Ms: { quote: p95("quote"), order: p95("order"), availability: p95("availability"), request: p95("request") },
        errorsLast10s: win.filter((c) => c.status === 0 || c.status >= 500).length,
        events: ev.state.events,
        loadAvg1: loadAvg()[0],
      };
      samples.push(row);
      console.log(`t=${String(row.t).padStart(4)}s rss ${row.rssMb} MB cpu ${row.cpuPct}%  health ${row.healthMs} ms wall ${row.wallMs} ms  decided ${decided}/10s (total ${row.decidedTotal})  in flight ${inFlight} skipped ${skipped}  p95 quote ${row.p95Ms.quote} order ${row.p95Ms.order}  errors ${row.errorsLast10s}  events ${row.events}  load ${row.loadAvg1}`);
    }
  })();

  // Open loop: a purchase starts every `interval` ms whatever the server's speed, up to the in-flight cap.
  for (let i = 0; performance.now() < end; i++) {
    const at = start + i * interval;
    const wait = at - performance.now();
    if (wait > 0) await sleep(wait);
    if (inFlight >= maxInFlight) {
      skipped++;
      continue;
    }
    const b = buyers[i % buyers.length];
    inFlight++;
    started++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    pending.push(
      runFlow(rec, url, b, pickKind()).finally(() => {
        inFlight--;
      }),
    );
  }
  await sampler;
  const drainStart = performance.now();
  await Promise.race([Promise.allSettled(pending), sleep(120_000)]);
  const drainS = Math.round((performance.now() - drainStart) / 1000);
  const soakSeconds = (performance.now() - start) / 1000;
  const summary = summarise(rec, soakSeconds);
  await sleep(1500); // let the last events arrive
  ev.stop();
  const endProc = procStats(pid);

  // ---------- afterwards: ledger, orders, wall ----------
  const byOrg = (o: OrgName) => buyers.find((b) => b.org === o)!;
  const ledgerChecks: Record<string, unknown> = {};
  let lost = 0;
  let duplicated = 0;
  for (const org of ["laakso", "kaari"] as OrgName[]) {
    const b = byOrg(org);
    const r = await timed(url, "/api/v1/ledger", { authorization: `Mandate ${b.mandates.auto}`, "dock-agent-id": b.agentId });
    const entries: any[] = r.body?.entries ?? [];
    const decisions = new Map<string, number>();
    const commits = new Map<string, number>();
    const signOffs = new Map<string, number>();
    const decisionsPerRequest = new Map<string, number>();
    for (const e of entries) {
      if (!e.orderId) continue;
      if (e.type === "decision") {
        decisions.set(e.orderId, (decisions.get(e.orderId) ?? 0) + 1);
        if (e.requestId) decisionsPerRequest.set(e.requestId, (decisionsPerRequest.get(e.requestId) ?? 0) + 1);
      }
      if (e.type === "order") commits.set(e.orderId, (commits.get(e.orderId) ?? 0) + 1);
      if (e.type === "approval_requested") signOffs.set(e.orderId, (signOffs.get(e.orderId) ?? 0) + 1);
    }
    const mine = rec.orders.filter((o) => o.org === org);
    const missing = mine.filter((o) => !decisions.get(o.orderId));
    const twice = mine.filter((o) => (decisions.get(o.orderId) ?? 0) > 1);
    const commitWrong = mine.filter((o) => o.status === "committed" && commits.get(o.orderId) !== 1);
    const signOffWrong = mine.filter((o) => o.status === "pending_approval" && signOffs.get(o.orderId) !== 1);
    const myRequests = new Set(rec.requests.filter((x) => x.org === org).map((x) => x.requestId));
    const requestsWithTwo = [...decisionsPerRequest].filter(([rid, n]) => myRequests.has(rid) && n > 1).length;
    const seen = new Set(mine.map((o) => o.orderId));
    const unseen = [...decisions.keys()].filter((id) => !seen.has(id)).length; // decided, but this harness never heard back
    lost += missing.length;
    duplicated += twice.length + requestsWithTwo;
    ledgerChecks[org] = {
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      verification: r.body?.verification,
      entries: entries.length,
      ordersPlaced: mine.length,
      missingDecision: missing.length,
      decisionTwice: twice.length,
      committedWithoutOneCommitEntry: commitWrong.length,
      pendingWithoutOneSignOffRequest: signOffWrong.length,
      requestsWithTwoDecisions: requestsWithTwo,
      decidedButNotSeenByHarness: unseen,
    };
    console.log(`ledger ${org}: ${r.status} in ${r.ms} ms, ${(r.bytes / 1e6).toFixed(1)} MB, verification ${JSON.stringify(r.body?.verification)}; ${mine.length} orders placed, missing ${missing.length}, twice ${twice.length}, commit entries wrong ${commitWrong.length}, sign-off entries wrong ${signOffWrong.length}, decided-but-unseen ${unseen}`);
  }
  // A sample of orders read back by their agent: status as the harness saw it.
  const sample = [...rec.orders].sort(() => Math.random() - 0.5).slice(0, 100);
  let readBackMismatch = 0;
  const readMs: number[] = [];
  for (const o of sample) {
    const b = buyers.find((x) => x.org === o.org)!;
    // Any agent of the organisation may read its orders (orders.ts getOrder checks the organisation).
    const r = await http(undefined, "order", url, "GET", `/api/v1/orders/${o.orderId}`, undefined, { authorization: `Mandate ${b.mandates.auto}`, "dock-agent-id": b.agentId });
    readMs.push(r.ms);
    if (r.body?.order?.status !== o.status) readBackMismatch++;
  }
  const wall: number[] = [];
  for (let i = 0; i < 5; i++) wall.push((await timed(url, "/ui-api/wall")).ms);
  const expectedEvents = { order_committed: summary.committed, approval_requested: summary.pendingApproval, order_rejected: summary.rejected };
  const rss = (samples as { rssMb: number | null; t: number }[]).filter((s) => s.rssMb !== null) as { rssMb: number; t: number }[];
  const slope = (() => {
    if (rss.length < 3) return null;
    const n = rss.length;
    const mx = rss.reduce((a, s) => a + s.t, 0) / n;
    const my = rss.reduce((a, s) => a + s.rssMb, 0) / n;
    const num = rss.reduce((a, s) => a + (s.t - mx) * (s.rssMb - my), 0);
    const den = rss.reduce((a, s) => a + (s.t - mx) ** 2, 0);
    return Math.round((num / den) * 60 * 10) / 10; // MB per minute
  })();
  const report = {
    at: new Date().toISOString(),
    url,
    version: health.version,
    settings: { ratePerMin: rate, minutes, maxInFlight, mix: Object.fromEntries(MIX), buyers: 32 },
    open_loop: { started, skippedAtCap: skipped, peakInFlight, drainSeconds: drainS },
    summary,
    memory: { startMb: startProc.rssMb, endMb: endProc.rssMb, peakMb: Math.max(...rss.map((s) => s.rssMb)), slopeMbPerMin: slope },
    health: latency((samples as { healthMs: number }[]).map((s) => s.healthMs)),
    wallDuring: latency((samples as { wallMs: number }[]).map((s) => s.wallMs)),
    wallAfter: { ms: wall, p50: pct(wall, 50) },
    events: { connected: ev.state.connected, received: ev.state.events, byType: ev.state.byType, expectedFromOrders: expectedEvents, lagMs: latency(ev.state.lagMs), heartbeats: ev.state.heartbeats, errors: ev.state.errors },
    ledger: ledgerChecks,
    ordersLost: lost,
    ordersDuplicated: duplicated,
    readBack: { sampled: sample.length, statusMismatch: readBackMismatch, ms: latency(readMs) },
    samples,
    loadAvgEnd: loadAvg(),
    machine: machine(),
  };
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { kind: "dock-load/1" };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...prev, updatedAt: new Date().toISOString(), [section]: report }, null, 2));
  console.log(
    `soak done: ${summary.decided} decided (${summary.decisionsPerMin}/min; ${summary.committed} committed, ${summary.pendingApproval} to sign-off, ${summary.rejected} refused: ${JSON.stringify(summary.refusalsByRule)}), ` +
      `unexpected ${JSON.stringify(summary.unexpectedOutcomes)}, errors ${summary.errors.total}, skipped ${skipped}; rss ${startProc.rssMb} -> ${endProc.rssMb} MB (peak ${report.memory.peakMb}, ${slope} MB/min); ` +
      `events ${ev.state.events} vs expected ${JSON.stringify(expectedEvents)}; lost ${lost}, duplicated ${duplicated}; wall after ${pct(wall, 50)} ms. Wrote ${out} [${section}]`,
  );
  if (freshPort && pid) await stopServer(pid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
