/* eslint-disable @typescript-eslint/no-explicit-any -- load harness: reads untyped JSON replies. */
/**
 * Shared pieces of the local load tests: buyers (mandates minted with the two demo organisations' keys), the
 * open-interface order flow (request -> availability -> quote -> order), call recording and percentiles.
 *
 * Keys: the server reads DOCK_DEMO_ORG_JWK / DOCK_DEMO_KITCHEN_JWK from web/.env.local; this harness reads only those
 * two names from the same file (never prints them), so the mandates it signs verify on the server.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { signMandate, type Mandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";

export function loadDemoKeys(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const parsed = parseEnv(readFileSync(p, "utf8"));
  for (const k of ["DOCK_DEMO_ORG_JWK", "DOCK_DEMO_KITCHEN_JWK"]) if (!process.env[k] && parsed[k]) process.env[k] = parsed[k];
}

// ---------- arguments ----------

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// ---------- recording ----------

export type CallType = "request" | "availability" | "quote" | "order" | "health" | "wall" | "ledger" | "events";
export type Call = { type: CallType; status: number; ms: number; code?: string; rule?: string; at: number };

export class Recorder {
  calls: Call[] = [];
  /** Orders the gate decided: what this harness saw come back. */
  orders: { orderId: string; requestId: string; org: OrgName; kind: FlowKind; status: string; rule?: string }[] = [];
  flows: { kind: FlowKind; ms: number; outcome: string; at: number }[] = [];
  /** Requests this harness opened, so a check afterwards can tell an order it never heard back about. */
  requests: { requestId: string; org: OrgName }[] = [];
  reset(): void {
    this.calls = [];
    this.orders = [];
    this.flows = [];
    this.requests = [];
  }
}

export type Reply = { status: number; body: any; ms: number };

const TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 30_000);

export async function http(rec: Recorder | undefined, type: CallType, base: string, method: "GET" | "POST", p: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const t0 = performance.now();
  let status = 0;
  let parsed: any;
  let code: string | undefined;
  try {
    const res = await fetch(new URL(p, base), {
      method,
      headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
  } catch (err) {
    status = 0;
    code = (err as Error).name === "TimeoutError" ? "timeout" : `transport:${(err as Error).message.slice(0, 60)}`;
  }
  const ms = performance.now() - t0;
  code ??= parsed?.error?.code;
  rec?.calls.push({ type, status, ms, code, rule: parsed?.error?.rule, at: Date.now() });
  return { status, body: parsed, ms };
}

// ---------- buyers ----------

export type OrgName = "laakso" | "kaari";
export type FlowKind = "auto" | "over" | "refuse_rule" | "refuse_budget";
export type Buyer = { org: OrgName; agentId: string; mandates: Record<FlowKind, string> };

const BIG = 1_000_000_000_00; // €1,000,000,000 in cents: limits that never bind, so only the rule under test fires

/**
 * One buyer agent with four mandates from its organisation, all for the same agent id:
 *   auto           per-order limit and weekly budget that never bind: the order is placed alone (201)
 *   over           the organisation's demo limits (Laakso €1,000, Kaari €100) and a large weekly budget: the 1,000 L
 *                  headline order with a substitute goes to a person (202, per_order_limit, + substitution_rule for Laakso)
 *   refuse_rule    the demo rules: PK-4001 (oat drink, gluten) is refused, forbidden_allergens for Laakso,
 *                  category_allowed for Kaari (422)
 *   refuse_budget  a €1 weekly budget: refused weekly_budget (422)
 * The large limits are why repeated orders never trip order_splitting or weekly_budget by accident: splitting counts
 * orders the agent placed alone against the per-order limit, per organisation, for a day (src/core/policy.ts splitCheck).
 */
export async function makeBuyer(org: OrgName, agentId: string, tag: string): Promise<Buyer> {
  const now = new Date();
  const key = org === "laakso" ? await demoOrgKeyPair() : await demoKitchenKeyPair();
  const base = (o: Partial<Mandate>): Mandate => (org === "laakso" ? demoMandate(now, o) : demoKitchenMandate(now, o));
  const approvers = (max: number) => [{ role: "load_approver", name: "Load Test Approver", maxApprovalCents: max }];
  const id = (k: string) => `mnd_load_${tag}_${k}_${agentId}`;
  const mk = async (k: FlowKind, o: Partial<Mandate>) => signMandate(base({ mandateId: id(k), agentId, validUntil: new Date(now.getTime() + 6 * 3600_000).toISOString(), ...o }), key);
  return {
    org,
    agentId,
    mandates: {
      auto: await mk("auto", { perOrderLimitCents: BIG, weeklyBudgetCents: BIG * 100, approvers: approvers(BIG * 100) }),
      over: await mk("over", { weeklyBudgetCents: BIG * 100 }),
      refuse_rule: await mk("refuse_rule", { weeklyBudgetCents: BIG * 100 }),
      refuse_budget: await mk("refuse_budget", { weeklyBudgetCents: 100, perOrderLimitCents: BIG, approvers: approvers(BIG * 100) }),
    },
  };
}

export async function makeBuyers(n: number, tag: string, orgs: OrgName[] = ["laakso", "kaari"]): Promise<Buyer[]> {
  const out: Buyer[] = [];
  for (let i = 0; i < n; i++) {
    const org: OrgName = orgs[i % orgs.length];
    out.push(await makeBuyer(org, `agent_load_${tag}_${org}_${i}`, tag));
  }
  return out;
}

export const ORG_ID: Record<OrgName, string> = { laakso: DEMO_ORG.orgId, kaari: KITCHEN_ORG.orgId };

/** The mix of flows: mostly orders the agent may place alone, a share over the limit (the demo's shape), refusals. */
export const MIX: [FlowKind, number][] = [
  ["auto", 0.75],
  ["over", 0.1],
  ["refuse_rule", 0.075],
  ["refuse_budget", 0.075],
];

export function pickKind(r = Math.random()): FlowKind {
  let acc = 0;
  for (const [k, w] of MIX) {
    acc += w;
    if (r < acc) return k;
  }
  return "auto";
}

/** What the gate should answer per flow kind: [HTTP status, order status, deciding rule for a refusal]. */
export const EXPECTED: Record<FlowKind, { http: number; status: string; rule?: Record<OrgName, string> }> = {
  auto: { http: 201, status: "committed" },
  over: { http: 202, status: "pending_approval" },
  refuse_rule: { http: 422, status: "rejected", rule: { laakso: "forbidden_allergens", kaari: "category_allowed" } },
  refuse_budget: { http: 422, status: "rejected", rule: { laakso: "weekly_budget", kaari: "weekly_budget" } },
};

/** A need-by day no other purchase of this process used: 2 days ahead and on, one more day per purchase. */
let dayCounter = Math.floor(Math.random() * 20_000); // another process on the same server starts elsewhere
function uniqueDay(): string {
  const n = dayCounter++;
  return new Date(Date.now() + (2 + (n % 20_000)) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * One purchase through the open interface, as an outside agent would make it: open a request, check live price and
 * availability for a short list, ask for a fixed-price quote, place the order. Returns the order outcome.
 */
export async function runFlow(rec: Recorder, base: string, b: Buyer, kind: FlowKind): Promise<string> {
  const t0 = performance.now();
  const h = { authorization: `Mandate ${b.mandates[kind]}`, "dock-agent-id": b.agentId };
  const finish = (outcome: string) => {
    rec.flows.push({ kind, ms: performance.now() - t0, outcome, at: Date.now() });
    return outcome;
  };
  let asked: string[];
  let shortlist: string[];
  let lines: { productId: string; quantity: number; substituteFor?: string }[];
  let text: string;
  let neededBy: string | undefined;
  if (kind === "over") {
    // Valio's example: 1,000 L lactose-free milk. VA-1010 has 600 L, AR-2010 makes up the rest as a substitute.
    text = "1000 litres of lactose-free milk (load test)";
    asked = ["VA-1010"];
    shortlist = ["VA-1010", "AR-2010"];
    lines = [
      { productId: "VA-1010", quantity: 60 },
      { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
    ];
  } else if (kind === "refuse_rule") {
    text = "oat drink for the coffee machine (load test)";
    asked = ["PK-4001"];
    shortlist = ["PK-4001"];
    lines = [{ productId: "PK-4001", quantity: 10 + Math.floor(Math.random() * 20) }];
  } else {
    // 40-60 x 1 L (€59.60-€89.40): within 3x of either kitchen's usual milk order (Kaari's history is about
    // 100 L), so the mistake check (order-check.ts) never calls it an unusual amount; and a need-by day of its
    // own: the same check flags the same family for the same day ordered within 48 h as a likely repeat. Either
    // flag, with nobody asked, sends the order to a person (policy human_confirmation) instead of committing it.
    const packs = 40 + Math.floor(Math.random() * 21);
    text = `${packs} litres of lactose-free milk (load test)`;
    neededBy = uniqueDay();
    asked = ["VA-1001"];
    shortlist = ["VA-1001", "VA-1002"];
    lines = [{ productId: "VA-1001", quantity: packs }];
  }
  const r = await http(rec, "request", base, "POST", "/api/v1/requests", { text, productIds: asked, ...(neededBy ? { neededBy } : {}) }, h);
  const requestId = r.body?.request?.requestId;
  if (r.status !== 201 || !requestId) return finish(`request_${r.status}`);
  rec.requests.push({ requestId, org: b.org });
  const a = await http(rec, "availability", base, "POST", "/api/v1/availability", { requestId, productIds: shortlist }, h);
  if (a.status !== 200) return finish(`availability_${a.status}`);
  const q = await http(rec, "quote", base, "POST", "/api/v1/quotes", { requestId, lines }, h);
  if (q.status !== 201 || !q.body?.quoteToken) return finish(`quote_${q.status}${q.body?.error?.code ? `_${q.body.error.code}` : ""}`);
  const orderLines = q.body.quote.lines.map((l: any) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
  const o = await http(rec, "order", base, "POST", "/api/v1/orders", { requestId, quoteToken: q.body.quoteToken, lines: orderLines }, h);
  const order = o.body?.order;
  if (order?.orderId) rec.orders.push({ orderId: order.orderId, requestId, org: b.org, kind, status: order.status, rule: o.body?.error?.rule });
  if (!order) return finish(`order_${o.status}${o.body?.error?.code ? `_${o.body.error.code}` : ""}`);
  return finish(order.status);
}

// ---------- statistics ----------

export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] * 10) / 10;
}

export function latency(xs: number[]) {
  return { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? Math.round(Math.max(...xs)) : null };
}

const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});

/** Per-step (or per-window) summary of what was recorded. */
export function summarise(rec: Recorder, seconds: number) {
  const perMin = (n: number) => Math.round((n / seconds) * 60 * 10) / 10;
  const of = (t: CallType) => latency(rec.calls.filter((c) => c.type === t).map((c) => c.ms));
  const byType = { request: of("request"), availability: of("availability"), quote: of("quote"), order: of("order") };
  const decided = rec.orders.length;
  const committed = rec.orders.filter((o) => o.status === "committed").length;
  const pending = rec.orders.filter((o) => o.status === "pending_approval").length;
  const rejected = rec.orders.filter((o) => o.status === "rejected").length;
  // Gate refusals as designed: a 422 on the order with the rule its flow kind should trip.
  const asDesigned = rec.orders.filter((o) => {
    const e = EXPECTED[o.kind];
    return o.status === e.status && (!e.rule || e.rule[o.org] === o.rule);
  }).length;
  const unexpected = rec.orders.filter((o) => {
    const e = EXPECTED[o.kind];
    return !(o.status === e.status && (!e.rule || e.rule[o.org] === o.rule));
  });
  const errors = rec.calls.filter((c) => c.status === 0 || c.status >= 500);
  // 4xx that are not the order decision itself (422 policy_rejected) are not "as designed" here.
  const odd4xx = rec.calls.filter((c) => c.status >= 400 && c.status < 500 && !(c.type === "order" && c.code === "policy_rejected"));
  return {
    seconds: Math.round(seconds * 10) / 10,
    flows: rec.flows.length,
    decisionsPerMin: perMin(decided),
    committedPerMin: perMin(committed),
    pendingPerMin: perMin(pending),
    rejectedPerMin: perMin(rejected),
    decided,
    committed,
    pendingApproval: pending,
    rejected,
    asDesigned,
    unexpectedOutcomes: count(unexpected, (o) => `${o.kind}->${o.status}${o.rule ? `:${o.rule}` : ""}`),
    refusalsByRule: count(
      rec.orders.filter((o) => o.status === "rejected"),
      (o) => o.rule ?? "?",
    ),
    flowOutcomes: count(rec.flows, (f) => f.outcome),
    latencyMs: { ...byType, flow: latency(rec.flows.map((f) => f.ms)) },
    calls: rec.calls.length,
    errors: { total: errors.length, rate: rec.calls.length ? Math.round((errors.length / rec.calls.length) * 10000) / 10000 : 0, byStatus: count(errors, (c) => `${c.type}:${c.status}:${c.code ?? ""}`) },
    other4xx: count(odd4xx, (c) => `${c.type}:${c.status}:${c.code ?? ""}`),
  };
}

// ---------- the server process ----------

export function procStats(pid: number | undefined): { rssMb: number | null; cpuPct: number | null } {
  if (!pid) return { rssMb: null, cpuPct: null };
  try {
    const out = execFileSync("ps", ["-o", "rss=,%cpu=", "-p", String(pid)], { encoding: "utf8" }).trim().split(/\s+/);
    return { rssMb: Math.round((Number(out[0]) / 1024) * 10) / 10, cpuPct: Number(out[1]) };
  } catch {
    return { rssMb: null, cpuPct: null };
  }
}

export const loadAvg = () => os.loadavg().map((x) => Math.round(x * 100) / 100);

/**
 * Start a server this harness owns (tests-live/load/start-server.sh) and return the node PID; stop it by that PID.
 * Never kills anything it did not start.
 */
export function startServer(port: number, mode: "nolimits" | "limits" = "nolimits"): number {
  const logDir = process.env.LOG_DIR ?? os.tmpdir();
  execFileSync(path.join("tests-live", "load", "start-server.sh"), [String(port), mode], { stdio: "inherit", env: { ...process.env, LOG_DIR: logDir } });
  return Number(readFileSync(path.join(logDir, `dock-load-${port}.pid`), "utf8").trim());
}

export async function stopServer(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(250);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // gone
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const machine = () => ({ cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, platform: `${os.platform()} ${os.release()}` });
