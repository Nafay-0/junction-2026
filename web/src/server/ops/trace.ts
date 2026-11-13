import type { LedgerEntry } from "@/core/ledger";
import type { PublicOrder } from "@/core/orders";
import { amount, attr, clock, day, eur, humanize, roleLabel, shortProduct } from "@/app/_ui/plain";
import { memoryCount, memoryParts, publicReasons } from "./privacy";
import { ruleTitleOf } from "./rules";
import type { Via } from "./door";

/**
 * The flow trace: one purchase request as a path through Dock, step by step, in the order it happened, built from
 * nothing but its ledger entries (and the order records they point to, for each rule's reason and the signed
 * confirmation). Pure: same entries in, same trace out, so it is tested without a server.
 *
 * Every step keeps its ledger entry's seq and hash, so the page can link each step to the record and check the
 * chain. Content that is the kitchen's private memory is named, never shown (see privacy.ts).
 */
export type Phase =
  | "asked"
  | "understood"
  | "checked"
  | "answered"
  | "searched"
  | "priced"
  | "options"
  | "chosen"
  | "quoted"
  | "gate"
  | "signoff"
  | "committed"
  | "declined"
  | "refused"
  | "control"
  | "other";

export type Check = { rule: string; title: string; outcome: "pass" | "escalate" | "fail"; reason?: string };
export type ProductRow = { id: string; name: string; note?: string; tone?: "plain" | "safety" };
export type ExclusionGroup = { reason: string; count: number; examples: string[] };

export type TraceStep = {
  seq: number;
  at: string;
  phase: Phase;
  /** Who acted, in words: "Buyer agent", "Dock", "Aino Virtanen", "Kitchen staff". */
  actor: string;
  title: string;
  lines: string[];
  tone: "plain" | "safety" | "done";
  facts: { label: string; value: string }[];
  checks?: Check[];
  products?: ProductRow[];
  excluded?: ExclusionGroup[];
  /** "The other 3,412 products were not sent to the live service." */
  untouched?: string;
  /** Named, never shown: which of the kitchen's private memory this step used. */
  memory?: string[];
  ledger: { seq: number; hash: string; prevHash: string; type: string; actor: string; summary: string };
};

export type TraceOutcome = { kind: "committed" | "waiting" | "refused" | "declined" | "cancelled" | "open"; label: string };

export type Trace = {
  requestId: string;
  orgName: string;
  agentId: string;
  via?: Via;
  asked: string;
  neededBy?: string;
  startedAt: string;
  endedAt: string;
  outcome: TraceOutcome;
  steps: TraceStep[];
  orderIds: string[];
  /** Products the request looked at in master data (free), and the ones that got a live price check (metered). */
  considered: number;
  priced: number;
  catalogueSize?: number;
};

export type TraceInput = {
  requestId: string;
  entries: LedgerEntry[];
  orders?: PublicOrder[];
  names?: Record<string, string>;
  catalogueSize?: number;
  orgName?: string;
  via?: Via;
};

const SENTINEL_STOCK = 999_999;

const EXCLUSION_BUCKETS: [RegExp, string][] = [
  [/cut-?off|order by|orderby|ordering deadline|too late to order/i, "Order cut-off has passed"],
  [/no allergen data|allergen data|allergens? (?:are |is )?unknown|undeclared/i, "No allergen data from the maker"],
  [/allergen/i, "Contains a forbidden allergen"],
  [/lactose/i, "Not lactose-free"],
  [/categor/i, "Outside the kitchen's product groups"],
  [/certificat/i, "Missing a required certificate"],
  [/arriv|deliver|lead time|in time/i, "Cannot arrive in time"],
  [/stock|availab|no offer|sold out|cannot be bought/i, "Not available"],
  [/budget|limit|expensive|costs?\b/i, "Over the money limits"],
  [/organic|fat|attribute|lacks|required|claim/i, "Does not meet the kitchen's requirements"],
];

export function exclusionBucket(reason: string): string {
  for (const [re, label] of EXCLUSION_BUCKETS) if (re.test(reason)) return label;
  const r = humanize(reason).replace(/\.$/, "");
  return r.length > 70 ? `${r.slice(0, 67).trimEnd()}…` : r;
}

export function groupExclusions(excluded: { productId: string; reason: string }[], name: (id: string) => string): ExclusionGroup[] {
  const groups = new Map<string, { ids: Set<string> }>();
  for (const x of excluded) {
    const key = exclusionBucket(x.reason);
    const g = groups.get(key) ?? { ids: new Set<string>() };
    g.ids.add(x.productId);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([reason, g]) => ({ reason, count: g.ids.size, examples: [...g.ids].slice(0, 3).map(name) }))
    .sort((a, b) => b.count - a.count);
}

type Need = {
  text?: string;
  item?: { text?: string; category?: string; attributes?: string[]; excludedAttributes?: string[]; productId?: string };
  quantity?: { amount: number; unit: string };
  deliverBy?: string;
  requiredClaims?: string[];
  forbiddenAllergens?: string[];
  optimise?: string;
  sameAsLastTime?: boolean;
};

const OPTIMISE: Record<string, string> = { price: "lowest price", cheapest: "lowest price", carbon: "lowest CO2", co2: "lowest CO2", reliability: "most reliable delivery", no_preference: "no preference" };

function describeNeedPlain(n: Need): string {
  const what = n.item?.text ?? n.item?.category ?? "something";
  const qty = n.quantity ? `${amount(n.quantity.amount, n.quantity.unit)} of ` : n.sameAsLastTime ? "the same as last time: " : "";
  const parts = [`${qty}${what}`];
  if (n.deliverBy) parts.push(`by ${day(n.deliverBy)}`);
  return parts.join(" ");
}

function needFacts(n: Need): { label: string; value: string }[] {
  const f: { label: string; value: string }[] = [];
  if (n.item?.category) f.push({ label: "Product family", value: n.item.category.replaceAll("_", " ") });
  if (n.quantity) f.push({ label: "Amount", value: amount(n.quantity.amount, n.quantity.unit) });
  if (n.deliverBy) f.push({ label: "Deliver by", value: day(n.deliverBy) });
  if (n.item?.attributes?.length) f.push({ label: "Must be", value: n.item.attributes.map(attr).join(", ") });
  if (n.item?.excludedAttributes?.length) f.push({ label: "Must not be", value: n.item.excludedAttributes.map(attr).join(", ") });
  if (n.requiredClaims?.length) f.push({ label: "Must carry", value: n.requiredClaims.map(attr).join(", ") });
  if (n.forbiddenAllergens?.length) f.push({ label: "No allergens", value: n.forbiddenAllergens.map(attr).join(", ") });
  if (n.optimise) f.push({ label: "Matters most", value: OPTIMISE[n.optimise] ?? n.optimise.replaceAll("_", " ") });
  if (n.sameAsLastTime) f.push({ label: "Repeat", value: "same as last time" });
  if (n.item?.productId) f.push({ label: "Named product", value: n.item.productId });
  return f;
}

const CONCERN_KIND: Record<string, string> = {
  quantity_tenfold: "the amount is about ten times the kitchen's usual",
  quantity_unusual: "the amount is unusual for this kitchen",
  unit_confusion: "the unit may be mixed up",
  unit_unclear: "the unit is unclear",
  duplicate_recent: "it may repeat a recent order",
  delivery_in_past: "the delivery date is in the past",
  delivery_not_delivery_day: "the kitchen takes no deliveries that day",
  delivery_after_cutoff: "the order cut-off for that day has passed",
  contradicts_preference: "it contradicts one of the kitchen's own rules",
  large_first_order: "a large first order",
  nothing_to_repeat: "there is no earlier order to repeat",
};

function actorOf(actor: string, approverNames: Map<string, string>): string {
  if (actor === "dock") return "Dock";
  if (actor.startsWith("agent:")) return "Buyer agent";
  if (actor.startsWith("buyer:")) return actor.slice(6);
  if (actor.startsWith("operator:")) return `Operations (${actor.slice(9)})`;
  if (actor.startsWith("approver:")) {
    const role = actor.slice(9);
    return approverNames.get(role) ?? roleLabel(role).replace(/^./, (c) => c.toUpperCase());
  }
  return "Unknown caller";
}

function offerNote(o: Record<string, unknown>): { note: string; tone: "plain" | "safety" } {
  const parts: string[] = [];
  const price = typeof o.unitPriceCents === "number" ? `${eur(o.unitPriceCents)} per pack` : undefined;
  if (price) parts.push(price);
  const packs = typeof o.availablePacks === "number" ? o.availablePacks : undefined;
  if (packs !== undefined) parts.push(packs >= SENTINEL_STOCK ? "stock not reported" : packs === 0 ? "none in stock" : `${packs.toLocaleString("en-US")} packs`);
  if (typeof o.deliveryDate === "string") parts.push(`delivery ${day(o.deliveryDate)}`);
  const cutoffPassed = o.cutoffPassed === true;
  if (cutoffPassed) parts.push("order cut-off passed");
  else if (typeof o.orderBy === "string") parts.push(`order by ${day(o.orderBy.slice(0, 10))} ${o.orderBy.length > 10 ? clock(o.orderBy) : ""}`.trim());
  return { note: parts.join(", "), tone: packs === 0 || cutoffPassed ? "safety" : "plain" };
}

export function buildTrace(input: TraceInput): Trace {
  const names = input.names ?? {};
  const name = (id: string) => (names[id] ? shortProduct(names[id]) : id);
  const say = (t: string) => humanize(t, names);
  const entries = [...input.entries].filter((e) => e.requestId === input.requestId).sort((a, b) => a.seq - b.seq);
  const orders = (input.orders ?? []).filter((o) => o.requestId === input.requestId);
  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const approverNames = new Map<string, string>();
  for (const o of orders) if (o.approval) approverNames.set(o.approval.approver.role, o.approval.approver.name);

  const request = entries.find((e) => e.type === "request");
  const steps: TraceStep[] = [];
  const considered = new Set<string>();
  const priced = new Set<string>();
  const lastDecisionSeq = new Map<string, number>();
  for (const e of entries) if (e.type === "decision" && e.orderId) lastDecisionSeq.set(e.orderId, e.seq);

  for (const e of entries) {
    const d = e.data as Record<string, unknown>;
    const base = {
      seq: e.seq,
      at: e.at,
      actor: actorOf(e.actor, approverNames),
      facts: [] as { label: string; value: string }[],
      lines: [] as string[],
      tone: "plain" as TraceStep["tone"],
      ledger: { seq: e.seq, hash: e.hash, prevHash: e.prevHash, type: e.type, actor: e.actor, summary: e.summary },
    };
    const push = (s: Omit<TraceStep, keyof typeof base> & Partial<typeof base>) => steps.push({ ...base, ...s } as TraceStep);
    const memory = memoryParts(e);

    switch (e.type) {
      case "request": {
        const text = String(d.text ?? "");
        push({
          phase: "asked",
          title: "The kitchen asked, in its own words",
          lines: [`“${text}”`],
          facts: typeof d.neededBy === "string" ? [{ label: "Needed by", value: day(d.neededBy) }] : [],
        });
        break;
      }
      case "intake": {
        const step = d.step;
        if (step === "need") {
          const need = (d.need ?? {}) as Need;
          push({ phase: "understood", title: `Understood as ${describeNeedPlain(need)}`, facts: needFacts(need), lines: typeof d.by === "string" ? [`Relayed for ${d.by}.`] : [] });
        } else if (step === "concerns") {
          const concerns = (Array.isArray(d.concerns) ? d.concerns : []) as { code?: string; severity?: string }[];
          push({
            phase: "checked",
            tone: "safety",
            title: `Stopped before any price lookup: ${concerns.length === 1 ? "a likely mistake" : `${concerns.length} likely mistakes`} for the kitchen to confirm`,
            lines: concerns.map((c) => `Checked against the kitchen's own order history: ${CONCERN_KIND[c.code ?? ""] ?? "something looks wrong"}.`),
            memory,
          });
        } else if (step === "confirmation" || step === "correction" || step === "cancelled") {
          const who = typeof d.by === "string" ? d.by : base.actor;
          const kind = CONCERN_KIND[String(d.code ?? "")];
          const title =
            step === "confirmation" ? `${who} confirmed it is meant` : step === "correction" ? `${who} corrected the request` : `${who} cancelled the request`;
          const lines = [kind ? `About: ${kind}.` : say(e.summary)];
          if (step === "correction" && typeof d.after === "string") lines.push(`Now: ${say(d.after)}.`);
          push({ phase: "answered", tone: "safety", title, lines, memory });
        } else if (step === "questions") {
          const fromMemory = memoryCount(d.reasons);
          const qs = say(e.summary.replace(/^Dock asked \d+ questions?: /, "")).split(" / ");
          push({
            phase: "checked",
            tone: "safety",
            title: `Asked the kitchen ${qs.length === 1 ? "one question" : `${qs.length} questions`} that change the outcome`,
            lines: [...qs.map((q) => `“${q}”`), ...(fromMemory ? [`${fromMemory} other answer${fromMemory > 1 ? "s" : ""} came from the kitchen's own memory, so it was not asked.`] : [])],
            memory,
          });
        } else if (step === "answer") {
          push({ phase: "answered", tone: "safety", title: `${typeof d.by === "string" ? d.by : base.actor} answered`, lines: [say(e.summary.replace(/^.+? answered /, "")).replace(/^"/, "“").replace(/": /, "”: ")] });
        } else if (step === "options" || step === "no_options") {
          const options = (Array.isArray(d.options) ? d.options : []) as { optionId: string; labels?: string[]; totalCents?: number; lines?: { productId: string; quantity: number; substituteFor?: string }[] }[];
          const excluded = (Array.isArray(d.excluded) ? d.excluded : []) as { productId: string; reason: string }[];
          for (const x of excluded) considered.add(x.productId);
          for (const o of options) for (const l of o.lines ?? []) considered.add(l.productId);
          const products: ProductRow[] = options.map((o) => ({
            id: o.optionId,
            name: `${o.optionId.replace(/^opt_/, "Option ")}${o.labels?.length ? `: ${o.labels.map((l) => l.replaceAll("_", " ")).join(", ")}` : ""}`,
            note: [
              (o.lines ?? []).map((l) => `${l.quantity} × ${name(l.productId)}${l.substituteFor ? ` (in place of ${name(l.substituteFor)})` : ""}`).join(" + "),
              typeof o.totalCents === "number" ? eur(o.totalCents) : "",
            ]
              .filter(Boolean)
              .join(", "),
          }));
          const fromMemory = memoryCount(d.reasons);
          const noReasons = step === "no_options" ? publicReasons(d.reasons).map((r) => {
            const [id, ...rest] = r.split(": ");
            return { productId: id, reason: rest.join(": ") };
          }) : [];
          const allExcluded = excluded.length ? excluded : noReasons;
          for (const x of noReasons) considered.add(x.productId);
          push({
            phase: "options",
            tone: "plain",
            title:
              step === "options"
                ? `Built ${options.length === 1 ? "one option" : `${options.length} options`}; ruled out ${allExcluded.length} product${allExcluded.length === 1 ? "" : "s"}`
                : `No option fits: ruled out ${allExcluded.length} product${allExcluded.length === 1 ? "" : "s"}`,
            lines: step === "no_options" ? [say(e.summary.replace(/^Dock found no option: /, ""))] : fromMemory ? [`Ranked with ${fromMemory} preference${fromMemory > 1 ? "s" : ""} from the kitchen's own memory (kept private to the kitchen).`] : [],
            products,
            excluded: groupExclusions(allExcluded, name),
            memory,
          });
        } else if (step === "choice") {
          const labels = Array.isArray(d.labels) ? (d.labels as string[]).map((l) => l.replaceAll("_", " ")) : [];
          const who = typeof d.by === "string" ? d.by.replace(/^agent agent_[\w]+$/, "the agent") : base.actor;
          push({ phase: "chosen", title: `${who === "the agent" ? "The agent" : who} chose ${String(d.optionId ?? "an option").replace(/^opt_/, "option ")}${labels.length ? ` (${labels.join(", ")})` : ""}`, lines: [] });
        } else {
          push({ phase: "other", title: say(e.summary), memory });
        }
        break;
      }
      case "lookup": {
        if (d.source === "live") {
          const offers = (Array.isArray(d.offers) ? d.offers : []) as Record<string, unknown>[];
          const ids = (Array.isArray(d.productIds) ? d.productIds : []) as string[];
          for (const id of ids) {
            priced.add(id);
            considered.add(id);
          }
          const rows: ProductRow[] = ids.map((id) => {
            const o = offers.find((x) => x.productId === id);
            if (!o) return { id, name: name(id), note: "no offer", tone: "safety" as const };
            const { note, tone } = offerNote(o);
            return { id, name: name(id), note, tone };
          });
          push({
            phase: "priced",
            title: `Checked live price and availability for ${ids.length === 1 ? "one product" : `${ids.length} products`}`,
            lines: ["The wholesaler's live price service saw only this short list."],
            products: rows,
          });
        } else {
          const result = (Array.isArray(d.resultIds) ? d.resultIds : []) as string[];
          for (const id of result) considered.add(id);
          const q = (d.query ?? {}) as { text?: string; category?: string; attributes?: string[] };
          const filter = [q.text && `“${q.text}”`, q.category && `in ${q.category.replaceAll("_", " ")}`, q.attributes?.length && q.attributes.map(attr).join(", ")].filter(Boolean).join(", ");
          push({
            phase: "searched",
            title: `Searched product master data${filter ? ` for ${filter}` : ""}: ${result.length} product${result.length === 1 ? "" : "s"}`,
            lines: ["Local and free: no call to the live price service."],
            products: result.slice(0, 8).map((id) => ({ id, name: name(id) })),
            facts: result.length > 8 ? [{ label: "Not listed", value: `${result.length - 8} more` }] : [],
          });
        }
        break;
      }
      case "quote": {
        const lines = (Array.isArray(d.lines) ? d.lines : []) as { productId: string; quantity: number; unitPriceCents: number; substituteFor?: string }[];
        push({
          phase: "quoted",
          title: `The wholesaler fixed the price: ${eur(Number(d.totalCents ?? 0))}`,
          lines: typeof d.expiresAt === "string" ? [`The price holds until ${clock(d.expiresAt)} Helsinki time, signed with the wholesaler's key.`] : [],
          products: lines.map((l) => ({
            id: l.productId,
            name: name(l.productId),
            note: `${l.quantity} packs at ${eur(l.unitPriceCents)}${l.substituteFor ? `, in place of ${name(l.substituteFor)}` : ""}`,
            tone: l.substituteFor ? ("safety" as const) : ("plain" as const),
          })),
          facts: typeof d.quoteId === "string" ? [{ label: "Quote", value: d.quoteId }] : [],
        });
        break;
      }
      case "decision": {
        const order = e.orderId ? orderById.get(e.orderId) : undefined;
        const latest = order && lastDecisionSeq.get(order.orderId) === e.seq;
        const reasonOf = new Map<string, string>((latest ? order.decision.rules : []).map((r) => [r.rule, r.reason]));
        const rules = (Array.isArray(d.rules) ? d.rules : []) as { rule: string; outcome: Check["outcome"] }[];
        const checks: Check[] = rules.map((r) => ({ rule: r.rule, title: ruleTitleOf(r.rule), outcome: r.outcome, reason: reasonOf.get(r.rule) && say(reasonOf.get(r.rule)!) }));
        const recheck = /^Re-check/.test(e.summary);
        const approver = d.approver as { name?: string; role?: string } | undefined;
        const failed = checks.find((c) => c.outcome === "fail");
        const title =
          d.outcome === "auto_approve"
            ? `${recheck ? "Re-checked at sign-off" : "The gate passed it"}: all ${checks.length} checks, within what the agent may spend alone`
            : d.outcome === "needs_human_approval"
              ? `The gate sent it to a person: ${approver?.name ?? "someone"}${approver?.role ? ` (${roleLabel(approver.role)})` : ""} must sign off`
              : `${recheck ? "Re-checked at sign-off and refused" : "The gate refused it"}: ${failed ? failed.title.toLowerCase() : "a rule failed"}`;
        push({
          phase: "gate",
          tone: d.outcome === "auto_approve" ? "plain" : "safety",
          title,
          lines: publicReasons(d.reasons).filter((r) => d.outcome !== "auto_approve").map(say),
          checks,
          facts: [{ label: "Total", value: eur(Number(d.totalCents ?? 0)) }],
        });
        break;
      }
      case "approval_requested": {
        const order = e.orderId ? orderById.get(e.orderId) : undefined;
        const who = order?.approval?.approver;
        push({
          phase: "signoff",
          tone: "safety",
          title: `Asked ${who ? `${who.name} (${roleLabel(who.role)})` : "the named person"} to sign off on their phone`,
          lines: ["A one-time link went to them, not to the agent. The agent cannot sign off its own order.", ...(order?.status === "pending_approval" ? ["Waiting for them now."] : [])],
          facts: typeof d.orderDigest === "string" ? [{ label: "Covers exactly", value: `order digest ${d.orderDigest.slice(0, 12)}…` }] : [],
        });
        break;
      }
      case "approval": {
        const signOff = (d.signOff ?? {}) as { method?: string; verified?: boolean; at?: string; credentialId?: string };
        const order = e.orderId ? orderById.get(e.orderId) : undefined;
        const who = order?.approval?.approver.name ?? /^(.+?) \(/.exec(e.summary)?.[1] ?? base.actor;
        const how =
          signOff.method === "passkey"
            ? "with the passkey on their phone (Face ID or fingerprint), verified by Dock"
            : signOff.method === "link_token"
              ? "through the one-time link sent only to them"
              : signOff.method === "demo_tap"
                ? "with a demo tap: recorded as not verified"
                : `by ${String(signOff.method ?? "an unknown method").replaceAll("_", " ")}`;
        push({
          phase: "signoff",
          tone: "safety",
          actor: who,
          title: `${who} ${d.decision === "approved" ? "approved" : "declined"} it, ${how}`,
          lines: [typeof d.note === "string" && d.note ? `Note: “${d.note}”` : "", "The proof covers exactly this order's lines, prices and total; a changed order would not match."].filter(Boolean),
          facts: [
            { label: "Proof", value: signOff.verified ? "verified" : "not verified" },
            ...(signOff.at ? [{ label: "Signed at", value: clock(signOff.at) }] : []),
          ],
        });
        break;
      }
      case "order": {
        const by = (d.authorisedBy ?? {}) as { kind?: string; name?: string; role?: string };
        const head = d.ledgerHead as { seq?: number } | null | undefined;
        const order = e.orderId ? orderById.get(e.orderId) : undefined;
        push({
          phase: "committed",
          tone: "done",
          title: `Committed at the quoted ${order ? eur(order.totalCents) : "price"}; the wholesaler signed the confirmation`,
          lines: [by.kind === "approver" ? `Authorised by ${by.name}${by.role ? ` (${roleLabel(by.role)})` : ""}.` : "Authorised by the mandate alone: within what the agent may spend."],
          facts: [
            ...(order ? [{ label: "Order", value: order.orderId }] : []),
            ...(head && typeof head.seq === "number" ? [{ label: "Anchors ledger at", value: `entry ${head.seq}` }] : []),
          ],
        });
        break;
      }
      case "refusal": {
        const rule = typeof d.rule === "string" ? d.rule : undefined;
        push({
          phase: "refused",
          tone: "safety",
          title: `Refused: ${rule ? ruleTitleOf(rule).toLowerCase() : "a check before the gate"}`,
          lines: [say(e.summary.replace(/^Refused: /, ""))],
          facts: typeof d.code === "string" ? [{ label: "Code", value: d.code }] : [],
        });
        break;
      }
      default:
        push({ phase: e.type === "control" ? "control" : "other", title: say(e.summary) });
    }
  }

  // The order records carry what the ledger alone does not (e.g. a declined order without an entry of its own).
  const last = orders.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const intakeEnd = [...entries].reverse().find((e) => e.type === "intake");
  const lastEntry = entries.at(-1);
  let outcome: TraceOutcome = { kind: "open", label: "Still in progress" };
  if (last?.status === "committed") outcome = { kind: "committed", label: last.approval ? `Signed order, approved by ${last.approval.approver.name}` : "Signed order, within the agent's mandate" };
  else if (last?.status === "pending_approval") outcome = { kind: "waiting", label: `Waiting for ${last.approval?.approver.name ?? "a person"} to sign off` };
  else if (last?.status === "declined") outcome = { kind: "declined", label: `Declined by ${last.approval?.approver.name ?? "the approver"}` };
  else if (last?.status === "rejected") outcome = { kind: "refused", label: `Refused by the gate: ${ruleTitleOf(last.decision.rules.find((r) => r.outcome === "fail")?.rule ?? "").toLowerCase()}` };
  else if (lastEntry?.type === "refusal") outcome = { kind: "refused", label: `Refused: ${ruleTitleOf(String(lastEntry.data.rule ?? "")).toLowerCase()}` };
  else if (intakeEnd?.data.step === "cancelled") outcome = { kind: "cancelled", label: "Cancelled by the kitchen" };
  else if (intakeEnd?.data.step === "no_options") outcome = { kind: "open", label: "No option fits the rules" };

  const orgFromSummary = request && / of (.+?) opened a request/.exec(request.summary)?.[1];
  return {
    requestId: input.requestId,
    orgName: input.orgName ?? last?.orgName ?? orgFromSummary ?? "Unknown organisation",
    agentId: request?.actor.replace(/^agent:/, "") ?? last?.agentId ?? "unknown",
    via: input.via,
    asked: String(request?.data.text ?? ""),
    neededBy: typeof request?.data.neededBy === "string" ? request.data.neededBy : undefined,
    startedAt: entries[0]?.at ?? "",
    endedAt: lastEntry?.at ?? "",
    outcome,
    steps: withUntouched(steps, input.catalogueSize),
    orderIds: orders.map((o) => o.orderId),
    considered: considered.size,
    priced: priced.size,
    catalogueSize: input.catalogueSize,
  };
}

/** On each live check, say how much of the catalogue the live service never saw (so far, for this request). */
function withUntouched(steps: TraceStep[], catalogueSize: number | undefined): TraceStep[] {
  if (!catalogueSize) return steps;
  const seen = new Set<string>();
  return steps.map((s) => {
    if (s.phase !== "priced") return s;
    for (const p of s.products ?? []) seen.add(p.id);
    const rest = Math.max(0, catalogueSize - seen.size);
    return { ...s, untouched: `The other ${rest.toLocaleString("en-US")} products in the catalogue were not sent to the live service.` };
  });
}
