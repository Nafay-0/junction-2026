import type { LedgerEntry } from "@/core/ledger";
import { DOOR_TEXT, type Door, type PublicOrder } from "@/core/orders";
import { AIVEN_BUYER } from "@/server/aiven/showcase/buyer";
import { eur, humanize, roleLabel } from "@/app/_ui/plain";
import { disclose, isPrivate } from "./privacy";
import { buildTrace, type TraceStep } from "./trace";

/**
 * One order's whole life as a timeline, from the ledger alone (plus the order record): the request in the buyer's
 * words, how it was read, what was looked up, the options and the choice, the signed quote, the mistake check, the
 * gate's decision rule by rule, the sign-off, the order and its receipt, and everything after (taken back, a product
 * that could not come, a substitute, a backup, the receipt email). Pure: same entries in, same timeline out.
 *
 * One timeline, three readers:
 *   ops     the wholesaler's operations staff: the kitchen's private memory is named, never shown (privacy.ts)
 *   buyer   the kitchen itself, for its own order: the same steps, with its own memory shown in full
 *   agent   an outside agent or the wholesaler's systems over the API: the buyer's view of an order of its own
 * Every step names who or what did it, marks the agent's own choices and the people who acted, and keeps its ledger
 * entry's seq and hash.
 */

export type Viewer = "ops" | "buyer" | "agent";

export type OrderSource =
  | "conversation"
  | "voice"
  | "photo"
  | "menu"
  | "assistant"
  | "store"
  | "mcp"
  | "rest"
  | "connector"
  | "aiven_agent"
  | "watch_renewal"
  | "watch_substitute"
  | "backup"
  | "offer"
  | "presenter"
  | "other";

export const SOURCE_TEXT: Record<OrderSource, string> = {
  conversation: "the kitchen's agent, typed in the conversation",
  voice: "the kitchen's agent, by voice",
  photo: "the kitchen's agent, from a photo or document",
  menu: "the kitchen's agent, from the menu planner",
  assistant: "the store's assistant panel",
  store: "the kitchen store",
  mcp: "an outside agent over MCP",
  rest: "an outside agent over REST",
  connector: "a consumer assistant over the kitchen's connector",
  aiven_agent: "the Aiven Managed Agent (over MCP)",
  watch_renewal: "the watch: a recurring order renewed",
  watch_substitute: "the watch: a substitute for a product that cannot come",
  backup: "the watch: the backup the kitchen lined up",
  offer: "an accepted offer from the selling agent",
  presenter: "the presenter show (a phone asked for the demo order)",
  other: "another way",
};

export type ActorKind = "agent" | "person" | "wholesaler" | "system";

export type TimelineStep = {
  seq: number;
  at: string;
  /** What kind of step, for the icon and the grouping (the trace's phases plus the order's life after it). */
  phase: TraceStep["phase"] | "conversation" | "watch" | "offer" | "mail" | "after" | "memory";
  title: string;
  lines: string[];
  facts: { label: string; value: string }[];
  tone: "plain" | "safety" | "done";
  actor: { kind: ActorKind; name: string };
  /** The agent decided this itself (a choice among options, a renewal, a substitute it ordered alone). */
  agentChoice: boolean;
  /** A person took this step (named in actor.name). */
  person: boolean;
  checks?: TraceStep["checks"];
  products?: TraceStep["products"];
  excluded?: TraceStep["excluded"];
  untouched?: string;
  memory?: string[];
  /** The ledger entry (its summary withheld when it is the kitchen's private memory and the reader is not the kitchen). */
  ledger: { seq: number; hash: string; type: string; summary: string };
  /** 1-based position in the request's Trace replay (/ops/trace/<requestId>?step=N), when the step is part of it. */
  traceStep?: number;
};

export type DecidedHow = { kind: "alone" | "person" | "refused" | "open"; words: string; rule?: string; person?: string };

export type OrderTimeline = {
  orderId: string;
  requestId: string;
  orgId: string;
  orgName: string;
  agentId: string;
  agentLabel: string;
  source: OrderSource;
  sourceText: string;
  door?: Door;
  status: PublicOrder["status"] | "replaced";
  statusWords: string;
  waitingSinceAt?: string;
  replacedBy?: string;
  totalCents: number;
  deliveryDate?: string;
  what: string;
  lineCount: number;
  decided: DecidedHow;
  asked: string;
  createdAt: string;
  viewer: Viewer;
  steps: TimelineStep[];
  /** Steps every placed order has; missing ones are named (the "nothing missing" check). */
  complete: { ok: boolean; missing: string[] };
};

// ---------- which entries belong to an order ----------

const HOP_KEYS = ["findingId", "renewalId", "backupId", "offerId"] as const;
const NOISE = new Set(["model_call", "tool_call"]);

/**
 * The ledger entries of one order: its request's, any entry naming the order, entries without a request that
 * mention it (the conversation's turn ends, the memory writer), watch, offer and mail entries that mention it, and,
 * one hop further, the entries of the same watch finding, renewal, backup or offer, and the buyer's words of the turns
 * that opened or moved it.
 */
export function entriesOfOrder(all: readonly LedgerEntry[], order: Pick<PublicOrder, "orderId" | "requestId">): LedgerEntry[] {
  const { orderId, requestId } = order;
  const picked = new Map<number, LedgerEntry>();
  const mentions = (e: LedgerEntry) => {
    const s = JSON.stringify(e.data);
    return s.includes(orderId) || s.includes(requestId);
  };
  for (const e of all) {
    if (e.type === "agent" && NOISE.has(String(e.data.event))) continue;
    if (e.requestId === requestId || e.orderId === orderId) picked.set(e.seq, e);
    else if ((!e.requestId || e.type === "watch" || e.type === "offer" || e.type === "mail") && mentions(e)) picked.set(e.seq, e);
  }
  const hops = new Map<string, Set<string>>(HOP_KEYS.map((k) => [k, new Set<string>()]));
  const turns = new Set<string>();
  for (const e of picked.values()) {
    for (const k of HOP_KEYS) if (typeof e.data[k] === "string") hops.get(k)!.add(e.data[k] as string);
    const t = (e.data.thread as { turnId?: string } | undefined)?.turnId;
    if (e.type === "agent" && t && (e.data.event === "turn_done" || e.requestId === requestId)) turns.add(t);
  }
  for (const e of all) {
    if (picked.has(e.seq)) continue;
    if ((e.type === "watch" || e.type === "offer") && HOP_KEYS.some((k) => typeof e.data[k] === "string" && hops.get(k)!.has(e.data[k] as string))) picked.set(e.seq, e);
    else if (e.type === "agent" && e.data.event === "turn" && turns.has(String((e.data.thread as { turnId?: string } | undefined)?.turnId))) picked.set(e.seq, e);
  }
  return [...picked.values()].sort((a, b) => a.seq - b.seq);
}

// ---------- where an order came from ----------

const DOOR_SOURCE: Record<Door, OrderSource> = { typed: "conversation", voice: "voice", photo: "photo", menu: "menu", assistant: "assistant", store: "store", mcp: "mcp", rest: "rest", connector: "connector" };

export function sourceOf(order: Pick<PublicOrder, "orderId" | "agentId">, entries: readonly LedgerEntry[]): { source: OrderSource; door?: Door } {
  const request = entries.find((e) => e.type === "request");
  const door = (typeof request?.data.door === "string" ? request.data.door : undefined) as Door | undefined;
  const mine = (e: LedgerEntry) => e.orderId === order.orderId;
  if (entries.some((e) => e.type === "agent" && e.data.event === "presenter_order" && mine(e))) return { source: "presenter", ...(door ? { door } : {}) };
  if (entries.some((e) => e.type === "watch" && e.data.step === "backup_used" && mine(e))) return { source: "backup", ...(door ? { door } : {}) };
  if (entries.some((e) => e.type === "watch" && e.data.step === "decided" && mine(e))) return { source: "watch_substitute", ...(door ? { door } : {}) };
  if (entries.some((e) => e.type === "watch" && e.data.step === "renewal_placed" && mine(e))) return { source: "watch_renewal", ...(door ? { door } : {}) };
  if (entries.some((e) => e.type === "offer" && e.data.step === "accepted" && e.requestId === request?.requestId)) return { source: "offer", ...(door ? { door } : {}) };
  if (order.agentId === AIVEN_BUYER.agentId) return { source: "aiven_agent", door: door ?? "mcp" };
  return door ? { source: DOOR_SOURCE[door] ?? "other", door } : { source: "other" };
}

// ---------- building the timeline ----------

export type TimelineInput = {
  order: PublicOrder;
  /** The whole ledger (entriesOfOrder picks this order's), or already picked entries. */
  ledger: readonly LedgerEntry[];
  viewer: Viewer;
  names?: Record<string, string>;
  agentLabel?: (agentId: string) => string | undefined;
  catalogueSize?: number;
  /** The order that replaced this one, when one did (`order.data.replaces`). */
  now?: Date;
};

const REQUEST_TYPES = new Set(["request", "intake", "lookup", "quote", "decision", "approval_requested", "approval", "order", "refusal"]);

function actorFor(actor: string, agentName: string, order: PublicOrder, data: Record<string, unknown>): { kind: ActorKind; name: string; person: boolean } {
  if (actor === "dock") return { kind: "system", name: "AimoPilot", person: false };
  if (actor.startsWith("agent:")) return { kind: "agent", name: agentName, person: false };
  if (actor.startsWith("wholesaler:")) return { kind: "wholesaler", name: "The wholesaler's selling agent", person: false };
  if (actor.startsWith("approver:")) {
    const role = actor.slice(9);
    const name = order.approval?.approver.role === role ? order.approval.approver.name : roleLabel(role).replace(/^./, (c) => c.toUpperCase());
    return { kind: "person", name, person: true };
  }
  if (actor.startsWith("buyer:")) {
    const by = typeof data.by === "string" && data.by ? data.by : actor.slice(6).replace(/^org_/, "");
    return { kind: "person", name: by, person: true };
  }
  if (actor.startsWith("staff:") || actor.startsWith("operator:")) return { kind: "person", name: `Operations: ${actor.split(":")[1]}`, person: true };
  return { kind: "system", name: actor, person: false };
}

/** Choices the agent made itself (not relayed for a person). */
function isAgentChoice(e: LedgerEntry): boolean {
  if (!e.actor.startsWith("agent:") && !(e.type === "watch" && e.actor === "dock")) return false;
  const d = e.data;
  if (e.type === "intake" && d.step === "choice") return /^agent /.test(e.summary);
  if (e.type === "order" && d.decision === "taken_back") return d.verified !== true;
  if (e.type === "watch") return d.step === "renewal_placed" || d.step === "backup_used" || d.step === "decided";
  return false;
}

const turnWords = (d: Record<string, unknown>): string => (typeof d.words === "string" ? d.words : "");

/** Steps for the entries the request trace does not tell well (or at all): the conversation, the watch, offers, mails, and the order's life after. */
function ownStep(e: LedgerEntry, viewer: Viewer, names: Record<string, string>): Omit<TimelineStep, "actor" | "agentChoice" | "person" | "ledger" | "seq" | "at"> | undefined {
  const d = e.data;
  const say = (t: string) => humanize(t, names);
  const plain = { lines: [] as string[], facts: [] as { label: string; value: string }[], tone: "plain" as const };
  if (e.type === "agent") {
    const ev = String(d.event ?? "");
    if (ev === "turn") {
      const door = (d.thread as { door?: string } | undefined)?.door;
      const label = /tapped "(.+?)"/.exec(e.summary)?.[1] ?? (d.action as { type?: string } | undefined)?.type ?? "a button";
      const tapped = d.action ? `tapped “${label}”` : "said";
      return { ...plain, phase: "conversation", title: `The buyer ${tapped}${door ? ` (${door === "voice" ? "by voice" : door === "photo" ? "with a photo" : "typed"})` : ""}`, lines: turnWords(d) ? [`“${turnWords(d).slice(0, 600)}”`] : [say(e.summary)] };
    }
    if (ev === "turn_done") {
      const st = String(d.status ?? "done");
      return { ...plain, phase: "conversation", title: st === "waiting_approver" ? "The agent's turn ended: waiting for a person's sign-off" : st === "waiting_buyer" ? "The agent's turn ended: it asked the buyer" : "The agent's turn ended", facts: Array.isArray(d.cards) && d.cards.length ? [{ label: "Shown", value: (d.cards as string[]).join(", ") }] : [] };
    }
    if (ev === "memory_read" || ev === "memory_write") {
      if (viewer === "ops") return { ...plain, phase: "memory", title: ev === "memory_read" ? "The agent read the kitchen's memory for this request" : "The memory writer read this order", lines: ["What the memory holds is the kitchen's own and is not shown here."] };
      return { ...plain, phase: "memory", title: ev === "memory_read" ? "The agent read your memory for this request" : "The memory writer read this order", lines: [say(e.summary)] };
    }
    if (ev === "presenter_order") return { ...plain, phase: "asked", title: say(e.summary) };
    if (ev === "sign_off_wait" || ev === "sign_off_answered") return { ...plain, phase: "signoff", title: say(e.summary) };
    return { ...plain, phase: "conversation", title: say(e.summary) };
  }
  if (e.type === "intake" && !e.requestId) {
    // The memory learned from the order after it (written without a request).
    if (viewer === "ops") return { ...plain, phase: "memory", title: "The kitchen's memory learned from this order", lines: ["What it stored is the kitchen's own and is not shown here."] };
    return { ...plain, phase: "memory", title: say(e.summary) };
  }
  if (e.type === "watch") {
    const step = String(d.step ?? "");
    const title = say(e.summary.replace(/^STAGED: /, ""));
    const staged = d.staged === true ? [{ label: "Staged", value: "a demo condition set by operations" }] : [];
    return { ...plain, phase: step === "found" ? "after" : "watch", title, facts: staged, tone: step === "found" ? "safety" : "plain" };
  }
  if (e.type === "offer") return { ...plain, phase: "offer", title: say(e.summary) };
  if (e.type === "mail") {
    const sent = d.outcome === "sent";
    return { ...plain, phase: "mail", title: sent ? `${String(d.kind ?? "The receipt").replace(/^./, (c) => c.toUpperCase()).replaceAll("_", " ")} emailed to the kitchen` : say(e.summary), lines: sent ? ["To the kitchen's confirmed address (not shown)."] : [], facts: typeof d.providerId === "string" ? [{ label: "Mail id", value: d.providerId }] : [] };
  }
  if (e.type === "order" && d.decision === "taken_back") {
    const by = typeof d.by === "string" && d.by ? d.by : "the agent";
    return { ...plain, phase: "after", tone: "safety", title: `Taken back by ${by}${d.verified === true ? " (signed in)" : " (relayed by the agent, not verified)"}, before the order cut-off`, lines: [typeof d.reason === "string" && d.reason ? `Why: “${d.reason}”` : "", "The wholesaler's confirmation no longer holds; it no longer counts against the weekly budget."].filter(Boolean), facts: typeof d.cutoff === "string" ? [{ label: "Cut-off", value: d.cutoff.slice(0, 16).replace("T", " ") + " UTC" }] : [] };
  }
  if (e.type === "order" && typeof d.replaces === "string") return { ...plain, phase: "after", title: say(e.summary) };
  // The wholesaler's team confirmed it for delivery, or could not (server/fulfilment).
  if (e.type === "order" && d.step === "fulfilment") return { ...plain, phase: "after", tone: d.decision === "confirmed" ? "plain" : "safety", title: d.decision === "confirmed" ? `Confirmed for delivery by ${String(d.by ?? "the wholesaler's team")} of the wholesaler's team` : `The wholesaler's team (${String(d.by ?? "staff")}) could not confirm it for delivery`, lines: typeof d.reason === "string" && d.reason ? [`Why: “${d.reason}”`] : [] };
  if (e.type === "approval" && (d.decision === "withdrawn" || d.decision === "expired")) return { ...plain, phase: "after", tone: "safety", title: say(e.summary) };
  if (e.type === "control") return viewer === "ops" ? { ...plain, phase: "control", title: say(e.summary) } : undefined;
  return undefined;
}

const STATUS_WORDS: Record<OrderTimeline["status"], string> = {
  pending_approval: "Waiting for sign-off",
  committed: "Placed",
  rejected: "Refused by the gate",
  declined: "Declined",
  withdrawn: "Taken back",
  expired: "Expired unsigned",
  replaced: "Replaced",
};

export function decidedHow(order: PublicOrder): DecidedHow {
  const rules = order.decision.rules ?? [];
  if (order.decision.outcome === "reject") {
    const r = rules.find((x) => x.outcome === "fail");
    return { kind: "refused", words: `Refused by the gate${r ? `: ${r.rule}` : ""}`, ...(r ? { rule: r.rule } : {}) };
  }
  if (order.decision.outcome === "needs_human_approval") {
    const r = rules.find((x) => x.outcome === "escalate");
    const who = order.approval?.approver.name;
    return { kind: "person", words: `Sent to ${who ?? "a named person"}${r ? ` (${r.rule})` : ""}`, ...(r ? { rule: r.rule } : {}), ...(who ? { person: who } : {}) };
  }
  return { kind: "alone", words: "The agent alone, within its limit" };
}

export function buildOrderTimeline(input: TimelineInput): OrderTimeline {
  const { order, viewer } = input;
  const names = { ...(input.names ?? {}), ...Object.fromEntries(order.lines.map((l) => [l.productId, l.name])) };
  const entries = entriesOfOrder(input.ledger, order);
  const agentLabel = input.agentLabel?.(order.agentId) ?? order.agentId;
  const requestEntries = entries.filter((e) => e.requestId === order.requestId && REQUEST_TYPES.has(e.type));
  const trace = buildTrace({ requestId: order.requestId, entries: requestEntries, orders: [order], names, catalogueSize: input.catalogueSize, orgName: order.orgName });
  const traceIndex = new Map(trace.steps.map((s, i) => [s.seq, i + 1]));
  const traceBySeq = new Map(trace.steps.map((s) => [s.seq, s]));
  const steps: TimelineStep[] = [];
  for (const e of entries) {
    // Steps for another order of the same request (a split need, a refused replay) are that order's.
    if (e.orderId && e.orderId !== order.orderId && e.type !== "watch") continue;
    let who = actorFor(e.actor, agentLabel, order, e.data);
    // A choice or an answer the agent relayed for a named person is that person's step, marked as relayed.
    const relayed = e.actor.startsWith("agent:") && e.type === "intake" && /^(.+?) (?:chose|answered|confirmed)\b.*relayed by the agent/.exec(e.summary);
    if (relayed && !/^agent /.test(e.summary)) who = { kind: "person", name: `${relayed[1]} (relayed by the agent, not verified)`, person: true };
    const relaying = e.actor.startsWith("agent:") && e.type === "intake" && /^Relayed by the agent, not verified: it says (.+?) meant/.exec(e.summary);
    if (relaying) who = { kind: "person", name: `${relaying[1]} (relayed by the agent, not verified)`, person: true };
    // Taken back by the kitchen's signed-in person: theirs, not the agent's.
    if (e.type === "order" && e.data.decision === "taken_back" && e.data.verified === true && typeof e.data.by === "string") who = { kind: "person", name: e.data.by, person: true };
    // The buyer's own words or tap in the conversation: written by the agent's turn, said by a person in the kitchen.
    if (e.type === "agent" && e.data.event === "turn") who = { kind: "person", name: `The buyer at ${order.orgName}`, person: true };
    const own = ownStep(e, viewer, names);
    const t = own ? undefined : traceBySeq.get(e.seq);
    if (!own && !t) continue;
    const privateToKitchen = isPrivate(e);
    // A buyer-side intake step the trace only tells by its sentence (what Dock noticed, what memory it applied): the
    // operations reader learns that it happened, not what the kitchen's history holds.
    if (viewer === "ops" && privateToKitchen && t && t.phase === "other") {
      steps.push({ seq: e.seq, at: e.at, phase: "memory", title: "A check against the kitchen's own history (kept with the kitchen)", lines: [], facts: [], tone: "plain", actor: { kind: who.kind, name: who.name }, person: who.person, agentChoice: false, ledger: { seq: e.seq, hash: e.hash, type: e.type, summary: disclose(e).summary }, ...(traceIndex.has(e.seq) ? { traceStep: traceIndex.get(e.seq) } : {}) });
      continue;
    }
    const summary = viewer === "ops" ? disclose(e).summary : e.summary;
    const base = own ?? {
      phase: t!.phase,
      title: t!.title,
      lines: t!.lines,
      facts: t!.facts,
      tone: t!.tone,
      ...(t!.checks ? { checks: t!.checks } : {}),
      ...(t!.products ? { products: t!.products } : {}),
      ...(t!.excluded ? { excluded: t!.excluded } : {}),
      ...(t!.untouched ? { untouched: t!.untouched } : {}),
      ...(t!.memory ? { memory: t!.memory } : {}),
    };
    // The kitchen reads its own memory in full: the private steps add the ledger's own sentence.
    const lines = viewer !== "ops" && privateToKitchen && !own ? [...base.lines, humanize(e.summary, names)] : base.lines;
    steps.push({
      ...base,
      lines,
      seq: e.seq,
      at: e.at,
      actor: { kind: who.kind, name: who.name },
      person: who.person,
      agentChoice: isAgentChoice(e),
      ledger: { seq: e.seq, hash: e.hash, type: e.type, summary },
      ...(traceIndex.has(e.seq) ? { traceStep: traceIndex.get(e.seq) } : {}),
    });
  }
  // The receipt: the wholesaler's signed confirmation on a placed order (checked by the reader's own code against
  // the published key; the ops page shows the server's check).
  const { source, door } = sourceOf(order, entries);
  const replacedBy = (input.ledger.find((e) => e.type === "order" && e.data.replaces === order.orderId) as LedgerEntry | undefined)?.orderId;
  const status: OrderTimeline["status"] = replacedBy ? "replaced" : order.status;
  const request = entries.find((e) => e.type === "request" && e.requestId === order.requestId);
  const first = order.lines[0];
  const deliveryDates = [...new Set(order.lines.map((l) => l.deliveryDate))].sort();
  const missing: string[] = [];
  const has = (p: (s: TimelineStep) => boolean) => steps.some(p);
  if (!has((s) => s.ledger.type === "request")) missing.push("the request");
  if (!has((s) => s.ledger.type === "quote")) missing.push("the signed quote");
  if (!has((s) => s.ledger.type === "decision")) missing.push("the gate's decision");
  if (order.decision.outcome === "needs_human_approval" && !has((s) => s.ledger.type === "approval_requested")) missing.push("the sign-off request");
  if ((order.status === "committed" || replacedBy) && !has((s) => s.ledger.type === "order")) missing.push("the order placed");
  if (source === "watch_renewal" && !has((s) => s.ledger.type === "watch")) missing.push("the watch's renewal");
  if (source === "offer" && !has((s) => s.ledger.type === "offer")) missing.push("the accepted offer");
  if (source === "presenter" && !has((s) => s.phase === "asked" && s.person)) missing.push("who asked for the demo order");
  if (steps.some((s) => !s.actor.name)) missing.push("an actor");
  return {
    orderId: order.orderId,
    requestId: order.requestId,
    orgId: order.orgId,
    orgName: order.orgName,
    agentId: order.agentId,
    agentLabel,
    source,
    sourceText: SOURCE_TEXT[source],
    ...(door ? { door } : {}),
    status,
    statusWords: replacedBy ? `Replaced by ${replacedBy}` : order.status === "pending_approval" ? `Waiting for ${order.approval?.approver.name ?? "a person"}'s sign-off` : STATUS_WORDS[order.status],
    ...(order.status === "pending_approval" && order.approval ? { waitingSinceAt: order.approval.requestedAt } : {}),
    ...(replacedBy ? { replacedBy } : {}),
    totalCents: order.totalCents,
    ...(deliveryDates[0] ? { deliveryDate: deliveryDates[0] } : {}),
    what: first ? `${first.quantity} × ${first.name}${order.lines.length > 1 ? ` and ${order.lines.length - 1} more` : ""}` : "no lines",
    lineCount: order.lines.length,
    decided: decidedHow(order),
    asked: typeof request?.data.text === "string" ? request.data.text : "",
    createdAt: order.createdAt,
    viewer,
    steps,
    complete: { ok: missing.length === 0, missing },
  };
}

export const doorText = (d?: Door) => (d ? DOOR_TEXT[d] : undefined);
export const money = (c: number) => eur(c);
