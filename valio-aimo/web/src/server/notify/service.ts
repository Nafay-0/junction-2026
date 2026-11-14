import type { Lang } from "@/app/_i18n/lang";
import { DockError } from "@/core/errors";
import type { DockEvent } from "@/core/events";
import type { LedgerEntry, LedgerEntryType } from "@/core/ledger";
import type { PublicOrder } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import { vatBreakdown } from "@/core/pricing";
import { newId, sha256Hex } from "@/core/util";
import { publicBaseUrl } from "../config";
import type { RecordStore } from "../records";
import type { Runtime } from "../runtime";
import { maskAddress, normalizeAddress } from "./address";
import { CONFIRM_HOURS, readLink, signLink } from "./links";
import type { ChangeKind, ChangedModel, MailKind, MailKitchen, MailModel, ReceiptModel, SignOffModel } from "./model";
import { renderMail } from "./render";
import { ResendTransport, type Delivery, type MailTransport } from "./transport";
import { playingNow } from "../alive/clock";

/**
 * Email to the kitchen (web/docs/mail.md). After the fact and never in the path of an order: the order flow publishes
 * its events (core/events.ts) and writes its ledger as it always did; this module listens to both, and a slow or failing
 * mail service changes nothing about an order.
 *
 *   address   a kitchen may give one notification address, its own choice (off by default). It is used only once it
 *             is confirmed through a signed, expiring link; until then the confirmation is the only mail it gets. The
 *             kitchen changes or removes it at any time, and every mail has a one-click stop link.
 *   events    order placed (the receipt), waiting for sign-off, and what changed: a product that cannot come (the
 *             watch's finding), a substitute ordered in its place, a recurring order held because it drifted, an
 *             order refused, declined, expired or taken back. One mail per event (a key per event, kept here and sent
 *             to Resend as its Idempotency-Key), never twice.
 *   caps      per kitchen per hour (DOCK_MAIL_PER_KITCHEN_HOUR, default 10), for the whole service per 24 hours
 *             (DOCK_MAIL_DAILY, default 90: Resend's free plan sends 100 a day).
 *   ledger    every mail sent, skipped or failed, every address set, confirmed, stopped or removed, is an entry of type
 *             `mail` with the event, the kitchen and the outcome: never the address and never the body.
 *
 * The address is personal data: kept with the kitchen's records (collection `mail_contacts`), shown in full only to
 * the kitchen's own signed-in person, masked (m•••@example.com) everywhere else, never in the ledger, a URL or a log.
 */

// ---------- records ----------

export type ContactState = "pending" | "confirmed" | "stopped" | "removed" | "bounced";

export type Contact = {
  contactId: string;
  orgId: string;
  slug: string;
  kitchenName: string;
  /** Present while it can be used (pending or confirmed); deleted when stopped, removed or bounced. */
  address?: string;
  masked: string;
  lang: Lang;
  state: ContactState;
  setAt: string;
  setBy: string;
  setVia: string;
  confirmedAt?: string;
  endedAt?: string;
  endedBy?: string;
};

export type MailOutcome = "sending" | "sent" | "skipped" | "failed";

export type MailRecord = {
  mailId: string;
  eventKey: string;
  kind: MailKind;
  change?: ChangeKind;
  orgId: string;
  slug: string;
  kitchenName: string;
  contactId?: string;
  maskedTo?: string;
  lang: Lang;
  subject: string;
  at: string;
  outcome: MailOutcome;
  reason?: string;
  providerId?: string;
  attempts?: number;
  delivery?: Delivery;
  orderId?: string;
  /** What it said, as data (never the address): the operations page renders it again for its preview. */
  model: MailModel;
};

type State = {
  contacts: Map<string, Contact>;
  log: Map<string, MailRecord>;
  byEvent: Map<string, string>;
  asked: Set<string>;
  stores: { contacts: RecordStore<Contact>; log: RecordStore<MailRecord>; asked: RecordStore<{ threadId: string; at: string }> };
  restored: Promise<void>;
  transport?: MailTransport | null;
  /** Events for kitchens that gave no address: counted, never recorded (nothing was meant to be sent). */
  noAddress: number;
  attached: boolean;
  /** Mails being sent now, for tests and the ops page. */
  inFlight: Set<Promise<void>>;
};

const states = new WeakMap<Runtime, State>();

function stateOf(rt: Runtime): State {
  let s = states.get(rt);
  if (s) return s;
  const stores = { contacts: rt.records<Contact>("mail_contacts"), log: rt.records<MailRecord>("mail_log"), asked: rt.records<{ threadId: string; at: string }>("mail_thread_asked") };
  const st: State = { contacts: new Map(), log: new Map(), byEvent: new Map(), asked: new Set(), stores, restored: Promise.resolve(), noAddress: 0, attached: false, inFlight: new Set() };
  st.restored = (async () => {
    for (const c of await stores.contacts.list()) st.contacts.set(c.orgId, c);
    for (const r of await stores.log.list()) {
      st.log.set(r.mailId, r);
      st.byEvent.set(r.eventKey, r.mailId);
    }
    for (const a of await stores.asked.list()) st.asked.add(a.threadId);
  })().catch((err: Error) => console.error("[mail] restore", err.message));
  states.set(rt, (s = st));
  return s;
}

async function ready(rt: Runtime): Promise<State> {
  const s = stateOf(rt);
  await s.restored;
  return s;
}

const saveContact = (s: State, c: Contact) => (s.contacts.set(c.orgId, c), void s.stores.contacts.put(c.orgId, c));
const saveRecord = (s: State, r: MailRecord) => (s.log.set(r.mailId, r), s.byEvent.set(r.eventKey, r.mailId), void s.stores.log.put(r.mailId, r));

function ledger(rt: Runtime, entry: { summary: string; orderId?: string; actor?: string; data: Record<string, unknown> }) {
  rt.dock.ledger.append({ type: "mail" as LedgerEntryType, actor: entry.actor ?? "dock", summary: entry.summary, ...(entry.orderId ? { orderId: entry.orderId } : {}), data: entry.data });
}

// ---------- settings ----------

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) && n >= 0 && process.env[name]?.trim() ? Math.floor(n) : fallback;
};

export const mailCaps = () => ({ perKitchenHour: envInt("DOCK_MAIL_PER_KITCHEN_HOUR", 10), daily: envInt("DOCK_MAIL_DAILY", 90) });
/** Address changes a kitchen may make in an hour (each sends one confirmation). */
export const ADDRESS_CHANGES_PER_HOUR = 3;

export const DEFAULT_FROM = "AimoPilot <onboarding@resend.dev>";
export const mailFrom = () => process.env.DOCK_MAIL_FROM?.trim() || DEFAULT_FROM;
/** Resend's shared test sender delivers only to the Resend account's own address (web/docs/mail.md). */
export const senderIsTestOnly = () => /@resend\.dev>?\s*$/i.test(mailFrom());

/** The transport this process uses: Resend with RESEND_API_KEY, none without it. Tests set their own. */
export function transportOf(rt: Runtime): MailTransport | null {
  const s = stateOf(rt);
  if (s.transport !== undefined) return s.transport;
  const key = process.env.RESEND_API_KEY?.trim();
  // Under tests nothing goes out unless a test sets a transport (setMailTransport) or asks for the real one.
  s.transport = key && (!process.env.VITEST || process.env.DOCK_MAIL_TEST_REAL === "1") ? new ResendTransport(key) : null;
  return s.transport;
}

/** For tests and scripts: the transport to use (null: no mail service configured). */
export function setMailTransport(rt: Runtime, t: MailTransport | null): void {
  stateOf(rt).transport = t;
}

// ---------- the kitchen's address ----------

export type KitchenRef = { orgId: string; slug: string; name: string };
export type Who = { by: string; via: string };

export type AddressView = {
  state: ContactState | "none";
  /** The full address: only for the kitchen's own person. */
  address?: string;
  masked?: string;
  lang?: Lang;
  confirmedAt?: string;
  configured: boolean;
  testSenderOnly: boolean;
  /** While pending: how the latest confirmation mail went ("failed"/"skipped": it did not reach the address yet). */
  confirmation?: { outcome: MailOutcome; at: string };
};

export async function addressOf(rt: Runtime, orgId: string, opts: { own: boolean }): Promise<AddressView> {
  const s = await ready(rt);
  const c = s.contacts.get(orgId);
  const base = { configured: !!transportOf(rt), testSenderOnly: senderIsTestOnly() };
  if (!c || c.state === "removed") return { state: "none", ...base };
  const last = c.state === "pending" ? [...s.log.values()].filter((r) => r.orgId === orgId && r.kind === "confirm" && r.contactId === c.contactId).sort((a, b) => b.at.localeCompare(a.at))[0] : undefined;
  return { state: c.state, masked: c.masked, lang: c.lang, ...(c.confirmedAt ? { confirmedAt: c.confirmedAt } : {}), ...(opts.own && c.address ? { address: c.address } : {}), ...base, ...(last ? { confirmation: { outcome: last.outcome, at: last.at } } : {}) };
}

/**
 * The kitchen gives (or changes) its address: kept as pending, and one confirmation mail with a signed link is sent to
 * it. Nothing else is sent until the link is used. Any earlier address stops at once.
 */
export async function setAddress(rt: Runtime, k: KitchenRef, input: string, opts: Who & { lang: Lang; now?: Date }): Promise<{ contact: AddressView; confirmation: MailRecord | undefined }> {
  const s = await ready(rt);
  const now = opts.now ?? new Date();
  const address = normalizeAddress(input);
  if (!address) throw new DockError(400, "invalid_address", "That does not look like an email address.");
  const hourAgo = now.getTime() - 3600_000;
  const recent = [...s.log.values()].filter((r) => r.orgId === k.orgId && r.kind === "confirm" && Date.parse(r.at) > hourAgo).length;
  if (recent >= ADDRESS_CHANGES_PER_HOUR) throw new DockError(429, "mail_address_changes", `An address can be given ${ADDRESS_CHANGES_PER_HOUR} times an hour. Try again later.`, undefined, { retryAfterSeconds: 3600 });
  const prev = s.contacts.get(k.orgId);
  const c: Contact = { contactId: newId("mc"), orgId: k.orgId, slug: k.slug, kitchenName: k.name, address, masked: maskAddress(address), lang: opts.lang, state: "pending", setAt: now.toISOString(), setBy: opts.by, setVia: opts.via };
  saveContact(s, c);
  ledger(rt, { actor: `buyer:${k.orgId}`, summary: `${opts.by} gave ${k.name}'s address for order emails (via ${opts.via})${prev && prev.state !== "removed" ? ", in place of the earlier one" : ""}; a confirmation was sent and nothing else is sent until it is confirmed.`, data: { step: "address_set", kind: "confirm", by: opts.by, via: opts.via } });
  const confirmation = await deliver(rt, { eventKey: `confirm:${c.contactId}`, kind: "confirm", orgId: k.orgId, allowPending: true, model: { kind: "confirm", kitchen: kitchenOf(c), hours: CONFIRM_HOURS, links: { confirm: `${base()}/mail/confirm?t=${signLink({ p: "confirm", o: k.orgId, c: c.contactId }, now)}` } } }, now);
  return { contact: await addressOf(rt, k.orgId, { own: true }), confirmation };
}

/** What a confirmation link is for, without using it (the confirmation page shows it before the kitchen presses confirm). */
export async function peekConfirm(rt: Runtime, token: string | null | undefined, now = new Date()): Promise<{ ok: true; kitchenName: string; masked: string; lang: Lang; confirmed: boolean } | { ok: false }> {
  const s = await ready(rt);
  const claims = readLink(token, "confirm", now);
  const c = claims ? s.contacts.get(claims.o) : undefined;
  if (!claims || !c || c.contactId !== claims.c || !c.address || (c.state !== "pending" && c.state !== "confirmed")) return { ok: false };
  return { ok: true, kitchenName: c.kitchenName, masked: c.masked, lang: c.lang, confirmed: c.state === "confirmed" };
}

/** The kitchen's confirmation link. Only the pending address it was sent to; an earlier link stops working when the address changes. */
export async function confirmAddress(rt: Runtime, token: string | null | undefined, now = new Date()): Promise<{ ok: true; kitchenName: string; masked: string; lang: Lang } | { ok: false; problem: "invalid" | "expired_or_replaced" }> {
  const s = await ready(rt);
  const claims = readLink(token, "confirm", now);
  if (!claims) return { ok: false, problem: "invalid" };
  const c = s.contacts.get(claims.o);
  if (!c || c.contactId !== claims.c || !c.address) return { ok: false, problem: "expired_or_replaced" };
  if (c.state === "confirmed") return { ok: true, kitchenName: c.kitchenName, masked: c.masked, lang: c.lang };
  if (c.state !== "pending") return { ok: false, problem: "expired_or_replaced" };
  saveContact(s, { ...c, state: "confirmed", confirmedAt: now.toISOString() });
  ledger(rt, { actor: `buyer:${c.orgId}`, summary: `${c.kitchenName}'s address for order emails was confirmed from the link sent to it; receipts and alerts go there from now on.`, data: { step: "address_confirmed" } });
  return { ok: true, kitchenName: c.kitchenName, masked: c.masked, lang: c.lang };
}

function end(rt: Runtime, s: State, c: Contact, state: "stopped" | "removed" | "bounced", by: string, now: Date, why: string) {
  const { address: _gone, ...rest } = c; // the address itself is deleted
  void _gone;
  saveContact(s, { ...rest, state, endedAt: now.toISOString(), endedBy: by });
  ledger(rt, { actor: state === "bounced" ? "dock" : `buyer:${c.orgId}`, summary: `${c.kitchenName}'s order emails ${state === "stopped" ? "stopped" : state === "removed" ? "turned off: the address was removed" : "stopped: the mail bounced"} (${why}); the address is deleted.`, data: { step: state === "stopped" ? "stopped" : state === "removed" ? "address_removed" : "address_bounced", by } });
}

/** The kitchen removes its address (the store's page or the conversation). */
export async function removeAddress(rt: Runtime, orgId: string, who: Who, now = new Date()): Promise<AddressView> {
  const s = await ready(rt);
  const c = s.contacts.get(orgId);
  if (c && c.state !== "removed") end(rt, s, c, "removed", who.by, now, `by ${who.by}, via ${who.via}`);
  return addressOf(rt, orgId, { own: true });
}

/** The one-click stop link in every mail (GET from the mail, POST from the List-Unsubscribe header). */
export async function stopByLink(rt: Runtime, token: string | null | undefined, now = new Date()): Promise<{ ok: true; kitchenName: string; masked: string; lang: Lang; already: boolean } | { ok: false }> {
  const s = await ready(rt);
  const claims = readLink(token, "stop", now);
  if (!claims) return { ok: false };
  const c = s.contacts.get(claims.o);
  if (!c || c.contactId !== claims.c) return { ok: false };
  if (c.state !== "confirmed" && c.state !== "pending") return { ok: true, kitchenName: c.kitchenName, masked: c.masked, lang: c.lang, already: true };
  end(rt, s, c, "stopped", "the stop link in an email", now, "from the link in an email");
  return { ok: true, kitchenName: c.kitchenName, masked: c.masked, lang: c.lang, already: false };
}

// ---------- sending ----------

const base = () => publicBaseUrl();
const kitchenOf = (c: Pick<Contact, "orgId" | "slug" | "kitchenName">): MailKitchen => ({ orgId: c.orgId, slug: c.slug, name: c.kitchenName });

export type DeliverInput = { eventKey: string; kind: MailKind; orgId: string; model: MailModel; orderId?: string; /** Only the confirmation may go to a pending address. */ allowPending?: boolean };

function counts(s: State, orgId: string, now: Date) {
  const hour = now.getTime() - 3600_000;
  const day = now.getTime() - 86_400_000;
  let kitchenHour = 0;
  let daily = 0;
  for (const r of s.log.values()) {
    if (r.outcome !== "sent" && r.outcome !== "sending") continue;
    const t = Date.parse(r.at);
    if (t > day) daily += 1;
    if (t > hour && r.orgId === orgId) kitchenHour += 1;
  }
  return { kitchenHour, daily };
}

const KIND_WORD: Record<MailKind, string> = { confirm: "Address confirmation", receipt: "Receipt", sign_off: "Sign-off notice", changed: "Change notice" };
const what = (r: Pick<MailRecord, "kind" | "change" | "orderId">) => `${KIND_WORD[r.kind]}${r.change ? ` (${r.change.replace("_", " ")})` : ""}${r.orderId ? ` for order ${r.orderId}` : ""}`;

/**
 * One mail for one event, at most once. Returns the record (or undefined when the kitchen gave no address: nothing is
 * recorded then). The send itself runs after this returns; `settled(rt)` waits for it.
 */
export async function deliver(rt: Runtime, input: DeliverInput, now = new Date()): Promise<MailRecord | undefined> {
  const s = await ready(rt);
  const known = s.byEvent.get(input.eventKey);
  if (known) return s.log.get(known); // never twice
  const c = s.contacts.get(input.orgId);
  if (!c || c.state === "removed") {
    s.noAddress += 1;
    return undefined;
  }
  const subject = renderMail(input.model, { lang: c.lang, maskedTo: c.masked, settingsUrl: "#" }).subject;
  const rec: MailRecord = { mailId: newId("ml"), eventKey: input.eventKey, kind: input.kind, ...(input.model.kind === "changed" ? { change: input.model.change } : {}), orgId: c.orgId, slug: c.slug, kitchenName: c.kitchenName, contactId: c.contactId, maskedTo: c.masked, lang: c.lang, subject, at: now.toISOString(), outcome: "sending", ...(input.orderId ? { orderId: input.orderId } : {}), model: input.model };
  const skip = (reason: string, step = "skipped") => {
    const r = { ...rec, outcome: "skipped" as const, reason };
    saveRecord(s, r);
    ledger(rt, { orderId: input.orderId, summary: `${what(r)} to ${c.kitchenName}: not sent: ${reason}.`, data: { step, kind: r.kind, eventKey: r.eventKey, outcome: "skipped", reason } });
    return r;
  };
  // The sample activity (server/alive): recorded with its preview, never sent, never counted against the caps.
  if (playingNow()) return skip("sample activity: recorded with its preview, not sent");
  if (c.state === "stopped") return skip("the kitchen stopped these emails");
  if (c.state === "bounced") return skip("the kitchen's address bounced; it has to give one again");
  if (c.state === "pending" && !input.allowPending) return skip("the kitchen's address is not confirmed yet");
  const caps = mailCaps();
  const used = counts(s, c.orgId, now);
  if (used.kitchenHour >= caps.perKitchenHour) return skip(`this kitchen's hourly cap of ${caps.perKitchenHour} mails is reached`, "capped");
  if (used.daily >= caps.daily) return skip(`the service's cap of ${caps.daily} mails a day is reached`, "capped");
  const transport = transportOf(rt);
  if (!transport) return skip("no mail service configured");
  if (!c.address) return skip("no address");
  saveRecord(s, rec);
  const p = send(rt, s, rec, c, transport, now).catch((err: Error) => console.error(`[mail] ${rec.mailId} ${err.message}`));
  s.inFlight.add(p);
  void p.finally(() => s.inFlight.delete(p));
  return rec;
}

async function send(rt: Runtime, s: State, rec: MailRecord, c: Contact, transport: MailTransport, now: Date): Promise<void> {
  const stopUrl = rec.kind === "confirm" ? undefined : `${base()}/ui-api/mail/stop?t=${signLink({ p: "stop", o: c.orgId, c: c.contactId }, now)}`;
  const mail = renderMail(rec.model, { lang: c.lang, maskedTo: c.masked, settingsUrl: `${base()}/k/${c.slug}/agent#mail`, ...(stopUrl ? { stopUrl } : {}) });
  const result = await transport.send({
    from: mailFrom(),
    to: c.address!,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: `aimopilot-${rec.eventKey}`.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 200),
    ...(stopUrl ? { headers: { "List-Unsubscribe": `<${stopUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    tags: [{ name: "kind", value: rec.kind }, ...(rec.change ? [{ name: "change", value: rec.change }] : [])],
  });
  if (result.ok) {
    const r: MailRecord = { ...rec, outcome: "sent", providerId: result.id, attempts: result.attempts };
    saveRecord(s, r);
    ledger(rt, { orderId: rec.orderId, summary: `${what(r)} emailed to ${c.kitchenName} (${transport.name} id ${result.id}${result.attempts > 1 ? `, after ${result.attempts} tries` : ""}).`, data: { step: "sent", kind: r.kind, eventKey: r.eventKey, outcome: "sent", providerId: result.id } });
    scheduleDeliveryCheck(rt, r.mailId);
  } else if (result.code === "invalid_idempotent_request") {
    // The provider saw this event's key in the last 24 hours (a restart, another process): it was sent once already.
    const r: MailRecord = { ...rec, outcome: "skipped", reason: "already sent for this event (the mail service's idempotency key)", attempts: result.attempts };
    saveRecord(s, r);
    ledger(rt, { orderId: rec.orderId, summary: `${what(r)} to ${c.kitchenName}: not sent again: the mail service already sent one for this event.`, data: { step: "skipped", kind: r.kind, eventKey: r.eventKey, outcome: "skipped", reason: r.reason } });
  } else {
    const reason = `${result.code}${result.status ? ` (${result.status})` : ""}: ${result.message}`;
    const r: MailRecord = { ...rec, outcome: "failed", reason, attempts: result.attempts };
    saveRecord(s, r);
    ledger(rt, { orderId: rec.orderId, summary: `${what(r)} to ${c.kitchenName} failed after ${result.attempts} ${result.attempts === 1 ? "try" : "tries"}: ${reason}. The order is not affected.`, data: { step: "failed", kind: r.kind, eventKey: r.eventKey, outcome: "failed", reason } });
  }
}

/** Ask the provider what happened to a sent mail: a bounce or a complaint stops the kitchen's mails until it gives an address again. */
export async function checkDelivery(rt: Runtime, mailId: string, now = new Date()): Promise<Delivery | undefined> {
  const s = await ready(rt);
  const r = s.log.get(mailId);
  const t = transportOf(rt);
  if (!r?.providerId || !t?.status) return undefined;
  const d = await t.status(r.providerId);
  if (d === "unknown" || d === r.delivery) return d;
  saveRecord(s, { ...r, delivery: d });
  if (d === "bounced" || d === "complained") {
    ledger(rt, { orderId: r.orderId, summary: `${what(r)} to ${r.kitchenName} ${d === "bounced" ? "bounced" : "was marked as spam"}; no more mail goes to that address.`, data: { step: d, kind: r.kind, eventKey: r.eventKey, outcome: d, providerId: r.providerId } });
    const c = s.contacts.get(r.orgId);
    if (c && c.contactId === r.contactId && (c.state === "confirmed" || c.state === "pending")) end(rt, s, c, "bounced", "the mail service", now, d);
  }
  return d;
}

function scheduleDeliveryCheck(rt: Runtime, mailId: string) {
  if (process.env.VITEST) return; // tests call checkDelivery themselves
  for (const ms of [30_000, 180_000]) {
    const t = setTimeout(() => void checkDelivery(rt, mailId).catch(() => undefined), ms);
    (t as { unref?: () => void }).unref?.();
  }
}

/** Wait for every mail being sent now (tests, scripts). */
export async function settled(rt: Runtime): Promise<void> {
  const s = stateOf(rt);
  while (s.inFlight.size) await Promise.all([...s.inFlight]);
}

// ---------- the events: building each mail from what the order flow and the watch recorded ----------

async function kitchenInfo(slug: string): Promise<{ agentName: string; perOrderLimitCents: number } | undefined> {
  const { resolveKitchen } = await import("../console-kitchens");
  const k = await resolveKitchen(slug).catch(() => undefined);
  return k ? { agentName: k.info.agentName, perOrderLimitCents: k.info.mandate.perOrderLimitCents } : undefined;
}

/** The order as the wholesaler keeps it (no session needed: this runs after the fact, for the kitchen's own mail). */
async function orderOf(rt: Runtime, orgId: string, orderId: string): Promise<PublicOrder | undefined> {
  return (await rt.dock.listOrders({ orgId })).find((o) => o.orderId === orderId);
}

const links = (c: Contact, orderId?: string) => ({ store: `${base()}/k/${c.slug}`, ...(orderId ? { order: `${base()}/k/${c.slug}/orders/${orderId}` } : {}) });

export async function receiptModel(c: Pick<Contact, "orgId" | "slug" | "kitchenName">, o: PublicOrder): Promise<ReceiptModel> {
  const goodsCents = o.lines.reduce((n, l) => n + l.lineTotalCents, 0);
  const depositCents = o.lines.reduce((n, l) => n + (l.deposit?.totalCents ?? 0), 0);
  const vat = vatBreakdown(o.lines);
  const approved = o.approval?.status === "approved";
  const info = await kitchenInfo(c.slug);
  return {
    kind: "receipt",
    kitchen: kitchenOf(c),
    orderId: o.orderId,
    committedAt: o.updatedAt,
    deliveryDates: [...new Set(o.lines.map((l) => l.deliveryDate))].sort(),
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, deliveryDate: l.deliveryDate, ...(l.deposit?.totalCents ? { depositCents: l.deposit.totalCents } : {}), ...(l.taxRatePct !== undefined ? { taxRatePct: l.taxRatePct } : {}), ...(l.substituteFor ? { insteadOf: l.substituteFor.name } : {}) })),
    goodsCents,
    depositCents,
    vat: { byRate: vat.byRate, vatCents: vat.vatCents, incomplete: vat.incomplete },
    totalCents: o.totalCents,
    totalWithVatCents: o.totalCents + vat.vatCents,
    decidedBy: approved && o.approval ? { kind: "person", name: o.approval.approver.name, role: o.approval.approver.role, at: o.approval.decidedAt ?? o.updatedAt, verified: o.approval.signOff?.verified !== false } : { kind: "agent", agentName: info?.agentName ?? "Your purchasing agent", limitCents: info?.perOrderLimitCents ?? 0 },
    ...(o.confirmation ? { fingerprint: sha256Hex(o.confirmation).slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ") } : {}),
    links: { order: `${base()}/k/${c.slug}/orders/${o.orderId}`, verify: `${base()}/k/${c.slug}/orders/${o.orderId}#verify`, keys: `${base()}/.well-known/jwks.json` },
  };
}

async function signOffModel(rt: Runtime, c: Contact, o: PublicOrder): Promise<SignOffModel | undefined> {
  if (!o.approval) return undefined;
  const ctx = await rt.dock.approvalContext(o.approval.approvalId).catch(() => undefined);
  const info = await kitchenInfo(c.slug);
  return {
    kind: "sign_off",
    kitchen: kitchenOf(c),
    orderId: o.orderId,
    approvalId: o.approval.approvalId,
    approver: { name: o.approval.approver.name, role: o.approval.approver.role },
    agentName: info?.agentName ?? "Your purchasing agent",
    totalCents: o.totalCents,
    deliveryDates: [...new Set(o.lines.map((l) => l.deliveryDate))].sort(),
    lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, packSize: l.packSize, unit: l.unit, lineTotalCents: l.lineTotalCents, ...(l.substituteFor ? { insteadOf: l.substituteFor.name } : {}) })),
    reasons: o.decision.rules.filter((r) => r.outcome === "escalate").map((r) => ({ rule: r.rule, reason: r.reason })),
    ...(ctx?.quoteExpiresAt ? { holdsUntil: ctx.quoteExpiresAt } : {}),
    links: { order: `${base()}/k/${c.slug}/orders/${o.orderId}` },
  };
}

async function onOrderEvent(rt: Runtime, e: DockEvent): Promise<void> {
  const s = await ready(rt);
  const c = s.contacts.get(e.orgId);
  if (!c || c.state === "removed") {
    s.noAddress += 1;
    return;
  }
  const o = await orderOf(rt, e.orgId, e.orderId);
  if (!o) return;
  const at = new Date(e.at);
  const changed = (change: ChangeKind, extra: Partial<ChangedModel> = {}) =>
    deliver(rt, { eventKey: `${change}:${o.orderId}`, kind: "changed", orgId: o.orgId, orderId: o.orderId, model: { kind: "changed", change, kitchen: kitchenOf(c), orderId: o.orderId, totalCents: o.totalCents, date: o.lines[0]?.deliveryDate, links: links(c, o.orderId), ...extra } }, at);
  switch (e.type) {
    case "order_committed":
      await deliver(rt, { eventKey: `receipt:${o.orderId}`, kind: "receipt", orgId: o.orgId, orderId: o.orderId, model: await receiptModel(c, o) }, at);
      return;
    case "approval_requested": {
      const m = await signOffModel(rt, c, o);
      if (m) await deliver(rt, { eventKey: `sign_off:${m.approvalId}`, kind: "sign_off", orgId: o.orgId, orderId: o.orderId, model: m }, at);
      return;
    }
    case "order_rejected": {
      const rule = decidingRule(o.decision);
      await changed("refused", { reasonCode: rule?.rule, reason: rule?.reason ?? o.decision.reasons[0], links: links(c) });
      return;
    }
    case "approval_declined":
      await changed("declined", { by: o.approval?.approver.name, ...(o.approval?.note ? { reason: o.approval.note } : {}) });
      return;
    case "approval_expired":
      await changed("expired");
      return;
    case "approval_withdrawn":
    case "order_withdrawn":
      await changed("withdrawn", o.approval?.note ? { reason: o.approval.note } : {});
      return;
  }
}

async function onRefusedAtPlacement(rt: Runtime, orderId: string, at: string): Promise<void> {
  const s = await ready(rt);
  const orgId = await rt.dock.orgOfOrder(orderId);
  const c = orgId ? s.contacts.get(orgId) : undefined;
  if (!orgId || !c || c.state === "removed") {
    s.noAddress += 1;
    return;
  }
  await onOrderEvent(rt, { id: 0, type: "order_rejected", at, orgId, orderId, totalCents: 0, summary: "" });
}

async function onWatchEntry(rt: Runtime, e: LedgerEntry): Promise<void> {
  const d = e.data as Record<string, unknown>;
  const step = d.step;
  if (step !== "found" && step !== "renewal_held" && step !== "renewal_placed") return;
  const s = await ready(rt);
  const live = [...s.contacts.values()].filter((c) => c.state !== "removed");
  if (!live.length) {
    s.noAddress += 1;
    return;
  }
  const { watchForOrg } = await import("../watch/service");
  for (const c of live) {
    const w = await watchForOrg(rt, c.orgId, { all: true });
    const at = new Date(e.at);
    if (step === "found") {
      const f = w.findings.find((x) => x.findingId === d.findingId);
      if (!f) continue;
      await deliver(rt, {
        eventKey: `cannot_come:${f.orgId}:${f.product.productId}:${f.need.date}`,
        kind: "changed",
        orgId: f.orgId,
        ...(f.need.orderId ? { orderId: f.need.orderId } : {}),
        model: { kind: "changed", change: "cannot_come", kitchen: kitchenOf(c), ...(f.need.orderId ? { orderId: f.need.orderId } : {}), product: { name: f.product.name, amount: f.need.amount, unit: f.need.unit }, date: f.need.date, backOn: f.shortfall.backOn, reasonCode: f.shortfall.reason, reason: f.message, source: f.need.source, substitutes: f.substitutes.slice(0, 3).map((x) => ({ rank: x.rank, name: x.name, why: x.why, insidePreferences: x.insidePreferences })), staged: f.staged, links: links(c, f.need.orderId) },
      }, at);
      return;
    }
    const r = w.renewals.find((x) => x.renewalId === d.renewalId);
    if (!r) continue;
    if (step === "renewal_held") {
      await deliver(rt, {
        eventKey: `renewal_held:${r.orgId}:${r.family}:${r.deliveryDate}`,
        kind: "changed",
        orgId: r.orgId,
        model: { kind: "changed", change: "renewal_held", kitchen: kitchenOf(c), product: { name: r.product.name }, date: r.deliveryDate, reason: r.decision.reason, amounts: r.amounts, staged: r.staged, links: links(c) },
      }, at);
    } else if (r.outcome?.substitute && r.outcome.orderId) {
      await deliver(rt, {
        eventKey: `substituted:${r.outcome.orderId}`,
        kind: "changed",
        orgId: r.orgId,
        orderId: r.outcome.orderId,
        model: { kind: "changed", change: "substituted", kitchen: kitchenOf(c), orderId: r.outcome.orderId, product: { name: r.product.name }, date: r.deliveryDate, substitute: { name: r.outcome.substitute.name, insidePreferences: r.outcome.substitute.insidePreferences }, outcome: { status: r.outcome.status, totalCents: r.outcome.totalCents, approver: r.outcome.approver }, staged: r.staged, links: links(c, r.outcome.orderId) },
      }, at);
    }
    return;
  }
}

/**
 * Listen to the order flow's events and the watch's ledger entries, once per runtime. Each handler runs after the
 * event, off the order's path: an exception or a slow mail service never reaches the order flow.
 */
export function attachMail(rt: Runtime): void {
  const s = stateOf(rt);
  if (s.attached) return;
  s.attached = true;
  const later = (fn: () => Promise<void>) => {
    setTimeout(() => {
      const p = fn().catch((err: Error) => console.error(`[mail] ${err.message}`));
      s.inFlight.add(p);
      void p.finally(() => s.inFlight.delete(p));
    }, 0);
  };
  rt.events.subscribe(
    () => true,
    (e) => later(() => onOrderEvent(rt, e)),
  );
  rt.dock.ledger.onAppend((e) => {
    if (e.type === "watch") later(() => onWatchEntry(rt, e));
    // The gate refusing an order as it is placed (the bus carries only a refusal at sign-off; both give one mail).
    else if (e.type === "decision" && e.orderId && (e.data as { outcome?: unknown }).outcome === "reject") later(() => onRefusedAtPlacement(rt, e.orderId!, e.at));
  });
}

// ---------- what outside agents and the conversation are told ----------

export type ReceiptStatus = { emailed: boolean; to?: string; status: "sent" | "sending" | "failed" | "skipped" | "no_address" | "not_confirmed" | "not_configured" | "not_committed" };

/** Whether this order's receipt was (or is being) emailed, and to which masked address. Never the address itself. */
export async function receiptStatus(rt: Runtime, order: { orderId: string; orgId: string; status: string }): Promise<ReceiptStatus> {
  const s = await ready(rt);
  const id = s.byEvent.get(`receipt:${order.orderId}`);
  const r = id ? s.log.get(id) : undefined;
  if (r) return { emailed: r.outcome === "sent", ...(r.maskedTo ? { to: r.maskedTo } : {}), status: r.outcome };
  if (order.status !== "committed") return { emailed: false, status: "not_committed" };
  const c = s.contacts.get(order.orgId);
  if (!c || !c.address || (c.state !== "confirmed" && c.state !== "pending")) return { emailed: false, status: "no_address" };
  if (c.state === "pending") return { emailed: false, to: c.masked, status: "not_confirmed" };
  if (!transportOf(rt)) return { emailed: false, to: c.masked, status: "not_configured" };
  return { emailed: false, to: c.masked, status: "sending" };
}

/** Once per conversation: has the agent already offered to email receipts in this thread? */
export async function askedInThread(rt: Runtime, threadId: string, mark = false): Promise<boolean> {
  const s = await ready(rt);
  const had = s.asked.has(threadId);
  if (mark && !had) {
    s.asked.add(threadId);
    void s.stores.asked.put(threadId, { threadId, at: new Date().toISOString() });
  }
  return had;
}

// ---------- operations ----------

export type MailView = {
  configured: boolean;
  transport: string;
  from: string;
  testSenderOnly: boolean;
  caps: { perKitchenHour: number; daily: number; usedToday: number; leftToday: number };
  kitchens: { orgId: string; slug: string; kitchenName: string; masked: string; state: ContactState; lang: Lang; setAt: string; confirmedAt?: string; sentThisHour: number; leftThisHour: number }[];
  mails: Omit<MailRecord, "model">[];
  noAddressEvents: number;
  stats: { sent: number; skipped: number; failed: number; sending: number; bounced: number };
};

export async function mailView(rt: Runtime, now = new Date()): Promise<MailView> {
  const s = await ready(rt);
  const caps = mailCaps();
  const t = transportOf(rt);
  // A viewer who hid the sample activity (server/alive) sees none of it, in the list or the counts.
  const { hiddenSample } = await import("../alive/marks");
  const all = [...s.log.values()].filter((r) => !hiddenSample(rt.dock.ledger, r.mailId, r.eventKey, r.orderId)).sort((a, b) => b.at.localeCompare(a.at));
  const usedToday = counts(s, "", now).daily;
  return {
    configured: !!t,
    transport: t?.name ?? "none",
    from: mailFrom(),
    testSenderOnly: senderIsTestOnly(),
    caps: { perKitchenHour: caps.perKitchenHour, daily: caps.daily, usedToday, leftToday: Math.max(0, caps.daily - usedToday) },
    kitchens: [...s.contacts.values()]
      .filter((c) => c.state !== "removed")
      .map((c) => {
        const used = counts(s, c.orgId, now).kitchenHour;
        return { orgId: c.orgId, slug: c.slug, kitchenName: c.kitchenName, masked: c.masked, state: c.state, lang: c.lang, setAt: c.setAt, ...(c.confirmedAt ? { confirmedAt: c.confirmedAt } : {}), sentThisHour: used, leftThisHour: Math.max(0, caps.perKitchenHour - used) };
      }),
    mails: all.slice(0, 200).map(({ model: _m, ...r }) => (void _m, r)),
    noAddressEvents: s.noAddress,
    stats: { sent: all.filter((r) => r.outcome === "sent").length, skipped: all.filter((r) => r.outcome === "skipped").length, failed: all.filter((r) => r.outcome === "failed").length, sending: all.filter((r) => r.outcome === "sending").length, bounced: all.filter((r) => r.delivery === "bounced" || r.delivery === "complained").length },
  };
}

/** A sent mail rendered again for the operations page: with the masked address and inert links. */
export async function mailPreview(rt: Runtime, mailId: string): Promise<{ subject: string; html: string; text: string } | undefined> {
  const s = await ready(rt);
  const r = s.log.get(mailId);
  if (!r) return undefined;
  const m = renderMail(r.model, { lang: r.lang, maskedTo: r.maskedTo ?? "•••", settingsUrl: "#", ...(r.kind === "confirm" ? {} : { stopUrl: "#" }) });
  // The confirmation link is live for the kitchen only: staff see it inert.
  const inert = (x: string) => x.replace(/\/mail\/confirm\?t=[\w.-]+/g, "/mail/confirm?t=(kept-from-staff)");
  return { subject: m.subject, html: inert(m.html), text: inert(m.text) };
}
