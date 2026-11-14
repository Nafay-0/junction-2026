/* eslint-disable @typescript-eslint/no-explicit-any -- load harness: reads untyped JSON replies. */
/**
 * How many order pages can watch a waiting order before the public rate limits answer 429?
 *
 * Each watcher behaves like src/app/k/[kitchen]/console.tsx with an order waiting for sign-off and the event stream
 * up (src/app/_client/use-live.ts): one EventSource on /api/v1/events?orgId=<kitchen org>, the order through the
 * console back end every 3 s, the request's ledger every 4 s, and the portal overview (portal.tsx) every 30 s. The
 * order is a real one waiting for sign-off on the demo kitchen Kaari. Runs with N watchers behind one address (no
 * X-Forwarded-For: the server sees every one as the same caller), then with one address per watcher (a distinct
 * X-Forwarded-For each) to find the per-kitchen limit. Waits out the one-minute window between runs.
 *
 *   cd web
 *   pnpm exec tsx tests-live/load/watchers.ts --fresh-port 4651 [--seconds 75] [--same 1,2,3] [--distinct 3,4]
 *   pnpm exec tsx tests-live/load/watchers.ts --url http://localhost:4651     (a server you started with limits ON)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { arg, loadAvg, loadDemoKeys, machine, sleep, startServer, stopServer } from "./lib";

loadDemoKeys();
const freshPort = arg("fresh-port") ? Number(arg("fresh-port")) : undefined;
const seconds = Number(arg("seconds", "75"));
const same = (arg("same", "1,2,3") ?? "").split(",").map(Number).filter((n) => n > 0);
const distinct = (arg("distinct", "3,4") ?? "").split(",").map(Number).filter((n) => n > 0);
const out = arg("out", path.join("tests-live", "results", `load-${new Date().toISOString().slice(0, 10)}.json`))!;

type Count = { sent: number; ok: number; r429: number; other: Record<string, number>; firstRefusalS: number | null; rules: Record<string, number> };

async function pendingKaariOrder(url: string): Promise<{ orderId: string; requestId: string }> {
  const agentId = `agent_watch_${Date.now().toString(36)}`;
  const now = new Date();
  // Per-order limit €1: any order waits for the head chef's sign-off, as on the demo path.
  const token = await signMandate(demoKitchenMandate(now, { mandateId: `mnd_watch_${agentId}`, agentId, perOrderLimitCents: 100 }), await demoKitchenKeyPair());
  const h = { authorization: `Mandate ${token}`, "dock-agent-id": agentId, "content-type": "application/json" };
  const post = async (p: string, body: unknown) => {
    const r = await fetch(new URL(p, url), { method: "POST", headers: h, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const req = await post("/api/v1/requests", { text: "100 L lactose-free milk (watcher test)", productIds: ["VA-1001"] });
  const q = await post("/api/v1/quotes", { requestId: req.body.request.requestId, lines: [{ productId: "VA-1001", quantity: 100 }] });
  const o = await post("/api/v1/orders", { requestId: req.body.request.requestId, quoteToken: q.body.quoteToken, lines: q.body.quote.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
  if (o.body?.order?.status !== "pending_approval") throw new Error(`could not make a waiting order: ${o.status} ${JSON.stringify(o.body).slice(0, 200)}`);
  return { orderId: o.body.order.orderId, requestId: req.body.request.requestId };
}

async function runWatchers(url: string, n: number, distinctAddresses: boolean, order: { orderId: string; requestId: string }) {
  const counts: Count = { sent: 0, ok: 0, r429: 0, other: {}, firstRefusalS: null, rules: {} };
  const t0 = Date.now();
  const end = t0 + seconds * 1000;
  const acs: AbortController[] = [];
  const hit = async (headers: Record<string, string>, method: "GET" | "POST", p: string, body?: unknown) => {
    counts.sent++;
    try {
      const r = await fetch(new URL(p, url), { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
      const text = await r.text();
      if (r.status === 429) {
        counts.r429++;
        counts.firstRefusalS ??= Math.round((Date.now() - t0) / 100) / 10;
        try {
          const rule = /limit "([^"]+)"/.exec(JSON.parse(text)?.error?.message ?? "")?.[1] ?? "?";
          counts.rules[rule] = (counts.rules[rule] ?? 0) + 1;
        } catch {
          // ignore
        }
      } else if (r.ok) counts.ok++;
      else counts.other[String(r.status)] = (counts.other[String(r.status)] ?? 0) + 1;
    } catch (err) {
      counts.other[(err as Error).name] = (counts.other[(err as Error).name] ?? 0) + 1;
    }
  };
  const every = async (ms: number, f: () => Promise<void>) => {
    for (let k = 0; ; k++) {
      const at = t0 + k * ms;
      if (at >= end) return;
      const wait = at - Date.now();
      if (wait > 0) await sleep(wait);
      await f();
    }
  };
  const watchers = Array.from({ length: n }, (_, i) => {
    const headers: Record<string, string> = distinctAddresses ? { "x-forwarded-for": `198.51.100.${10 + i}` } : {};
    // The page's event stream: counted once per connection against the "events" limit.
    const ac = new AbortController();
    acs.push(ac);
    counts.sent++;
    void fetch(new URL(`/api/v1/events?orgId=${KITCHEN_ORG.orgId}`, url), { headers: { ...headers, accept: "text/event-stream" }, signal: ac.signal })
      .then((r) => {
        if (r.status === 429) counts.r429++;
        else if (r.ok) counts.ok++;
        else counts.other[`events:${r.status}`] = (counts.other[`events:${r.status}`] ?? 0) + 1;
        return r.body?.cancel ? undefined : undefined;
      })
      .catch(() => undefined);
    const call = (p: string) => hit(headers, "POST", "/ui-api/kitchens/kaari/call", { method: "GET", path: p });
    return Promise.all([
      every(3000, () => call(`/api/v1/orders/${order.orderId}`)),
      every(4000, () => call(`/api/v1/ledger?requestId=${order.requestId}`)),
      every(30_000, () => hit(headers, "GET", "/ui-api/kitchens/kaari/portal")),
    ]);
  });
  await Promise.all(watchers);
  for (const ac of acs) ac.abort();
  // A third person at the same venue address opens a new request on the kitchen, right after.
  const third = await fetch(new URL("/ui-api/kitchens/kaari/call", url), {
    method: "POST",
    headers: { "content-type": "application/json", ...(distinctAddresses ? { "x-forwarded-for": "198.51.100.99" } : {}) },
    body: JSON.stringify({ method: "POST", path: "/api/v1/intake", body: { need: { item: { text: "milk", category: "milk" }, quantity: { amount: 100, unit: "L" } }, by: "third visitor" } }),
  });
  return { watchers: n, addresses: distinctAddresses ? "one per watcher" : "one shared", seconds, ...counts, consoleCallsPerMinPerWatcher: 35, thirdVisitorStatus: third.status };
}

async function main() {
  let url = arg("url", "http://localhost:4651")!;
  let pid: number | undefined;
  if (freshPort) {
    pid = startServer(freshPort, "limits");
    url = `http://localhost:${freshPort}`;
  }
  const health = await fetch(new URL("/api/health", url)).then((r) => r.json());
  if (health?.catalog?.source !== "seed") throw new Error("refusing: not the seed catalogue");
  const probe = await fetch(new URL("/api/v1/ledger", url));
  void probe.text();
  const order = await pendingKaariOrder(url);
  console.log(`watchers on ${url}: waiting order ${order.orderId}; ${seconds}s per run; same address ${same.join(",")}, distinct ${distinct.join(",")}`);
  const runs: unknown[] = [];
  const plan: [number, boolean][] = [...same.map((n) => [n, false] as [number, boolean]), ...distinct.map((n) => [n, true] as [number, boolean])];
  for (const [n, d] of plan) {
    await sleep(65_000); // let the one-minute windows empty
    const r = await runWatchers(url, n, d, order);
    runs.push(r);
    console.log(`${n} watcher(s), ${r.addresses} address: ${r.sent} calls, ${r.r429} refused 429 (first at ${r.firstRefusalS ?? "-"} s, limits ${JSON.stringify(r.rules)}), other ${JSON.stringify(r.other)}, third visitor ${r.thirdVisitorStatus}`);
  }
  const ok = runs.filter((r: any) => r.addresses === "one shared" && r.r429 === 0).map((r: any) => r.watchers);
  const result = { at: new Date().toISOString(), url, version: health.version, maxWatchersOneAddressWithout429: ok.length ? Math.max(...ok) : 0, runs, loadAvg: loadAvg(), machine: machine() };
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { kind: "dock-load/1" };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...prev, updatedAt: new Date().toISOString(), watchers: result }, null, 2));
  console.log(`max watchers behind one address with no 429: ${result.maxWatchersOneAddressWithout429}. Wrote ${out}`);
  if (pid) await stopServer(pid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
