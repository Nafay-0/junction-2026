import type { RecentOrder } from "@/core/policy";
import type { HistoryStore } from "../history/store";
import { changesFrom, type Change, type OrderListItem, type RuleRow, type Shown } from "./history";
import type { MirrorStatus } from "./mirror";
import { differences, judge, mandateRuleValue, reproduces, stateFor, termsDisagree, type Difference, type Verdict } from "./replay";
import type { OrderBody } from "./rows";
import { describeChange, describeRule, kitchenSentence } from "./words";

/**
 * The time machine as one answer: the rules at a chosen moment beside the rules now, what changed in between and
 * who changed it, and, for an order, the real gate run again with the rules as they stood and as they stand.
 * Shared by the operations page (/ops-api/time-machine) and the kitchen's order page; each side picks what it shows.
 */

export type Query = { orderId?: string; requestId?: string; orgId?: string; at?: string; now?: Date };

export type ShownSql = { label: string; sql: string; params: unknown[]; ms: number; rows: number };

export type Replay = {
  /** The rules the instant before the order arrived, and at the chosen moment, and now. */
  then: Verdict;
  at: Verdict;
  now: Verdict;
  /** What differs between the order's own moment and now ("would it pass today?"), and between the chosen moment and now. */
  thenVsNow: Difference[];
  atVsNow: Difference[];
  /** The replay against the rules just before the order reproduces the decision the gate made then. */
  reproduces: { same: boolean; rules: string[] };
  /** The mirror's mandate terms agree with the mandate the order itself carried (fields that differ, if any). */
  termsDisagree: string[];
  /** The mandate was not in the mirror yet the instant before the order: the one the order carried stood in. */
  mandateFromOrder: boolean;
  kitchenSentence: string;
};

export type TimeMachineView = {
  orgId?: string;
  orgName?: string;
  at: string;
  now: string;
  kitchens: { orgId: string; name: string; scenario: boolean }[];
  orders: OrderListItem[];
  order?: OrderListItem & { body: Pick<OrderBody, "createdAt" | "lines" | "requestId" | "agentId" | "request" | "recorded" | "door"> };
  rulesAt: Described[];
  rulesNow: Described[];
  changes: ReturnType<typeof describeChange>[];
  rawChanges: Change[];
  moments: { at: string; what: string; by: string }[];
  replay?: Replay;
  sql: ShownSql[];
};

export type Described = ReturnType<typeof describeRule> & { area: RuleRow["area"]; item: string; value: Record<string, unknown> };

const describe = (rows: RuleRow[]): Described[] => rows.map((r) => ({ ...describeRule(r), area: r.area, item: r.item, value: r.value }));

/** The instant before: an order's own effects (its spend, its status) are not part of the rules it was judged by. */
export const justBefore = (iso: string) => new Date(Date.parse(iso) - 1).toISOString();

export async function timeMachineView(store: HistoryStore, q: Query): Promise<TimeMachineView> {
  const now = (q.now ?? new Date()).toISOString();
  const sql: ShownSql[] = [];
  const show = <T>(label: string, s: Shown<T[]>): Shown<T[]> => {
    sql.push({ label, sql: s.sql, params: s.params, ms: round(s.ms), rows: s.rows.length });
    return s;
  };
  const [ks, list] = await Promise.all([store.kitchens(), store.listOrders()]);
  const picked = q.orderId ? list.rows.find((o) => o.orderId === q.orderId) : undefined;
  const body = q.orderId ? await store.orderBody(q.orderId) : q.requestId ? await bodyByRequest(store, q.requestId) : undefined;
  const orderItem = picked ?? (body ? list.rows.find((o) => o.orderId === body.orderId) : undefined);
  const orgId = body?.orgId ?? q.orgId ?? ks.find((k) => !k.scenario)?.orgId ?? ks.find((k) => k.orgId === "org_demo_aurinko")?.orgId ?? ks[0]?.orgId;
  const at = q.at && !Number.isNaN(Date.parse(q.at)) ? new Date(q.at).toISOString() : body ? justBefore(body.createdAt) : new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  if (!orgId) return { at, now, kitchens: ks, orders: list.rows, rulesAt: [], rulesNow: [], changes: [], rawChanges: [], moments: [], sql };

  const [rulesAt, rulesNow, versions, ticks] = await Promise.all([
    store.rulesAsOf(orgId, at).then((s) => show("The rules at the chosen moment", s)),
    store.rulesAsOf(orgId, now).then((s) => show("The rules now", s)),
    store.versionsBetween(orgId, at < now ? at : now, at < now ? now : at).then((s) => show("Every version in force in between", s)),
    store.moments(orgId).then((s) => show("Every moment a rule changed (the slider's ticks)", s)),
  ]);
  let raw = changesFrom(versions.rows, at < now ? at : now, at < now ? now : at);
  const mandateNow = rulesNow.rows.find((r) => r.area === "mandate");
  const orgName = String(mandateNow?.value.orgName ?? rulesAt.rows.find((r) => r.area === "mandate")?.value.orgName ?? ks.find((k) => k.orgId === orgId)?.name ?? orgId);

  let replay: Replay | undefined;
  if (body) {
    const before = justBefore(body.createdAt);
    const thenRows = before === at ? rulesAt : await store.rulesAsOf(orgId, before).then((s) => show("The rules the instant before the order", s));
    const recent = await store.recentOrdersAsOf(orgId, before, body.orderId).then((s) => show("The kitchen's other orders of that day, as they stood (the splitting check)", s));
    const recentOrders: RecentOrder[] = recent.rows;
    // The live mirror writes a moment after the app sees a change, so a mandate first presented with this very order
    // may not be in MariaDB's history at the instant before it. Then the mandate the order carried stands in, and the
    // page says so (mandateFromOrder) rather than claiming no mandate was in force.
    const carried = (rows: RuleRow[]): RuleRow[] =>
      rows.some((r) => r.area === "mandate" && r.item === body.agentId)
        ? rows
        : [...rows, { area: "mandate", orgId: body.orgId, item: body.agentId, inForce: true, value: mandateRuleValue(body.mandate), changedBy: `${body.mandate.issuer.name}, the mandate presented with this order`, since: body.createdAt }];
    const mandateFromOrder = !thenRows.rows.some((r) => r.area === "mandate" && r.item === body.agentId);
    const thenState = carried(thenRows.rows);
    const then = judge(body, stateFor(thenState, body, before), recentOrders);
    const atV = judge(body, stateFor(before === at ? thenState : rulesAt.rows, body, at), recentOrders);
    const nowV = judge(body, stateFor(rulesNow.rows, body, now), recentOrders);
    const thenVsNow = differences(then, nowV);
    if (mandateFromOrder) {
      // The mirror's first sight of the mandate the order carried is not a change of rule since the order.
      const same = JSON.stringify({ ...mandateRuleValue(body.mandate), issuedAs: 0 });
      raw = raw.filter((c) => !(c.area === "mandate" && c.kind === "added" && c.item === body.agentId && JSON.stringify({ ...c.after?.value, issuedAs: 0 }) === same));
    }
    replay = {
      then,
      at: atV,
      now: nowV,
      thenVsNow,
      atVsNow: differences(atV, nowV),
      reproduces: reproduces(body, then),
      termsDisagree: mandateFromOrder ? [] : termsDisagree(body, thenRows.rows.find((r) => r.area === "mandate" && r.item === body.agentId)),
      mandateFromOrder,
      kitchenSentence: kitchenSentence(then, nowV, thenVsNow),
    };
  }

  return {
    orgId,
    orgName,
    at,
    now,
    kitchens: ks,
    orders: list.rows,
    order: orderItem && body ? { ...orderItem, body: { createdAt: body.createdAt, lines: body.lines, requestId: body.requestId, agentId: body.agentId, request: body.request, recorded: body.recorded, door: body.door } } : undefined,
    rulesAt: describe(rulesAt.rows),
    rulesNow: describe(rulesNow.rows),
    changes: raw.map(describeChange),
    rawChanges: raw,
    moments: dedupe(ticks.rows.map((m) => ({ at: m.at, what: m.area, by: m.by }))),
    replay,
    sql,
  };
}

async function bodyByRequest(store: HistoryStore, requestId: string): Promise<OrderBody | undefined> {
  const id = await store.latestOrderOfRequest(requestId);
  return id ? store.orderBody(id) : undefined;
}

function dedupe(xs: { at: string; what: string; by: string }[]) {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(`${x.at}|${x.what}`) ? false : (seen.add(`${x.at}|${x.what}`), true)));
}

const round = (ms: number) => Math.round(ms * 100) / 100;

/** The mirror's state in words: attached and current, behind, or failing. */
export function mirrorHealth(s: MirrorStatus, now = Date.now(), where = "MariaDB"): { state: "current" | "behind" | "failing"; sentence: string } {
  if (s.lastError) return { state: "failing", sentence: `The mirror could not write to ${where} (${s.lastError.message}). Ordering is not affected; the history here stops at ${s.lastOkAt ?? "the start"} until it catches up.` };
  if (s.pendingSince && now - Date.parse(s.pendingSince) > 5000) return { state: "behind", sentence: `The mirror is behind: changes since ${s.pendingSince} are not written yet. Ordering is not affected.` };
  return { state: "current", sentence: s.lastOkAt ? `Mirror current: everything the gate reads was written at ${s.lastOkAt}.` : "Mirror starting." };
}
