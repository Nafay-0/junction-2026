import { DockError } from "@/core/errors";
import { addDaysIso, isoWeekday, localNow, updateKitchenProfile, type HistoryEntry } from "@/core/kitchen";
import type { LedgerEntry, LedgerEntryType } from "@/core/ledger";
import type { Product } from "@/core/catalog";
import { deliveryRecordOf } from "@/core/reliability";
import type { Account } from "../accounts/store";
import type { Runtime } from "../runtime";
import { DEMO_RESETS_PER_DAY, DEMO_STAGINGS_PER_DAY } from "./mark";
import { SAMPLE_PREFIX, sampleHistory, type SampleSummary } from "./sample";

/**
 * A DEMO ACCOUNT's own controls (accounts/store.ts `demo`): a judge opens an account, onboards, and can then try
 * every capability on their own kitchen without help.
 *
 *   start     at the end of onboarding: "sample" (several weeks of made-up orders adapted to the account's rules,
 *             server/demo/sample.ts, labelled sample wherever they show) or "empty" (real orders only)
 *   stage     a condition for THIS account's kitchen only, through the watch's and the selling agent's own staging:
 *             a stock-out of one of its weekly products, its creeping portions, a fresh offer from the wholesaler's
 *             agent, a product with a poor delivery record to put on an order. Marked "staged for the demo" wherever it
 *             shows, a ledger entry each, capped per account per day, never another kitchen or the shared live cache
 *             (a staged stock-out is an overlay on the answers THIS organisation gets: server/watch/overlay.ts)
 *   restart   back to how the kitchen was after onboarding (sample or empty): a fresh organisation with the terms it
 *             signed, the signer and its passkeys moved over; the ledger keeps everything, and the reset is an entry
 *   remove    the account deleted by its own person
 *   guide     the "Try everything" rows with a tick for each the ledger (and the kitchen's records) shows happened
 *
 * Only the account's own signed-in person reaches any of this (the routes check), and only for its own kitchen.
 */

export type StageKind = "stock_out" | "drift" | "offer" | "poor_record";
export const STAGE_KINDS: StageKind[] = ["stock_out", "drift", "offer", "poor_record"];

const DAY_MS = 86_400_000;

function ledger(rt: Runtime, a: Account, summary: string, data: Record<string, unknown>, type: LedgerEntryType = "intake") {
  rt.dock.ledger.append({ type, actor: `account:${a.username}`, summary, data: { demo: true, orgId: a.kitchen?.orgId, ...data } });
}

function demoOf(a: Account) {
  if (!a.demo) throw new DockError(403, "not_a_demo_account", `${a.restaurant} is not a demo account: nothing is staged, sampled or reset for it.`, "account");
  if (!a.kitchen) throw new DockError(409, "no_kitchen_yet", "Finish setting up the kitchen first.", "account");
  return { demo: a.demo, kitchen: a.kitchen };
}

const by = (a: Account) => `${a.restaurant} (demo account ${a.username})`;

// ---------- start: sample history or empty ----------

/** The kitchen's delivery days as the profile has them (the set-up's answer), or Tuesday and Friday. */
async function weekdaysOf(rt: Runtime, orgId: string): Promise<number[]> {
  const p = await rt.kitchens.getProfile(orgId);
  const d = p?.deliveryWeekdays ?? [];
  return d.length && d.length < 6 ? d : [2, 5];
}

async function fillSample(rt: Runtime, a: Account, now: Date): Promise<SampleSummary> {
  const k = a.kitchen!;
  const { history, summary } = await sampleHistory(rt.catalog, k.mandate, { weekdays: await weekdaysOf(rt, k.orgId), now });
  await updateKitchenProfile(rt.kitchens, k.orgId, (p) => (p ? { ...p, history: [...p.history.filter((h) => !h.sample), ...history].sort((x, y) => x.placedAt.localeCompare(y.placedAt)) } : p));
  return summary;
}

export async function chooseStart(rt: Runtime, a: Account, start: "sample" | "empty", now = new Date()): Promise<{ start: "sample" | "empty"; sample?: SampleSummary }> {
  const { demo } = demoOf(a);
  if (demo.start) return { start: demo.start };
  let summary: SampleSummary | undefined;
  if (start === "sample") summary = await fillSample(rt, a, now);
  await rt.accounts.store.put({ ...a, demo: { ...demo, start, startedAt: now.toISOString() } });
  ledger(
    rt,
    a,
    start === "sample"
      ? `${a.restaurant} started with a SAMPLE HISTORY for the demo: ${summary!.orders} made-up orders over six weeks (${[...summary!.weekly.map((w) => `${w.name} weekly`), summary!.creeping ? `${summary!.creeping.name} creeping up` : "", summary!.poor ? `${summary!.poor.name}, which ${summary!.poor.words}` : ""].filter(Boolean).join("; ")}), all inside its signed rules. Labelled sample wherever they show; not orders in the wholesaler's books.`
      : `${a.restaurant} started empty: its agent learns from real orders only.`,
    { step: "demo_start", start, sample: start === "sample", ...(summary ? { orders: summary.orders, weekly: summary.weekly, creeping: summary.creeping, poor: summary.poor, variety: summary.variety } : {}) },
  );
  return { start, ...(summary ? { sample: summary } : {}) };
}

// ---------- staging, for this account's kitchen only ----------

function capStaging(a: Account, now: Date) {
  const recent = (a.demo?.staged ?? []).filter((s) => now.getTime() - Date.parse(s.at) < DAY_MS);
  if (recent.length >= DEMO_STAGINGS_PER_DAY) throw new DockError(429, "demo_staging_limit", `This demo account has staged ${recent.length} conditions today, the most a day. Start over from Your rules, or try again tomorrow.`, "account", { retryAfterSeconds: 3600 });
  return recent;
}

/** The kitchen's recurring orders as the watch learns them (records only). */
async function recurring(rt: Runtime, orgId: string) {
  const { patternsOf } = await import("../watch/service");
  return (await patternsOf(rt, orgId)).patterns;
}

/** A product with a poor delivery record the kitchen may buy: from its own history first, else master data in its groups. */
export async function poorRecordProduct(rt: Runtime, a: Account, opts: { live?: boolean } = {}): Promise<{ product: Product; name: string; words: string; packs: number; amount: number; unit: string } | undefined> {
  const k = a.kitchen!;
  const { forbiddenBy } = await import("@/core/offers");
  const { warnLevel } = await import("../reliability/service");
  const warn = warnLevel();
  const profile = await rt.kitchens.getProfile(k.orgId);
  const own = [...new Set((profile?.history ?? []).flatMap((h) => h.lines.map((l) => l.productId)))].slice(0, 100);
  const mine = own.length ? await rt.catalog.searchProducts({ ids: own, limit: 100 }) : [];
  // Its required claims stated on the product itself (not only by its nature), so the agent's own check agrees.
  const ok = (p: Product) => !!deliveryRecordOf(p, warn)?.poor && k.mandate.requiredAttributes.every((x) => p.attributes.includes(x)) && !forbiddenBy(p, { mandate: k.mandate, profile }, new Date());
  // A name a person would type: an English name in plain case, and none whose words read as a claim ("hand made").
  const plain = (p: Product) => (p.names?.en ? 2 : 0) + (p.name === p.name.toUpperCase() ? 0 : 1) + (/hand ?made|käsin|artisan/i.test(p.names?.en ?? p.name) ? -3 : 0);
  const rank = (ps: Product[]) => ps.sort((x, y) => plain(y) - plain(x) || y.deliveryReliability - x.deliveryReliability || x.id.localeCompare(y.id));
  // The kitchen's own products first; for staging, more from master data, so the live check has several to choose from.
  let pool = rank(mine.filter(ok));
  if (!pool.length || (opts.live && pool.length < 5)) {
    for (const family of k.mandate.allowedCategories.slice(0, 60)) {
      const found = (await rt.catalog.searchProducts({ category: family, limit: 100 }).catch(() => [] as Product[])).filter((p) => ok(p) && !pool.some((x) => x.id === p.id));
      if (found.length) pool = [...pool, ...rank(found)];
      if (pool.length >= (opts.live ? 10 : 1)) break;
    }
  }
  if (!pool.length) return undefined;
  let p = pool[0];
  if (opts.live && pool.length > 1) {
    // Staging only (a person's tap, capped): ONE live call for at most ten candidates, so the one picked can come.
    const cat = rt.catalog as { getLiveStatus?: (ids: string[]) => Promise<{ productId: string; orderable: boolean }[]> };
    const st = await cat.getLiveStatus?.(pool.slice(0, 10).map((x) => x.id)).catch(() => undefined);
    const can = st?.find((x) => x.orderable)?.productId;
    p = pool.find((x) => x.id === can) ?? p;
  }
  const usual = (profile?.history ?? []).filter((h) => h.lines.some((l) => l.productId === p.id)).at(-1);
  const packs = usual?.lines.find((l) => l.productId === p.id)?.packs ?? Math.max(2, Math.min(10, Math.round(6 / Math.max(1, p.packSize)) || 2));
  const name = p.names?.en ?? p.name;
  return { product: p, name, words: deliveryRecordOf(p, warn)!.words, packs, amount: Math.round(packs * p.packSize * 100) / 100, unit: p.unit };
}

export type Staged = { kind: StageKind; summary: string; productId?: string; productName?: string; family?: string; until?: string; offerId?: string; words?: string; packs?: number; amount?: number; unit?: string; day?: string };

/** The next delivery day of the kitchen from tomorrow (for the words a judge types). */
function nextDay(weekdays: number[], now: Date): string {
  const today = localNow(now).date;
  for (let i = 2; i < 10; i++) {
    const d = addDaysIso(today, i);
    if (weekdays.includes(isoWeekday(d))) return d;
  }
  return addDaysIso(today, 3);
}

export async function stageForAccount(rt: Runtime, a: Account, kind: StageKind, now = new Date()): Promise<Staged> {
  const { demo, kitchen: k } = demoOf(a);
  if (!STAGE_KINDS.includes(kind)) throw new DockError(400, "invalid_request", `Stage one of: ${STAGE_KINDS.join(", ")}.`);
  const recent = capStaging(a, now);
  const watch = await import("../watch/service");
  let out: Staged;
  if (kind === "stock_out" || kind === "drift") {
    const patterns = await recurring(rt, k.orgId);
    if (!patterns.length) throw new DockError(409, "no_recurring_order", "This kitchen has no recurring order yet: start with a sample history (Start over, under Your rules), or order the same product on the same weekday for four weeks.", "account");
    if (kind === "stock_out") {
      // The weekly product that comes next: its renewal (or the next order of it) is the one that cannot come.
      const { nextSlot } = await import("@/core/watch");
      const today = localNow(now).date;
      const p = [...patterns].sort((x, y) => (nextSlot(x, today)?.date ?? "9").localeCompare(nextSlot(y, today)?.date ?? "9"))[0];
      const g = await watch.stageStockOut(rt, { kitchen: a.username, productId: p.product.productId, by: by(a), actor: `account:${a.username}`, now });
      out = { kind, summary: `${g.productName} is out of stock for ${a.restaurant} until ${g.until} (staged for the demo).`, productId: g.productId, productName: g.productName, family: p.family, until: g.until };
    } else {
      const creeping = patterns.find((x) => x.slots.some((s) => s.points.length >= 4 && s.points.slice(-4).every((pt, i, xs) => i === 0 || pt.amount >= xs[i - 1].amount))) ?? patterns.find((x) => x.slots.some((s) => s.points.length >= 4));
      if (!creeping) throw new DockError(409, "not_enough_orders", "Four orders on one weekday are needed to stage a trend.", "account");
      const g = await watch.stageDrift(rt, { kitchen: a.username, family: creeping.family, cost: true, by: by(a), actor: `account:${a.username}`, now });
      out = { kind, summary: `${a.restaurant}'s last four ${creeping.family.replaceAll("_", " ")} orders now creep up (staged for the demo).`, productId: g.productId, productName: g.productName, family: creeping.family };
    }
    // The watch looks once, now, for this kitchen only: one live call for at most ten of its products.
    await watch.runWatchFor(rt, await watch.watchKitchen(rt, a.username), { now, fresh: true, by: by(a), renew: "none" }).catch((err: Error) => console.warn("[demo] watch after staging", err.message));
  } else if (kind === "offer") {
    const offers = await import("../offers/service");
    await offers.resetKitchenOffers(rt, [a.username], by(a), "a demo account asked for a fresh offer for its own kitchen", now);
    const [run] = await offers.runSellingAgent(rt, { kitchens: [a.username], now, by: by(a) });
    const o = run?.offered[0];
    if (!o) {
      const why = run?.notRelevant ?? run?.withheld[0]?.reason ?? "nothing the wholesaler's agent could suggest passes this kitchen's rules today";
      ledger(rt, a, `STAGED for the demo by ${by(a)}: the wholesaler's selling agent was run for ${a.restaurant}; it offered nothing (${why}).`, { step: "staged", kind, staged: true, offered: 0 }, "offer");
      throw new DockError(409, "no_offer", `The wholesaler's agent found nothing to suggest right now: ${why}. With a sample history it has more to go on.`, "account");
    }
    ledger(rt, a, `STAGED for the demo by ${by(a)}: the wholesaler's selling agent was run for ${a.restaurant} now instead of on its schedule, and offered ${o.productName}. The offer itself is the agent's own, signed as always.`, { step: "staged", kind, staged: true, offerId: o.offerId, productId: o.productId }, "offer");
    out = { kind, summary: `The wholesaler's agent offered ${o.productName} (staged for the demo: run now instead of on its schedule).`, offerId: o.offerId, productId: o.productId, productName: o.productName, family: o.family };
  } else {
    const found = await poorRecordProduct(rt, a, { live: true });
    if (!found) throw new DockError(409, "no_poor_record", "No product this kitchen may buy has a poor delivery record in the wholesaler's file.", "account");
    const day = nextDay(await weekdaysOf(rt, k.orgId), now);
    ledger(rt, a, `STAGED for the demo by ${by(a)}: ${found.product.name} (${found.product.id}), which ${found.words} (the wholesaler's delivery file, unchanged), was picked for ${a.restaurant} to put on an order.`, { step: "staged", kind, staged: true, productId: found.product.id }, "watch");
    out = { kind, summary: `${found.name} ${found.words}. Order it and the agent offers a backup.`, productId: found.product.id, productName: found.name, family: found.product.category, packs: found.packs, amount: found.amount, unit: found.unit, day };
  }
  await rt.accounts.store.put({ ...a, demo: { ...demo, staged: [...recent, { at: now.toISOString(), kind }].slice(-100) } });
  return out;
}

// ---------- start over, and delete ----------

export async function restartAccount(rt: Runtime, a: Account, now = new Date()): Promise<{ start?: "sample" | "empty"; orgId: string; sample?: SampleSummary }> {
  const { demo, kitchen } = demoOf(a);
  const recent = (demo.resetsAt ?? []).filter((t) => now.getTime() - Date.parse(t) < DAY_MS);
  if (recent.length >= DEMO_RESETS_PER_DAY) throw new DockError(429, "demo_reset_limit", `This demo account has started over ${recent.length} times today, the most a day.`, "account", { retryAfterSeconds: 3600 });
  const terms = demo.onboarded ?? kitchen.terms;
  const oldOrgId = kitchen.orgId;
  // What was staged for the old kitchen is lifted, its auto-renew switched off, its offers no longer count.
  const watch = await import("../watch/service");
  await watch.clearForOrgs(rt, [oldOrgId], by(a), now).catch((err: Error) => console.warn("[demo] restart: watch", err.message));
  const offers = await import("../offers/service");
  await offers.resetKitchenOffers(rt, [a.username], by(a), "the demo account started over", now).catch((err: Error) => console.warn("[demo] restart: offers", err.message));
  const { account } = await rt.accounts.restartKitchen(a.username, terms);
  const k = account.kitchen!;
  const { writeSetupMemory } = await import("../accounts/interview-run");
  if (demo.remembered?.length) await writeSetupMemory(rt, { orgId: k.orgId, restaurant: a.restaurant, username: a.username, by: `${terms.signer} (set-up of ${a.restaurant})`, facts: demo.remembered });
  const next: Account = { ...account, demo: { ...demo, staged: [], resets: (demo.resets ?? 0) + 1, resetsAt: [...recent, now.toISOString()] } };
  await rt.accounts.store.put(next);
  const sample = demo.start === "sample" ? await fillSample(rt, next, now) : undefined;
  ledger(rt, next, `${a.restaurant} started over (demo account): back to how it was after onboarding (${demo.start === "sample" ? `a fresh sample history of ${sample?.orders ?? 0} made-up orders` : "empty"}), signed again with its onboarding rules as ${k.mandate.mandateId}. The old organisation ${oldOrgId} and everything it did stay in the ledger.`, { step: "demo_reset", start: demo.start, oldOrgId, newOrgId: k.orgId, mandateId: k.mandate.mandateId });
  return { start: demo.start, orgId: k.orgId, ...(sample ? { sample } : {}) };
}

export async function deleteAccount(rt: Runtime, a: Account, now = new Date()): Promise<{ deleted: string }> {
  if (a.kitchen) {
    const watch = await import("../watch/service");
    await watch.clearForOrgs(rt, [a.kitchen.orgId], by(a), now).catch(() => undefined);
    const offers = await import("../offers/service");
    await offers.resetKitchenOffers(rt, [a.username], by(a), "the account was deleted", now).catch(() => undefined);
  }
  await rt.accounts.deleteOwnAccount(a.username);
  return { deleted: a.username };
}

// ---------- what happened on this account: the guide's ticks ----------

/** The ledger entries of this account's kitchen (every organisation it has had), since the account was opened. */
async function entriesOf(rt: Runtime, a: Account): Promise<LedgerEntry[]> {
  const k = a.kitchen;
  if (!k) return [];
  const orgs = new Set([k.orgId]);
  const agentStem = k.agentId.replace(/_g\d+$/, "");
  const actors = [`account:${a.username}`, `buyer:${k.orgId}`];
  const since = a.createdAt;
  const all = rt.dock.ledger.readonly();
  const out: LedgerEntry[] = [];
  const reqOrg = new Map<string, boolean>();
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    if (e.at < since) break;
    const d = e.data as Record<string, unknown>;
    let mine = (typeof d.orgId === "string" && (orgs.has(d.orgId) || d.orgId.startsWith(`org_acct_${a.username.replaceAll("-", "_")}`))) || actors.includes(e.actor) || e.actor.startsWith(`agent:${agentStem}`);
    if (!mine && e.requestId) {
      if (!reqOrg.has(e.requestId)) reqOrg.set(e.requestId, ((await rt.dock.orgOfRequest(e.requestId)) ?? "").startsWith(`org_acct_${a.username.replaceAll("-", "_")}`));
      mine = reqOrg.get(e.requestId)!;
    }
    if (mine) out.push(e);
  }
  return out.reverse();
}

export type GuideId = "flow" | "signoff" | "mistake" | "refusal" | "widen" | "learn" | "menu" | "stockout" | "drift" | "offer" | "backup" | "email" | "voice_photo" | "receipt" | "outside" | "ops";
export const GUIDE_ORDER: GuideId[] = ["flow", "signoff", "mistake", "refusal", "widen", "learn", "menu", "stockout", "drift", "offer", "backup", "email", "voice_photo", "receipt", "outside", "ops"];

/** What a row needs to be tried, and whether it is there now. */
export type GuideSetup = { action: StageKind | "phone" | "connect" | "ops"; ready: boolean; why?: "no_recurring" | "no_history" | "not_demo" };

export type GuideRow = { id: GuideId; done: boolean; at?: string; setup?: GuideSetup; staged?: boolean; /** What has to exist first that no button makes (an earlier order of the product). */ needs?: "history" };

/** Facts the guide's words are made of: this kitchen's own products, amounts and limits. */
export type GuideFacts = {
  limitEur: number;
  signer: string;
  overAmount: { amount: number; unit: string; name: string; family: string };
  usual?: { amount: number; unit: string; name: string; family: string; tenTimes: number };
  weekly?: { family: string; name: string };
  creeping?: { family: string; name: string };
  poor?: { name: string; words: string; packs: number; amount: number; unit: string };
  day: string;
  sample: boolean;
  start?: "sample" | "empty";
  hasOrder: boolean;
  orderId?: string;
};

export type Guide = { rows: GuideRow[]; facts: GuideFacts; demo: boolean; done: number; of: number; next?: GuideId };

const has = (es: LedgerEntry[], test: (e: LedgerEntry, d: Record<string, unknown>) => boolean) => es.find((e) => test(e, e.data as Record<string, unknown>));
const doorOf = (d: Record<string, unknown>) => (d.thread as { door?: string } | undefined)?.door;
const text = (e: LedgerEntry) => `${e.summary} ${JSON.stringify(e.data)}`;

export async function guideFor(rt: Runtime, a: Account, now = new Date()): Promise<Guide> {
  const k = a.kitchen;
  if (!k) throw new DockError(409, "no_kitchen_yet", "Finish setting up the kitchen first.", "account");
  const es = await entriesOf(rt, a);
  const orders = await rt.dock.listOrders({ orgId: k.orgId }).catch(() => []);
  const patterns = await recurring(rt, k.orgId).catch(() => []);
  const profile = await rt.kitchens.getProfile(k.orgId);
  const history = profile?.history ?? [];
  const { watchForOrg } = await import("../watch/service");
  const w = await watchForOrg(rt, k.orgId, { all: true }).catch(() => undefined);
  const { offersForOrg } = await import("../offers/service");
  const offers = await offersForOrg(rt, k.orgId).catch(() => []);
  const { backupsForOrg } = await import("../reliability/service");
  const backups = await backupsForOrg(rt, k.orgId).catch(() => []);
  const weekdays = await weekdaysOf(rt, k.orgId);
  const day = nextDay(weekdays, now);

  // The words' figures: an amount over the limit, ten times the usual, the weekly and creeping products.
  const milkish = patterns[0];
  const unitPrice = (h: HistoryEntry | undefined) => (h && h.amount > 0 ? h.totalCents / 100 / h.amount : 1.3);
  const lastOf = (family: string) => [...history].reverse().find((h) => h.family === family);
  const overFamily = milkish?.family ?? "milk";
  const perUnit = unitPrice(lastOf(overFamily));
  const overAmount = Math.max(10, Math.ceil(((k.terms.perOrderLimitEur * 1.6) / perUnit) / 10) * 10);
  const usualSlot = milkish ? [...milkish.slots].sort((x, y) => y.orders - x.orders)[0] : undefined;
  const creepingP = patterns.find((p) => p.slots.some((s) => s.points.length >= 4 && s.points.slice(-4).every((pt, i, xs) => i === 0 || pt.amount >= xs[i - 1].amount)));
  const poor = history.length ? await poorRecordProduct(rt, a).catch(() => undefined) : undefined;
  const facts: GuideFacts = {
    limitEur: k.terms.perOrderLimitEur,
    signer: k.terms.signer,
    overAmount: { amount: overAmount, unit: milkish?.unit ?? "L", name: milkish?.product.name ?? "milk", family: overFamily },
    ...(milkish && usualSlot ? { usual: { amount: usualSlot.usualAmount, unit: milkish.unit, name: milkish.product.name, family: milkish.family, tenTimes: Math.round(usualSlot.usualAmount * 10) } } : {}),
    ...(milkish ? { weekly: { family: milkish.family, name: milkish.product.name } } : {}),
    ...(creepingP ? { creeping: { family: creepingP.family, name: creepingP.product.name } } : {}),
    ...(poor ? { poor: { name: poor.name, words: poor.words, packs: poor.packs, amount: poor.amount, unit: poor.unit } } : {}),
    day,
    sample: history.some((h) => h.sample || h.orderId.startsWith(SAMPLE_PREFIX)),
    ...(a.demo?.start ? { start: a.demo.start } : {}),
    hasOrder: orders.length > 0,
    ...(orders[0] ? { orderId: [...orders].sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0].orderId } : {}),
  };

  const demo = !!a.demo;
  const at = (e?: LedgerEntry) => (e ? { done: true, at: e.at } : { done: false });
  const stagedAny = (kind: string) => !!has(es, (e, d) => d.step === "staged" && (d.kind === kind || (kind === "poor_record" && e.type === "watch" && d.kind === "poor_record")) && !!d.staged);
  const recurringReady = patterns.length > 0;
  const fourOnADay = patterns.some((p) => p.slots.some((s) => s.points.length >= 4));
  const rows: GuideRow[] = [
    { id: "flow", ...at(has(es, (e) => e.type === "order" || (e.type === "approval_requested"))) },
    {
      id: "signoff",
      ...(() => {
        const o = orders.find((x) => x.approval?.status === "approved" && x.approval.signOff?.method === "passkey");
        return o ? { done: true, at: o.approval!.decidedAt } : { done: false };
      })(),
      setup: { action: "phone", ready: true },
    },
    { id: "mistake", ...at(has(es, (e, d) => (e.type === "agent" && d.event === "anomaly" && /quantity_|amount_above_usual|amount_below_usual/.test(JSON.stringify(d.codes ?? ""))) || (e.type === "intake" && /quantity_tenfold|quantity_unusual|amount_above_usual/.test(text(e))))), ...(milkish ? {} : { needs: "history" as const }) },
    { id: "refusal", ...at(has(es, (e, d) => e.type === "refusal" || (e.type === "decision" && /refus/i.test(String(d.outcome ?? d.decision ?? ""))) || (e.type === "agent" && ["pressured", "rules_refused", "dish_refused", "grounding_refusal"].includes(String(d.event))))) },
    { id: "widen", ...at(has(es, (e, d) => e.type === "agent" && d.event === "rules_signed" && (!!d.signOff || d.mechanism === "account_terms"))) },
    {
      id: "learn",
      ...(() => {
        // A rule the agent proposed from what the kitchen ordered (memory/decide.ts proposeRule), confirmed by its person.
        const m = (profile?.memory?.items ?? []).find((x) => x.strength === "rule" && x.status === "active" && x.confirmedBy && x.history.some((h) => h.change.startsWith("proposed as a standing rule")));
        return m ? { done: true, at: m.confirmedBy!.at } : { done: false };
      })(),
    },
    { id: "menu", ...at(has(es, (e, d) => e.type === "agent" && /^(menu_|dish_|scenario_)/.test(String(d.event)) && d.event !== "dish_refused" && d.event !== "dish_question")) },
    {
      id: "stockout",
      ...(() => {
        // Ticked once the agent told the kitchen (or the kitchen answered), not merely when the watch found it.
        const f = w?.findings.find((x) => x.saidAt || x.state === "decided");
        return f ? { done: true, at: f.saidAt ?? f.at } : { done: false };
      })(),
      staged: stagedAny("stock_out"),
      setup: { action: "stock_out", ready: demo && recurringReady, ...(!demo ? { why: "not_demo" as const } : recurringReady ? {} : { why: "no_recurring" as const }) },
    },
    {
      id: "drift",
      ...(() => {
        const r = w?.renewals.find((x) => x.state === "held" || x.state === "answered" || x.state === "skipped");
        if (r) return { done: true, at: r.at };
        // Or the agent told the kitchen about the drift, or auto-renew was switched on for a recurring order.
        return at(has(es, (e, d) => (e.type === "agent" && ((d.event === "today" && JSON.stringify(d.items ?? "").includes("drift")) || (d.event === "watch_said" && d.kind === "renewal_held"))) || (e.type === "watch" && d.step === "auto_renew" && d.on === true)));
      })(),
      staged: stagedAny("drift"),
      setup: { action: "drift", ready: demo && fourOnADay, ...(!demo ? { why: "not_demo" as const } : fourOnADay ? {} : { why: "no_recurring" as const }) },
    },
    {
      id: "offer",
      ...(() => {
        const o = offers.find((x) => x.answer);
        return o ? { done: true, at: o.answer!.at } : at(has(es, (e, d) => e.type === "offer" && ["accepted", "declined", "muted"].includes(String(d.step))));
      })(),
      staged: stagedAny("offer"),
      setup: { action: "offer", ready: demo, ...(demo ? {} : { why: "not_demo" as const }) },
    },
    {
      id: "backup",
      ...(() => {
        // The agent offered a backup in the conversation (or the kitchen answered it).
        const b = backups.find((x) => x.state === "set" || x.state === "declined" || x.state === "used" || !!x.saidAt);
        return b ? { done: true, at: b.chosen?.at ?? b.saidAt ?? b.at } : { done: false };
      })(),
      staged: stagedAny("poor_record"),
      setup: { action: "poor_record", ready: demo, ...(demo ? {} : { why: "not_demo" as const }) },
    },
    { id: "email", ...at(has(es, (e, d) => e.type === "mail" && ["address_set", "address_confirmed", "sent"].includes(String(d.step)))) },
    { id: "voice_photo", ...at(has(es, (e, d) => e.type === "agent" && (doorOf(d) === "voice" || doorOf(d) === "photo"))) },
    { id: "receipt", done: false },
    { id: "outside", ...at(has(es, (e, d) => (e.type === "request" || e.type === "lookup") && /\b(mcp|rest|outside|a2a|openapi)\b/i.test(String(d.via ?? d.transport ?? d.door ?? "")))), setup: { action: "connect", ready: true } },
    { id: "ops", done: false, setup: { action: "ops", ready: true } },
  ];
  const tickable = rows.filter((r) => r.id !== "receipt" && r.id !== "ops");
  const next = tickable.find((r) => !r.done)?.id;
  return { rows, facts, demo, done: tickable.filter((r) => r.done).length, of: tickable.length, ...(next ? { next } : {}) };
}
