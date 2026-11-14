import type { LiveOffer, Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import type { LedgerEntryType } from "@/core/ledger";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { RELIABILITY_WARN, backupCandidates, chooseForKitchen, deliveryRecordOf, poorRecords, type DeliveryRecord } from "@/core/reliability";
import { measureOf, type RankedSubstitute } from "@/core/watch";
import { formatEur, newId } from "@/core/util";
import type { RecordStore } from "../records";
import type { Runtime } from "../runtime";

/**
 * A backup lined up in advance for a product with a poor delivery record (core/reliability.ts). Only for products the
 * wholesaler's own history says were short more than one time in ten; a product with a good record, or none, says
 * nothing. Nothing extra is bought when a backup is lined up: it is a standing instruction on the order, with who
 * chose it. When the kitchen agent's watch later finds the product cannot come (server/watch), the backup is ordered
 * through the gate by itself (within the mandate and the kitchen's preferences it commits; otherwise it goes to the
 * person the mandate names), and reported in one sentence: no second question.
 *
 *   offerBackups   for a quote's or an order's lines: the poor-record products, each with up to three alternatives
 *                  (the watch's good/better/best with their own record and the gate's preview of each)
 *   setBackup      the kitchen's choice (a product, or "you choose": the best inside its preferences); declineBackup
 *   useBackup      called by the watch on a finding: orders the chosen backup, records it (ledger `watch`,
 *                  step backup_used: the event the order emails pick up, see backupEvents)
 */

export type BackupAlternative = RankedSubstitute & { record?: DeliveryRecord; gate?: { outcome: string; reasons: string[] } };

export type Backup = {
  backupId: string;
  orgId: string;
  kitchen: string;
  kitchenName: string;
  product: { productId: string; name: string; family: string };
  record: DeliveryRecord;
  need: { date: string; packs: number; amount: number; unit: string };
  requestId?: string;
  orderId?: string;
  alternatives: BackupAlternative[];
  state: "offered" | "set" | "declined" | "used";
  chosen?: { productId: string; name: string; insidePreferences: boolean; how: "picked" | "you_choose"; by: string; via: string; at: string };
  used?: { at: string; findingId: string; staged: boolean; requestId?: string; orderId?: string; status?: PublicOrder["status"]; totalCents?: number; approver?: string; refused?: { code: string; rule?: string; message: string } };
  at: string;
  saidAt?: string;
};

type State = { backups: Map<string, Backup>; store: RecordStore<Backup>; restored: Promise<void> };
const g = globalThis as typeof globalThis & { __dockBackups?: WeakMap<Runtime, State> };
const states = (g.__dockBackups ??= new WeakMap());

function stateOf(rt: Runtime): State {
  let s = states.get(rt);
  if (s) return s;
  const store = rt.records<Backup>("watch_backups");
  const st: State = { backups: new Map(), store, restored: Promise.resolve() };
  st.restored = (async () => {
    for (const b of await store.list()) st.backups.set(b.backupId, b);
  })().catch((err) => console.error("[backups] restore", err));
  states.set(rt, (s = st));
  return s;
}
async function ready(rt: Runtime) {
  const s = stateOf(rt);
  await s.restored;
  return s;
}
const save = (s: State, b: Backup) => (s.backups.set(b.backupId, b), void s.store.put(b.backupId, b));

function ledger(rt: Runtime, entry: { actor: string; summary: string; requestId?: string; orderId?: string; data: Record<string, unknown> }) {
  rt.dock.ledger.append({ type: "watch" as LedgerEntryType, ...entry });
}

/** The threshold: DOCK_RELIABILITY_WARN (0 to 1), else core/reliability.ts RELIABILITY_WARN. */
export function warnLevel(): number {
  const v = Number(process.env.DOCK_RELIABILITY_WARN);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : RELIABILITY_WARN;
}

export type OrderLine = { productId: string; quantity: number; unitPriceCents?: number; deliveryDate: string };

/**
 * The poor-record products on these lines, each with its alternatives, recorded as offered (one per product and
 * request or order; asked again, the same). Costs one live call per poor product for the alternatives' prices, and
 * none when no product on the order has a poor record (master data only).
 */
export async function offerBackups(rt: Runtime, session: AgentSession, input: { requestId?: string; orderId?: string; lines: OrderLine[]; now?: Date }): Promise<Backup[]> {
  const s = await ready(rt);
  const warn = warnLevel();
  const products = await rt.catalog.searchProducts({ ids: [...new Set(input.lines.map((l) => l.productId))], limit: 50 });
  const lines = input.lines.flatMap((l) => {
    const product = products.find((p) => p.id === l.productId);
    return product ? [{ ...l, product }] : [];
  });
  const poor = poorRecords(lines, warn);
  if (!poor.length) return [];
  const orgId = session.mandate.issuer.orgId;
  const out: Backup[] = [];
  const w = await import("../watch/service");
  const k = await w.kitchenOfSession(rt, session);
  for (const l of poor.slice(0, 3)) {
    const same = [...s.backups.values()].find((b) => b.orgId === orgId && b.product.productId === l.productId && ((input.orderId && b.orderId === input.orderId) || (input.requestId && b.requestId === input.requestId)));
    if (same) {
      if (input.orderId && !same.orderId) save(s, { ...same, orderId: input.orderId });
      out.push(s.backups.get(same.backupId)!);
      continue;
    }
    out.push(await offerOne(rt, s, session, k, l, l.record, warn, input));
  }
  return out;
}

async function offerOne(rt: Runtime, s: State, session: AgentSession, k: Awaited<ReturnType<typeof import("../watch/service")["kitchenOfSession"]>>, l: OrderLine & { product: Product }, record: DeliveryRecord, warn: number, input: { requestId?: string; orderId?: string; now?: Date }): Promise<Backup> {
  const w = await import("../watch/service");
  const p = l.product;
  const m = measureOf(p);
  const amount = Math.round(l.quantity * (m?.perPack ?? p.packSize) * 100) / 100;
  // The usual here is this line's own price per unit of the product (the trade-off converts pieces to litres or kilos).
  const usual = l.unitPriceCents ? Math.round((l.unitPriceCents / p.packSize) * 10) / 10 : null;
  const requestId = input.requestId ?? (await rt.dock.openRequest(session, { text: `Backups for ${p.name}` })).requestId;
  const subs = await w.substitutesFor(rt, k, session, requestId, p, { productId: p.id, name: p.name, family: p.category, source: "order", date: l.deliveryDate, amount: Math.round(l.quantity * p.packSize * 100) / 100, unit: p.unit, ...(input.orderId ? { orderId: input.orderId } : {}) }, usual);
  const byId = new Map((await rt.catalog.searchProducts({ ids: subs.ranked.map((r) => r.productId), limit: 20 })).map((x) => [x.id, x]));
  const alts: BackupAlternative[] = backupCandidates(record, subs.ranked, (id) => (byId.get(id) ? deliveryRecordOf(byId.get(id)!, warn) : undefined));
  // The gate's preview of each, as it would decide the backup ordered in this order's place.
  for (const a of alts) {
    const offer: LiveOffer | undefined = subs.offers.get(a.productId);
    if (!offer) continue;
    const d = await rt.dock.previewDecision(session, requestId, [{ productId: a.productId, quantity: a.tradeOff.packs, substituteFor: p.id }], [offer]).catch(() => undefined);
    if (d) a.gate = { outcome: d.outcome, reasons: d.reasons.filter((x) => !x.startsWith("Sent to ")) };
  }
  const b: Backup = {
    backupId: newId("bk"),
    orgId: session.mandate.issuer.orgId,
    kitchen: k.slug,
    kitchenName: k.name,
    product: { productId: p.id, name: p.name, family: p.category },
    record,
    need: { date: l.deliveryDate, packs: l.quantity, amount, unit: m?.unit ?? p.unit },
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    alternatives: alts,
    state: "offered",
    at: (input.now ?? new Date()).toISOString(),
  };
  save(s, b);
  ledger(rt, {
    actor: `agent:${session.agentId}`,
    ...(b.requestId ? { requestId: b.requestId } : {}),
    ...(b.orderId ? { orderId: b.orderId } : {}),
    summary: `${p.name} ${record.words} (the wholesaler's delivery history: ${Math.round(record.share * 100)} %, below the ${Math.round(warn * 100)} % line): ${alts.length ? `a backup can be lined up: ${alts.map((a) => `${a.rank} ${a.name}${a.record ? ` (${a.record.words})` : " (no delivery figure)"}`).join("; ")}` : "no alternative with a better record can come by that day"}. Nothing is bought unless the kitchen chooses one and the product then cannot come.`,
    data: { step: "backup_offered", backupId: b.backupId, productId: p.id, deliveryDate: l.deliveryDate, record, alternatives: alts.map((a) => ({ rank: a.rank, productId: a.productId, record: a.record?.share, insidePreferences: a.insidePreferences, gate: a.gate?.outcome })) },
  });
  return b;
}

export type Who = { by: string; via: string; now?: Date };

async function own(rt: Runtime, orgId: string, backupId: string): Promise<Backup> {
  const b = (await ready(rt)).backups.get(backupId);
  if (!b || b.orgId !== orgId) throw new DockError(404, "backup_not_found", `No backup ${backupId} for this organisation.`);
  return b;
}

/**
 * The kitchen's choice: one of the alternatives, or "best" ("you choose": the best inside the kitchen's preferences;
 * when none is, nothing is set and the answer says so). A standing instruction on the order; nothing is bought now.
 */
export async function setBackup(rt: Runtime, session: AgentSession, backupId: string, choice: { productId: string } | "best", who: Who): Promise<Backup> {
  const s = await ready(rt);
  const b = await own(rt, session.mandate.issuer.orgId, backupId);
  if (b.state === "used") throw new DockError(409, "backup_used", `The backup for ${b.product.name} was already used.`);
  const alt = choice === "best" ? chooseForKitchen(b.alternatives) : b.alternatives.find((a) => a.productId === choice.productId);
  if (!alt) throw new DockError(choice === "best" ? 409 : 400, choice === "best" ? "no_backup_inside_preferences" : "invalid_choice", choice === "best" ? `None of the alternatives for ${b.product.name} is inside the kitchen's preferences: a person picks one (${b.alternatives.map((a) => a.productId).join(", ") || "none can come"}).` : `${choice.productId} is not one of the alternatives for ${b.product.name}.`);
  const at = (who.now ?? new Date()).toISOString();
  const done: Backup = { ...b, state: "set", chosen: { productId: alt.productId, name: alt.name, insidePreferences: alt.insidePreferences, how: choice === "best" ? "you_choose" : "picked", by: who.by, via: who.via, at } };
  save(s, done);
  ledger(rt, {
    actor: `buyer:${b.orgId}`,
    ...(b.requestId ? { requestId: b.requestId } : {}),
    ...(b.orderId ? { orderId: b.orderId } : {}),
    summary: `${who.by} lined up ${alt.name} as the backup for ${b.product.name} on ${b.need.date}${choice === "best" ? " (\"you choose\": the best inside the kitchen's preferences)" : ""}, via ${who.via}. Nothing extra is bought now; if ${b.product.name} cannot come, the agent orders the backup ${alt.insidePreferences ? "by itself, within the mandate" : "and it goes to the person the mandate names for sign-off"}.`,
    data: { step: "backup_set", backupId, productId: b.product.productId, deliveryDate: b.need.date, choice: alt.productId, how: done.chosen!.how, by: who.by, via: who.via },
  });
  return done;
}

export async function declineBackup(rt: Runtime, session: AgentSession, backupId: string, who: Who): Promise<Backup> {
  const s = await ready(rt);
  const b = await own(rt, session.mandate.issuer.orgId, backupId);
  const done: Backup = { ...b, state: "declined" };
  save(s, done);
  ledger(rt, { actor: `buyer:${b.orgId}`, summary: `${who.by} wanted no backup for ${b.product.name} on ${b.need.date} (via ${who.via}).`, data: { step: "backup_declined", backupId, productId: b.product.productId, by: who.by } });
  return done;
}

/** The backup lined up for this product and day (or for the order the product is on), if any. */
export async function backupFor(rt: Runtime, orgId: string, productId: string, date: string, orderId?: string): Promise<Backup | undefined> {
  const s = await ready(rt);
  return [...s.backups.values()].find((b) => b.orgId === orgId && b.state === "set" && b.product.productId === productId && (b.need.date === date || (!!orderId && b.orderId === orderId)));
}

/**
 * The watch found the product cannot come: order the backup the kitchen lined up, through the gate, without asking
 * again. Records it on the backup and the finding, and in the ledger (step backup_used: the "something changed"
 * event). Returns undefined when no backup was lined up.
 */
export async function useBackup(rt: Runtime, finding: import("../watch/service").Finding): Promise<Backup | undefined> {
  const b = await backupFor(rt, finding.orgId, finding.product.productId, finding.need.date, finding.need.orderId);
  if (!b || !b.chosen) return undefined;
  const s = await ready(rt);
  const w = await import("../watch/service");
  const k = await w.watchKitchen(rt, finding.kitchen);
  const session = await w.sessionOf(rt, k);
  const alt = b.alternatives.find((a) => a.productId === b.chosen!.productId);
  const packs = alt?.tradeOff.packs ?? b.need.packs;
  const placed = await w.placeThroughGate(rt, session, { text: `${b.product.name} cannot come for ${finding.need.date}${finding.staged ? " (STAGED for the demo)" : ""}: the backup ${b.chosen.by} lined up, ${b.chosen.name}`, date: finding.need.date, productId: b.chosen.productId, packs, substituteFor: b.product.productId });
  const at = new Date().toISOString();
  const used: Backup = {
    ...b,
    state: "used",
    used: { at, findingId: finding.findingId, staged: finding.staged, ...(placed.requestId ? { requestId: placed.requestId } : {}), ...(placed.order ? { orderId: placed.order.orderId, status: placed.order.status, totalCents: placed.order.totalCents, ...(placed.order.approval ? { approver: `${placed.order.approval.approver.name}` } : {}) } : {}), ...(placed.refused ? { refused: placed.refused } : {}) },
  };
  save(s, used);
  w.decideFinding(rt, finding, { at, by: `the agent (the backup ${b.chosen.by} lined up)`, via: "backup", action: placed.order ? (placed.order.status === "committed" ? "ordered_alone" : placed.order.status === "pending_approval" ? "sent_for_sign_off" : "refused") : "refused", productId: b.chosen.productId, ...w.findingOutcome(placed) });
  ledger(rt, {
    actor: `agent:${session.agentId}`,
    ...(placed.requestId ? { requestId: placed.requestId } : {}),
    ...(placed.order ? { orderId: placed.order.orderId } : {}),
    summary: `${finding.staged ? "STAGED: " : ""}${b.product.name} cannot come for ${k.name} on ${finding.need.date}, so the agent ordered the backup ${b.chosen.by} lined up: ${b.chosen.name}${placed.order ? `, ${formatEur(placed.order.totalCents)}, ${placed.order.status === "committed" ? "committed within the mandate" : placed.order.status === "pending_approval" ? `sent to ${used.used!.approver ?? "a person"} for sign-off` : placed.order.status}` : `; the gate refused it (${placed.refused?.rule ?? placed.refused?.code}): ${placed.refused?.message}`}. No second question: the kitchen had decided.`,
    data: { step: "backup_used", backupId: b.backupId, findingId: finding.findingId, productId: b.product.productId, deliveryDate: finding.need.date, choice: b.chosen.productId, by: b.chosen.by, orderId: placed.order?.orderId, outcome: placed.order?.status ?? "refused", staged: finding.staged },
  });
  return used;
}

/** What a kitchen has lined up, and what was used. */
export async function backupsForOrg(rt: Runtime, orgId: string): Promise<Backup[]> {
  return [...(await ready(rt)).backups.values()].filter((b) => b.orgId === orgId).sort((a, b) => b.at.localeCompare(a.at));
}

export async function allBackups(rt: Runtime): Promise<Backup[]> {
  return [...(await ready(rt)).backups.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * "Something changed" events for the order emails (server/notify): every backup used since `since`, with the order
 * it placed and who had lined it up. The same facts are in the ledger (type `watch`, step `backup_used`).
 */
export async function backupEvents(rt: Runtime, since: string): Promise<{ kind: "backup_used"; at: string; orgId: string; kitchen: string; product: string; backup: string; deliveryDate: string; orderId?: string; status?: string; totalCents?: number; approver?: string; staged: boolean; chosenBy: string }[]> {
  return (await allBackups(rt))
    .filter((b) => b.state === "used" && b.used && b.used.at > since)
    .map((b) => ({ kind: "backup_used" as const, at: b.used!.at, orgId: b.orgId, kitchen: b.kitchen, product: b.product.name, backup: b.chosen!.name, deliveryDate: b.need.date, ...(b.used!.orderId ? { orderId: b.used!.orderId, status: b.used!.status, totalCents: b.used!.totalCents } : {}), ...(b.used!.approver ? { approver: b.used!.approver } : {}), staged: b.used!.staged, chosenBy: b.chosen!.by }));
}

export async function markBackupSaid(rt: Runtime, backupId: string): Promise<void> {
  const s = await ready(rt);
  const b = s.backups.get(backupId);
  if (b) save(s, { ...b, saidAt: new Date().toISOString() });
}

/** For the order results over MCP and REST: each poor-record line's record and the backup lined up for it (master data, no live call). */
export async function deliveryRecordsFor(rt: Runtime, orgId: string, lines: { productId: string; deliveryDate?: string }[], ref: { requestId?: string; orderId?: string } = {}): Promise<{ productId: string; deliveryRecord: DeliveryRecord; backup: { backupId: string; state: Backup["state"]; productId?: string; name?: string; chosenBy?: string; alternatives: number } | null }[]> {
  const warn = warnLevel();
  const products = await rt.catalog.searchProducts({ ids: [...new Set(lines.map((l) => l.productId))], limit: 50 });
  const s = await ready(rt);
  const out = [];
  for (const l of lines) {
    const p = products.find((x) => x.id === l.productId);
    const record = p ? deliveryRecordOf(p, warn) : undefined;
    if (!record?.poor) continue;
    const b = [...s.backups.values()].find((x) => x.orgId === orgId && x.product.productId === l.productId && ((ref.orderId && x.orderId === ref.orderId) || (ref.requestId && x.requestId === ref.requestId) || (!!l.deliveryDate && x.need.date === l.deliveryDate)));
    out.push({ productId: l.productId, deliveryRecord: record, backup: b ? { backupId: b.backupId, state: b.state, ...(b.chosen ? { productId: b.chosen.productId, name: b.chosen.name, chosenBy: b.chosen.by } : {}), alternatives: b.alternatives.length } : null });
  }
  return out;
}

/**
 * Adds `deliveryRecords` to a quote or order result (MCP request_quote, place_order, get_order; REST /quotes,
 * /orders): only the lines whose product has a poor delivery record, each with its record and the backup lined up.
 * A quote result carries it beside `quote`; an order carries it inside `order`. Nothing when no line is poor.
 */
export async function withDeliveryRecords<T extends Record<string, unknown>>(rt: Runtime, orgId: string, out: T): Promise<T> {
  try {
    const quote = out.quote as { lines?: { productId: string; deliveryDate?: string }[]; requestId?: string } | undefined;
    const order = out.order as { lines?: { productId: string; deliveryDate?: string }[]; requestId?: string; orderId?: string } | undefined;
    if (order?.lines?.length) {
      const recs = await deliveryRecordsFor(rt, orgId, order.lines, { orderId: order.orderId, requestId: order.requestId });
      if (recs.length) return { ...out, order: { ...order, deliveryRecords: recs } };
    } else if (quote?.lines?.length) {
      const recs = await deliveryRecordsFor(rt, orgId, quote.lines, { requestId: quote.requestId });
      if (recs.length) return { ...out, deliveryRecords: recs };
    }
  } catch (err) {
    console.warn("[backups] delivery records", (err as Error).message);
  }
  return out;
}
