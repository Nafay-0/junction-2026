import type { LiveOffer, LiveStatus, Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import { addDaysIso, localNow, type KitchenProfile } from "@/core/kitchen";
import { agentKeyOf } from "@/core/live-allowance";
import { nutritionFindings } from "@/core/nutrition";
import { bestOnHand, estimateFromHistory, saidCovers, saidHave, saidOnHand, type OnHand, type SaidItem } from "@/core/on-hand";
import type { Decision } from "@/core/policy";
import { arrivalOf, dayText, rankOptions, roleOf, ROLE_TEXT, subsFor, techniqueFor, type Arrival, type OptionToVerify, type PartCheck, type RankedOption, type Role } from "@/core/recipe-roles";
import { SEASON, helsinkiMonth, inSeason, seasonMatches, type SeasonEntry } from "@/core/season";
import type { Dock } from "@/core/orders";
import { formatEur } from "@/core/util";
import type { DraftIngredient } from "./draft";
import type { MenuKitchen } from "./kitchens";
import { findCandidates, type MenuCatalog } from "./match";
import { formatAmt, optionsFor, toBase, type Amount, type PlanLineView, type PlanView } from "./plan";
import { checkSafety } from "./safety";
import type { PlanRecord, PlanService } from "./service";

/**
 * Two of the partner's example scenarios on top of the menu planner, as plain data any door can show:
 *
 *   seasonal   "a chef plans a menu around a seasonal ingredient; the agent suggests recipes, works out what is missing,
 *              and orders": the anchor comes from the season calendar (core/season.ts) and what the assortment really
 *              has (searched in master data, never invented); the planner drafts two or three dishes on it; plain code
 *              works out the need per ingredient, subtracts what the kitchen has on hand (its order history, the
 *              chef's words, each figure labelled with its source; nothing known, nothing assumed) and buys only the
 *              shortfall, in the smallest packs that cover it.
 *   event      "an unexpected booking for tomorrow; the agent flags what cannot be sourced in time and proposes
 *              substitutions through recipe logic": every ingredient's arrival is checked with the wholesaler for the
 *              day (cut-off, stock; one batched call for the dishes' products only, cached on the plan), what cannot
 *              come is said with why and the earliest day, and each such ingredient gets options by its role in the
 *              dish (core/recipe-roles.ts, the planner's own model-proposed fixes, a replacement dish), every product
 *              of which is verified (in the assortment, arrives by the day, passes the kitchen's rules and the
 *              mandate) before it is shown, ranked good, better, best, each with its trade-off and the gate's own
 *              preview: the agent alone, or a named person's sign-off.
 *
 * Nothing here orders. `sheetOf` returns the lines an order sheet takes; the sheet (or an outside agent's quote) goes
 * through the gate like any order. Every decision is a ledger entry on the plan's request.
 */

export type ScenarioDeps = {
  dock: Dock;
  service: PlanService;
  catalog: MenuCatalog;
  profile: (orgId: string) => Promise<KitchenProfile | undefined>;
  now: () => Date;
};

// ---------- what the chef and the kitchen get back ----------

export type AnchorProduct = { productId: string; name: string };
export type SeasonalAnchor = { kind: string; label: SeasonEntry["label"]; why: string; months: number[]; peak: boolean; source: SeasonEntry["source"]; products: AnchorProduct[] };

export type LineFacts = {
  lineId: string;
  ingredient: string;
  dishes: string[];
  role: Role;
  /** What the covers need, before anything on hand. */
  need: string | null;
  onHand: { amount: string | null; text: string; source: OnHand["source"]["kind"]; estimate: boolean } | null;
  /** What is bought: the shortfall, rounded to packs. */
  toBuy: string | null;
  product: { productId: string; name: string; packs: number; packText: string; totalCents: number; deliveryDate: string; orderBy?: string } | null;
  leftover: string | null;
  status: PlanLineView["status"];
  note: string;
};

export type SeasonalResult = {
  scenario: "seasonal";
  planId: string;
  requestId: string | null;
  covers: number | null;
  deliverBy: string | null;
  anchor: SeasonalAnchor | null;
  /** Each dish and the anchor product it is built on (by the chosen product's name), or null when the plan missed it. */
  dishes: { dishId: string; name: string; nameFi: string | null; nameSv: string | null; course: string; anchorLine: string | null }[];
  lines: LineFacts[];
  said: SaidItem[];
  totalCents: number;
  gate: GatePreview | null;
  blockers: string[];
  notes: string[];
} & PlanChecks;

/** The planner's own checks, as facts any door can say in a sentence (plan.ts PlanTotals). */
export type PlanChecks = Pick<PlanView["totals"], "refusedDish" | "instead" | "ruleRefusals" | "day" | "coverage" | "complete" | "ingredients" | "covered" | "missing" | "definingMissing">;
export const checksOf = (v: PlanView): PlanChecks => ({ refusedDish: v.totals.refusedDish, instead: v.totals.instead, ruleRefusals: v.totals.ruleRefusals, day: v.totals.day, coverage: v.totals.coverage, complete: v.totals.complete, ingredients: v.totals.ingredients, covered: v.totals.covered, missing: v.totals.missing, definingMissing: v.totals.definingMissing });

export type GatePreview = { outcome: Decision["outcome"]; reasons: string[]; approver: { name: string; role: string } | null; findings: GateFinding[] };

/** What the gate objects to, each tied to the plan's lines it names (by product id or name), else to the order as a whole. */
export type GateFinding = { rule: string; outcome: "escalate" | "fail"; reason: string; lines: { lineId: string; ingredient: string; product: string }[] };
export function gateFindings(d: Decision | undefined, view: PlanView): GateFinding[] {
  if (!d) return [];
  const bought = view.lines.filter((l) => l.chosen && l.status !== "struck" && l.status !== "merged");
  return d.rules
    .filter((r) => r.outcome !== "pass")
    .map((r) => {
      const ids = new Set<string>(JSON.stringify(r.details ?? {}).match(/"(?:productId|product)":"([^"]+)"/g)?.map((x) => x.split(":")[1].replace(/"/g, "")) ?? []);
      for (const k of ["flagged", "productIds", "undeclared", "held"]) for (const x of ((r.details as Record<string, unknown> | undefined)?.[k] as unknown[] | undefined) ?? []) if (typeof x === "string") ids.add(x);
      const lines = bought
        .filter((l) => l.chosen!.products.some((x) => ids.has(x.productId) || r.reason.includes(x.productId) || r.reason.includes(x.name)))
        .map((l) => ({ lineId: l.lineId, ingredient: l.name, product: l.chosen!.products.map((x) => x.name).join(" + ") }));
      return { rule: r.rule, outcome: r.outcome as "escalate" | "fail", reason: r.reason, lines };
    });
}

export type Stuck = {
  lineId: string;
  ingredient: string;
  dish: string;
  role: Role;
  roleText: string;
  product: { productId: string; name: string } | null;
  arrival: Exclude<Arrival, { ok: true }>;
};

export type SubOption = RankedOption & {
  /** What the gate says of the swap: the agent may make it alone (inside the kitchen's preferences) or a person signs. */
  signOff: { needed: boolean; reason: string; approver: { name: string; role: string } | null; outcome: Decision["outcome"] | "unknown" };
  /** For a replacement dish: its name and lines. */
  dish?: { name: string; nameFi?: string | null; nameSv?: string | null; planId: string; lines: { productId: string; packs: number; name: string }[] };
};

export type EventResult = {
  scenario: "event";
  planId: string;
  requestId: string | null;
  covers: number | null;
  deliverBy: string | null;
  dishes: { dishId: string; name: string; nameFi: string | null; nameSv: string | null; course: string }[];
  /** Every ingredient: arrives by the day, or why not. */
  lines: (LineFacts & { arrival: Arrival | null })[];
  cannotArrive: Stuck[];
  /** Nothing at all can come by the day: the earliest day the products can. */
  allLate: { neededBy: string; earliest: string | null } | null;
  options: Record<string, SubOption[]>;
  /** Why an ingredient has no option shown (each failed verification, in a line). */
  unresolved: Record<string, string[]>;
  totalCents: number;
  gate: GatePreview | null;
  notes: string[];
} & PlanChecks;

export type Choice = { lineId: string; optionId: string };
export type SheetLines = {
  lines: { productId: string; packs: number; substituteFor?: string }[];
  deliveryDate?: string;
  text: string;
  leftOff: { name: string; why: string }[];
  decisions: { lineId: string; ingredient: string; optionId: string; title: string; by: string }[];
};

// ---------- helpers ----------

const PREPARED_NAME = /salad|salaat|hummus|sose|puree|pikkel|marinoi|pickled|etikka|chips|sipsi|laatik|keitto|soup|juice|mehu|jam\b|hillo/;
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const amt = (a: Amount | null | undefined) => (a ? formatAmt(a) : null);
const today = (now: Date) => localNow(now).date;
const preview = (d: Decision | undefined, view?: PlanView): GatePreview | null =>
  d ? { outcome: d.outcome, reasons: d.reasons, approver: d.outcome === "needs_human_approval" ? { name: d.approver.name, role: d.approver.role } : null, findings: view ? gateFindings(d, view) : [] } : null;

function lineFacts(l: PlanLineView, roleOfLine: (l: PlanLineView) => Role): LineFacts {
  const c = l.chosen;
  return {
    lineId: l.lineId,
    ingredient: l.name,
    dishes: [...new Set(l.uses.map((u) => u.dish))],
    role: roleOfLine(l),
    need: amt(l.onHand?.need ?? l.gross),
    onHand: l.onHand
      ? { amount: l.onHand.amount === null ? null : formatAmt({ amount: l.onHand.amount, unit: l.onHand.unit }), text: l.onHand.text, source: l.onHand.source.kind, estimate: l.onHand.estimate }
      : l.status === "struck" && l.pantry
        ? { amount: null, text: "on the kitchen's list of staples it always keeps", source: "pantry", estimate: false }
        : null,
    toBuy: l.status === "struck" ? null : amt(l.gross),
    product: c && l.status !== "struck"
      ? { productId: c.products[0].productId, name: c.products.map((x) => x.name).join(" + "), packs: c.products.reduce((s, x) => s + x.packs, 0), packText: c.products.map((x) => x.packText).join(" + "), totalCents: c.totalCents, deliveryDate: c.deliveryDate, ...(c.orderBy ? { orderBy: c.orderBy } : {}) }
      : null,
    leftover: l.leftover ?? null,
    status: l.status,
    note: l.status === "struck" ? (l.struckReason ?? l.statusText) : l.doubts.filter((d) => !d.accepted).map((d) => d.text.replace(/\s*\(searched:[^)]*\)/g, "")).join(" ") || l.statusText,
  };
}

const specOf = (p: PlanRecord, lineId: string) => p.specs.find((s) => s.lineId === lineId);

export function createScenarios(deps: ScenarioDeps) {
  const { dock, service, catalog } = deps;

  const roleFor = (p: PlanRecord) => (l: PlanLineView) => {
    const spec = specOf(p, l.lineId);
    return roleOf(spec?.uses.map((u) => u.role).join("; ") ?? "", l.name);
  };

  function log(k: MenuKitchen, p: PlanRecord, step: string, summary: string, data: Record<string, unknown>, actor = `agent:${k.agentId}`) {
    if (!p.requestId) return;
    dock.ledger.append({ type: "intake", actor, requestId: p.requestId, summary, data: { step, planId: p.planId, ...data } });
  }

  // ---------- the seasonal anchor ----------

  /**
   * What is in season now that the assortment really has: each calendar entry for this month, its products found by
   * a master-data search on its own words (no live call), only those the kitchen's mandate allows and its rules pass.
   * The entry the words name comes first; then harvests at their peak, then by how many products the assortment has.
   */
  async function anchors(k: MenuKitchen, words: string, month: number): Promise<SeasonalAnchor[]> {
    const w = ` ${fold(words)} `;
    const named = SEASON.filter((e) => [e.label.en, e.label.fi, e.label.sv, e.kind.replace(/_/g, " "), ...(e.match.words ?? [])].some((x) => x.length >= 4 && w.includes(fold(x))));
    const pool = named.length ? named : inSeason(month).filter((e) => e.sort === "harvest");
    const allowed = new Set(k.mandate.allowedCategories);
    const out: SeasonalAnchor[] = [];
    for (const e of pool) {
      const found = new Map<string, Product>();
      for (const term of [...(e.match.words ?? []).slice(0, 6), e.label.fi]) {
        for (const h of await catalog.search(term, 12)) if (seasonMatches(e, h.product) && allowed.has(h.product.category) && checkSafety(h.product, k.diet).verdict !== "block") found.set(h.product.id, h.product);
        if (found.size >= 12) break;
      }
      if (!found.size) continue;
      // The ingredient itself first (fresh produce, not a salad or a spread made of it), then the rest.
      const raw = (x: Product) => (x.categoryCode ?? "").startsWith("174") && !PREPARED_NAME.test(fold([x.name, x.names?.fi, x.names?.en].filter(Boolean).join(" ")));
      const ranked = [...found.values()].sort((a, b) => Number(raw(b)) - Number(raw(a)));
      out.push({ kind: e.kind, label: e.label, why: e.why, months: e.months, peak: !!e.peak?.includes(month), source: e.source, products: ranked.slice(0, 8).map((x) => ({ productId: x.id, name: x.names?.en ?? x.name })) });
    }
    const inMonth = (a: SeasonalAnchor) => a.months.includes(month);
    return out.sort((a, b) => Number(inMonth(b)) - Number(inMonth(a)) || Number(b.peak) - Number(a.peak) || b.products.length - a.products.length);
  }

  // ---------- on hand ----------

  /**
   * What the kitchen has of each line on the service day, and the edits that make the plan buy only the shortfall:
   * what the chef said first, then the estimate from the kitchen's own history; nothing known, nothing assumed.
   */
  async function onHandEdits(k: MenuKitchen, p: PlanRecord, view: PlanView, said: SaidItem[]) {
    const profile = await deps.profile(k.mandate.issuer.orgId).catch(() => undefined);
    const serviceDate = p.settings.deliverBy ?? addDaysIso(today(deps.now()), 1);
    const edits: { op: "onHand"; lineId: string; onHand: OnHand; by?: string }[] = [];
    for (const l of view.lines) {
      if (l.status === "struck" || l.status === "merged" || !l.gross || l.gross.amount <= 0) continue;
      const spec = specOf(p, l.lineId);
      if (!spec) continue;
      const words = [spec.name, spec.key.replace(/_/g, " "), ...spec.ingredient.searchTerms];
      const fromChef = said.find((x) => saidCovers(x, words));
      const candidates = p.candidates[l.lineId]?.candidates ?? [];
      const ids = new Set(candidates.map((c) => c.product.id));
      const chosen = l.chosen ? candidates.find((c) => c.product.id === l.chosen!.products[0].productId)?.product : undefined;
      const staple = chosen?.temperatureClass === "ambient";
      const est = profile?.history.length
        ? estimateFromHistory(profile.history, (h) => ids.has(h.productId) || (!!chosen && h.category === chosen.category && chosen.attributes.every((a) => !a.endsWith("_free") || h.attributes.includes(a))), l.gross, serviceDate, { staple })
        : undefined;
      const said1 = fromChef ? saidOnHand(fromChef.words, l.gross.unit, fromChef.amount) : undefined;
      const best = bestOnHand([said1, est], l.gross.unit);
      if (best.source.kind === "unknown") continue;
      edits.push({ op: "onHand", lineId: l.lineId, onHand: best, ...(fromChef ? { by: `buyer:${p.by}` } : {}) });
    }
    return edits;
  }

  /**
   * The on-hand step for any plan (the seasonal menu, a booking, a dish picked from ideas, a dish asked for): what the
   * chef said and the estimate from the kitchen's own order history, as the planner's own onHand edits, so the plan
   * buys only the shortfall. One function for every path.
   */
  async function applyOnHand(k: MenuKitchen, planId: string, by: string, said: SaidItem[] = []): Promise<{ record: PlanRecord; view: PlanView }> {
    const planned = await service.get(k, planId);
    if (planned.record.state === "declined") return planned;
    const edits = await onHandEdits(k, planned.record, planned.view, said);
    return edits.length ? service.edit(k, planId, edits, by) : planned;
  }

  // ---------- scenario 1 ----------

  async function seasonal(k: MenuKitchen, words: string, by: string, opts: { month?: number } = {}): Promise<SeasonalResult> {
    const month = opts.month ?? helsinkiMonth(deps.now());
    const found = await anchors(k, words, month);
    const anchor = found[0] ?? null;
    const said = saidHave(words);
    const text = anchor
      ? `${words}\n\nBuild each of two or three dishes on ${anchor.label.en} (${anchor.label.fi}), in season in Finland now: ${anchor.why} The wholesaler's assortment has, for example: ${anchor.products
          .slice(0, 5)
          .map((x) => x.name)
          .join("; ")}.${said.length ? ` The kitchen already has: ${said.map((x) => x.words).join(", ")}.` : ""}`
      : words;
    const first = await service.plan(k, text.slice(0, 3900), by);
    if (first.record.state === "declined") return seasonalResult(k, first.record, first.view, anchor, said, []);
    await service.settled(first.record.planId);
    let planned = await applyOnHand(k, first.record.planId, by, said);
    const large = planned.view.lines.filter((l) => l.doubts.some((d) => !d.accepted && d.doubtId.endsWith(":large_pack"))).map((l) => l.lineId);
    if (large.length) planned = await service.edit(k, planned.record.planId, large.map((lineId) => ({ op: "repack" as const, lineId })), by);
    const p = planned.record;
    if (anchor) {
      const built = planned.view.lines.filter((l) => l.chosen && anchorMatch(anchor, l));
      log(k, p, "seasonal_anchor", `In season now: ${anchor.label.en} (${anchor.why} Source: ${anchor.source.title}). The assortment has ${anchor.products.length} such product${anchor.products.length === 1 ? "" : "s"}; the menu is built on it${built.length ? `: ${built.map((l) => l.chosen!.products[0].name).join(", ")}` : ", but no line bought one"}.`, {
        anchor: anchor.kind,
        products: anchor.products.map((x) => x.productId),
        source: anchor.source,
      });
    }
    return seasonalResult(k, p, planned.view, anchor, said, planned.view.lines.filter((l) => l.onHand).map((l) => l.lineId));
  }

  function anchorMatch(a: SeasonalAnchor, l: PlanLineView): boolean {
    const e = SEASON.find((x) => x.kind === a.kind);
    return !!e && !!l.chosen && l.chosen.products.some((x) => seasonMatches(e, { name: x.name, category: "" }) || a.products.some((y) => y.productId === x.productId));
  }

  async function seasonalResult(k: MenuKitchen, p: PlanRecord, view: PlanView, anchor: SeasonalAnchor | null, said: SaidItem[], onHandLines: string[]): Promise<SeasonalResult> {
    const role = roleFor(p);
    const lines = view.lines.filter((l) => l.status !== "merged").map((l) => {
      const f = lineFacts(l, role);
      // A line the planner struck because the chef said they have it: said by the chef, not the pantry list.
      const spec = specOf(p, l.lineId);
      const hit = f.onHand?.source === "pantry" && spec ? said.find((x) => saidCovers(x, [spec.name, spec.key.replace(/_/g, " "), ...spec.ingredient.searchTerms])) : undefined;
      return hit ? { ...f, onHand: { amount: null, text: `said by the chef: "${hit.words}"`, source: "said" as const, estimate: false } } : f;
    });
    if (onHandLines.length) {
      const facts = lines.filter((l) => onHandLines.includes(l.lineId));
      log(k, p, "on_hand", `On hand on the service day, so only the shortfall is bought: ${facts.map((l) => `${l.ingredient}: need ${l.need}, ${l.onHand?.amount ?? "enough"} on hand (${l.onHand?.text}), buy ${l.toBuy ?? "nothing"}`).join("; ")}.`, {
        lines: facts.map((l) => ({ lineId: l.lineId, need: l.need, onHand: l.onHand?.amount ?? null, sourceKind: l.onHand?.source, estimate: l.onHand?.estimate, toBuy: l.toBuy })),
      });
    }
    const gate = p.state === "planned" ? await service.preview(k, p.planId, { view }).catch(() => undefined) : undefined;
    return {
      scenario: "seasonal",
      planId: p.planId,
      requestId: p.requestId ?? null,
      covers: p.settings.covers,
      deliverBy: p.settings.deliverBy,
      anchor,
      dishes: p.draft.dishes.map((d) => {
        const hit = anchor ? view.lines.find((l) => l.uses.some((u) => u.dishId === d.id) && anchorMatch(anchor, l)) : undefined;
        return { dishId: d.id, name: d.name, nameFi: d.nameFi ?? null, nameSv: d.nameSv ?? null, course: d.course, anchorLine: hit?.chosen?.products[0].name ?? null };
      }),
      lines,
      said,
      totalCents: view.totals.totalCents,
      gate: preview(gate, view),
      blockers: view.totals.blockers,
      notes: [...p.notes, ...(p.declineReason ? [p.declineReason] : [])],
      ...checksOf(view),
    };
  }

  // ---------- scenario 2 ----------

  /** Live statuses for products not yet asked, in one batched call per ten, within the agent's allowance; cached on the plan. */
  async function priceMore(k: MenuKitchen, p: PlanRecord, ids: string[]): Promise<Record<string, LiveStatus>> {
    const todo = [...new Set(ids)].filter((id) => !p.live.statuses[id]);
    const s = await service.agentSession(k);
    const room = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId)).newProductsLeft;
    const take = todo.slice(0, Math.max(0, Math.min(room, 40)));
    const out: Record<string, LiveStatus> = { ...p.live.statuses };
    const batches: string[][] = [];
    for (let i = 0; i < take.length; i += 10) batches.push(take.slice(i, i + 10));
    // In parallel: one call per ten, all at once (a booking's ways out are priced in one go, not line by line).
    const results = p.requestId ? await Promise.all(batches.map((ids) => dock.lookupAvailability(s, { requestId: p.requestId!, productIds: ids, ...(p.settings.deliverBy ? { deliveryDate: p.settings.deliverBy } : {}) }).catch(() => undefined))) : [];
    for (const r of results) for (const st of r?.statuses ?? []) out[st.productId] = st;
    p.live.statuses = out;
    return out;
  }

  /** The kitchen's rules on one product: allergens and claims, nutrition rules, the mandate's product groups. */
  function rulesOn(k: MenuKitchen, prod: Product): PartCheck["rules"] {
    if (!k.mandate.allowedCategories.includes(prod.category)) return { ok: false, reason: `category ${prod.category} is not in the mandate` };
    const safety = checkSafety(prod, k.diet);
    if (safety.verdict !== "ok") return { ok: false, reason: safety.checks.filter((c) => c.verdict !== "ok").map((c) => c.reason).join("; ") };
    const nutrition = nutritionFindings(k.mandate.nutritionRules ?? [], { productId: prod.id, category: prod.category, nutrition: prod.nutrition ?? null });
    if (nutrition.length) return { ok: false, reason: nutrition.map((f) => f.reason).join(" ") };
    return { ok: true };
  }

  async function partCheck(k: MenuKitchen, p: PlanRecord, ing: DraftIngredient, main: boolean, covers: number, statuses: () => Record<string, LiveStatus>, cands: Product[]): Promise<PartCheck> {
    const amount = toBase((ing.perCover.amount * covers) / (ing.yieldPct / 100), ing.perCover.unit);
    const want = p.settings.deliverBy ?? addDaysIso(today(deps.now()), 1);
    const set = { candidates: cands.map((product) => ({ product, score: 1, safety: checkSafety(product, k.diet), why: [] as string[] })) };
    // The form the option names (frozen dill, dried dill) must be the product's form, read from its storage temperature.
    const formOk = (x: Product) => ing.form === "frozen" ? x.temperatureClass === "frozen" : ing.form === "dried" ? x.temperatureClass === "ambient" : ing.form === "fresh" ? x.temperatureClass !== "frozen" && x.temperatureClass !== "ambient" : true;
    const ok = set.candidates.filter((c) => rulesOn(k, c.product).ok && formOk(c.product));
    const live = { statuses: statuses(), deliverBy: want, calls: 0, at: deps.now().toISOString() };
    const res = optionsFor(amount, ok, live, k.mandate, deps.now(), want);
    const card = res.cards.find((c) => c.match === "full" && c.deliveryDate <= want) ?? res.cards[0];
    if (card) {
      const prod = ok.find((c) => c.product.id === card.lines[0].productId)!.product;
      const st = statuses()[prod.id];
      return {
        part: ing.name,
        main,
        product: { productId: prod.id, name: prod.names?.en ?? prod.name, packs: card.lines.reduce((s, l) => s + l.packs, 0), totalCents: card.totalCents, packText: card.lines.map((l) => `${l.packs} × ${formatAmt({ amount: l.packSize, unit: l.unit === "L" ? "L" : l.unit === "kg" ? "kg" : "pcs" })}`).join(" + ") },
        arrival: card.deliveryDate > want ? { ok: false, code: "later", why: `the earliest delivery is ${dayText(card.deliveryDate)}`, earliest: card.deliveryDate } : arrivalOf(st, want),
        rules: rulesOn(k, prod),
      };
    }
    // Nothing priced can come: say why for the first product found, or that the rules or the assortment ruled it out.
    const first = cands[0];
    if (!first) return { part: ing.name, main, arrival: { ok: false, code: "not_checked", why: "not found" }, rules: { ok: true } };
    return { part: ing.name, main, product: { productId: first.id, name: first.names?.en ?? first.name, packs: 0, totalCents: 0, packText: "" }, arrival: arrivalOf(statuses()[first.id], want), rules: rulesOn(k, first) };
  }

  /** The gate's preview of an option's lines, the main part named as a substitute for the product that cannot come. */
  async function signOffOf(k: MenuKitchen, p: PlanRecord, o: OptionToVerify, stuck: Stuck): Promise<SubOption["signOff"]> {
    if (!o.checks.length) return { needed: false, reason: "nothing to buy: a change in the kitchen, decided with the chef", approver: null, outcome: "unknown" };
    const s = await service.agentSession(k);
    const lines = o.checks.filter((c) => c.product && c.product.packs > 0).map((c) => ({ productId: c.product!.productId, quantity: c.product!.packs, ...(c.main && stuck.product ? { substituteFor: stuck.product.productId } : {}) }));
    const offers = Object.values(p.live.statuses).map((st) => st.offer).filter((x): x is LiveOffer => !!x);
    const d = p.requestId ? await dock.previewDecision(s, p.requestId, lines, offers).catch(() => undefined) : undefined;
    if (!d) return { needed: true, reason: "the gate could not preview it; a person decides", approver: null, outcome: "unknown" };
    const sub = d.rules.filter((r) => (r.rule === "substitution_rule" || r.rule === "substitute_price") && r.outcome !== "pass");
    if (d.outcome === "reject") return { needed: true, reason: d.reasons.join(" "), approver: null, outcome: d.outcome };
    if (sub.length) return { needed: true, reason: sub.map((r) => r.reason).join(" "), approver: d.outcome === "needs_human_approval" ? { name: d.approver.name, role: d.approver.role } : null, outcome: d.outcome };
    return { needed: false, reason: d.rules.find((r) => r.rule === "substitution_rule")?.reason ?? "inside the kitchen's preferences: the agent may decide", approver: null, outcome: d.outcome };
  }

  /** Options for one ingredient that cannot come, by its role: verified, ranked, each with the gate's word on it. */
  type Raw = { o: Omit<OptionToVerify, "checks" | "deltaCents">; parts: { ing: DraftIngredient; main: boolean; cands: Product[] }[] }[];

  /** Products known not to come by the day: never offered again as a way round. */
  const knownLate = (p: PlanRecord, id: string, want: string) => !!p.live.statuses[id] && !arrivalOf(p.live.statuses[id], want).ok;

  /** The ways out to check for one ingredient that cannot come, before any is priced (searches run at once). */
  async function gatherFor(k: MenuKitchen, p: PlanRecord, st: Stuck): Promise<Raw> {
    const spec = specOf(p, st.lineId)!;
    const allowed = (x: Product) => k.mandate.allowedCategories.includes(x.category);
    const want = p.settings.deliverBy ?? addDaysIso(today(deps.now()), 1);
    const raw: Raw = [];
    // 0. The same ingredient in another product of the range (fresh, then frozen): the most faithful way round, and the
    //    one truth about the product: "this product cannot come", never "the ingredient cannot be had" when another can.
    const same = await Promise.all([
      findCandidates(catalog, { ...spec.ingredient, form: spec.ingredient.form === "frozen" ? "frozen" : "any", avoid: [] }, k.diet, allowed, 12),
      spec.ingredient.form === "frozen" ? Promise.resolve(undefined) : findCandidates(catalog, { ...spec.ingredient, key: `${spec.key}_frozen`, searchTerms: [...spec.ingredient.searchTerms.slice(0, 2).map((t) => `${t} pakaste`), `frozen ${spec.ingredient.name}`], form: "frozen", avoid: [] }, k.diet, allowed, 8),
    ]);
    // "The same ingredient" means the thing itself: every word of one of its names in the product's name ("naudan poski",
    // "beef cheek"), so pork cheek is not beef cheek, whatever a search ranked it.
    const terms = [spec.name, ...spec.ingredient.searchTerms].map((t) => t.toLowerCase().split(/[^a-zåäö]+/u).filter((w) => w.length >= 3 && !/^(fresh|frozen|tuore|pakaste|raw)$/.test(w)).map((w) => w.slice(0, Math.min(6, Math.max(3, w.length - 2))))).filter((ws) => ws.length);
    // A two-word ingredient is matched by its two-word names only: "beef" alone would make brisket a beef cheek.
    const multi = terms.filter((ws) => ws.length >= 2);
    const named = multi.length ? multi : terms;
    const isIt = (c: { product: Product; why: string[] }) => named.some((ws) => { const n = [c.product.name, c.product.names?.fi, c.product.names?.en].filter(Boolean).join(" ").toLowerCase(); return ws.every((w) => n.includes(w)); });
    const other = (xs: { product: Product; why: string[] }[]) => xs.filter(isIt).map((c) => c.product).filter((x) => x.id !== st.product?.productId && !knownLate(p, x.id, want));
    const fresh = other(same[0].candidates).filter((x) => x.temperatureClass !== "frozen");
    const frozen = other([...(same[1]?.candidates ?? []), ...same[0].candidates]).filter((x) => x.temperatureClass === "frozen");
    if (fresh.length) raw.push({ o: { optionId: `${st.lineId}:same`, kind: "ingredient", title: `${spec.name}, another product`, tradeoff: { taste: "the same ingredient", texture: "the same", work: "none" }, fidelity: 0.95, source: "rules" }, parts: [{ ing: { ...spec.ingredient, avoid: [] }, main: true, cands: fresh.slice(0, 4) }] });
    if (frozen.length) raw.push({ o: { optionId: `${st.lineId}:same_frozen`, kind: "ingredient", title: `${spec.name}, frozen`, tradeoff: { taste: "the same ingredient", texture: "frozen: a little softer", work: "thaw it in the cold room overnight" }, fidelity: 0.88, source: "rules" }, parts: [{ ing: { ...spec.ingredient, form: "frozen", avoid: [] }, main: true, cands: [...new Map(frozen.map((x) => [x.id, x])).values()].slice(0, 4) }] });
    // 1. The rules of the kitchen: another ingredient that does the same job, the amount adjusted.
    const byRule = await Promise.all(
      subsFor(spec.ingredient, st.role).map(async (r) => {
        const parts = await Promise.all(
          r.parts.map(async (x) => {
            const unit = x.unit ?? spec.ingredient.perCover.unit;
            const ing: DraftIngredient = { ...spec.ingredient, key: `${spec.key}_${r.id}`, name: x.name, searchTerms: x.searchTerms, perCover: { amount: Math.round(spec.ingredient.perCover.amount * x.ratio * 1000) / 1000, unit }, form: x.form, avoid: [], yieldPct: 100 };
            const set = await findCandidates(catalog, ing, k.diet, allowed, 4);
            return { ing, main: x.main, cands: set.candidates.filter((c) => c.product.id !== st.product?.productId).map((c) => c.product) };
          }),
        );
        return { o: { optionId: `${st.lineId}:${r.id}`, kind: "ingredient" as const, title: r.title, tradeoff: r.tradeoff, fidelity: r.fidelity, source: "rules" as const }, parts };
      }),
    );
    raw.push(...byRule);
    // 2. The planner's own ways out (the product map's alternatives for the dish's use, the model's ideas), each re-checked here.
    for (const f of p.fixes[st.lineId] ?? []) {
      if (!f.ingredient || f.kind === "change_amount") continue;
      const set = p.candidates[`fix:${f.fixId}`];
      raw.push({ o: { optionId: `${st.lineId}:fix:${f.fixId}`, kind: f.changesDish ? "dish" : "ingredient", title: f.title, tradeoff: { taste: f.effect, texture: f.changesDish ? "the dish changes" : "close to the original", work: f.changesDish ? "a different recipe" : "none" }, fidelity: f.changesDish ? 0.5 : f.source === "code" ? 0.8 : 0.7, source: f.source === "code" ? "map" : "model" }, parts: [{ ing: f.ingredient, main: true, cands: (set?.candidates ?? []).map((c) => c.product).slice(0, 4) }] });
    }
    return raw;
  }

  /** The first products of every part of every way out, priced in one go. */
  const idsOf = (raw: Raw) => raw.flatMap((x) => x.parts.flatMap((pt) => pt.cands.slice(0, pt.main && x.o.optionId.includes(":same") ? 4 : 2).map((c) => c.id)));

  /** Options for one ingredient that cannot come, by its role: verified, ranked, each with the gate's word on it. */
  async function optionsForStuck(k: MenuKitchen, p: PlanRecord, view: PlanView, st: Stuck, gathered?: Raw): Promise<{ options: SubOption[]; unresolved: string[] }> {
    const spec = specOf(p, st.lineId)!;
    const covers = p.settings.covers ?? 0;
    const before = view.lines.find((l) => l.lineId === st.lineId)?.chosen?.totalCents ?? null;
    const raw = gathered ?? (await gatherFor(k, p, st));
    if (!gathered) await priceMore(k, p, idsOf(raw));
    // A model's or the map's stand-in for a protein that is another kind of food (tofu for whitefish) changes the dish.
    const kindWords = [spec.name, ...spec.ingredient.searchTerms].flatMap((t) => t.toLowerCase().split(/[^a-zåäö]+/u)).filter((w) => w.length >= 4).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    const verified: OptionToVerify[] = [];
    for (const x of raw) {
      const checks = await Promise.all(x.parts.map((pt) => partCheck(k, p, pt.ing, pt.main, covers, () => p.live.statuses, pt.cands)));
      const total = checks.reduce((s, c) => s + (c.product?.totalCents ?? 0), 0);
      const main = checks.find((c) => c.main)?.product;
      // The same ingredient in another product is said by that product's name: "HK beef cheek slow-cooked frozen 2 kg".
      if (main && /:same(_frozen)?$/.test(x.o.optionId)) x.o = { ...x.o, title: main.name };
      if (x.o.source !== "rules" && st.role === "protein" && main && !kindWords.some((w) => main.name.toLowerCase().includes(w))) {
        x.o = { ...x.o, fidelity: Math.min(x.o.fidelity, 0.45), tradeoff: { ...x.o.tradeoff, texture: "another kind of protein: the dish changes" } };
      }
      verified.push({ ...x.o, checks, deltaCents: before === null ? null : total - before });
    }
    // 3. A change to the component or the technique, with nothing to buy.
    const t = techniqueFor(st.role, st.ingredient);
    if (t) verified.push({ optionId: `${st.lineId}:${t.id}`, kind: "technique", title: t.title, tradeoff: t.tradeoff, fidelity: t.fidelity, source: "rules", checks: [], deltaCents: before === null ? null : -before });
    const ranked = rankOptions(verified);
    const unresolved = verified.filter((o) => !ranked.some((r) => r.optionId === o.optionId)).map((o) => {
      const why = o.checks.flatMap((c) => (!c.product ? [`${c.part}: not found`] : !c.rules.ok ? [`${c.part}: ${c.rules.reason}`] : !c.arrival.ok ? [`${c.part}: ${c.arrival.why}`] : []));
      return `${o.title}: ${why.join("; ") || "not among the best three"}`;
    });
    const options: SubOption[] = [];
    for (const o of ranked) options.push({ ...o, signOff: await signOffOf(k, p, o, st) });
    return { options, unresolved };
  }

  /** A replacement for a dish with an ingredient nothing can replace: planned with its dishes fixed, kept only if every line can come. */
  async function dishSwap(k: MenuKitchen, p: PlanRecord, st: Stuck, by: string): Promise<SubOption | undefined> {
    const dish = p.draft.dishes.find((d) => d.name === st.dish);
    if (!dish || !p.settings.covers) return undefined;
    const date = p.settings.deliverBy ?? addDaysIso(today(deps.now()), 1);
    const r = await service.plan(k, `One ${dish.course} for ${p.settings.covers} covers on ${date}, instead of ${dish.name}: a dish that needs no ${st.ingredient} and only everyday ingredients a wholesaler delivers next day.`, by).catch(() => undefined);
    if (!r || r.record.state !== "planned") return undefined;
    const lines = r.view.lines.filter((l) => l.status === "ready" || l.status === "needs_decision");
    const late = lines.filter((l) => !l.chosen || l.doubts.some((d) => !d.accepted && (d.kind === "cannot_arrive" || d.kind === "no_safe_product" || d.kind === "no_product" || d.kind === "rule_conflict")) || l.chosen.deliveryDate > date);
    if (!lines.length || late.length) return undefined;
    const name = r.record.draft.dishes[0]?.name ?? "another dish";
    const total = lines.reduce((s, l) => s + l.chosen!.totalCents, 0);
    const checks: PartCheck[] = lines.map((l) => ({ part: l.name, main: false, product: { productId: l.chosen!.products[0].productId, name: l.chosen!.products[0].name, packs: l.chosen!.products[0].packs, totalCents: l.chosen!.totalCents, packText: l.chosen!.products[0].packText }, arrival: { ok: true, date: l.chosen!.deliveryDate }, rules: { ok: true } }));
    const o: OptionToVerify = { optionId: `${st.lineId}:dish:${r.record.planId}`, kind: "dish", title: `${name} instead of ${dish.name}`, tradeoff: { taste: "a different dish", texture: "a different dish", work: "a different recipe for the kitchen" }, fidelity: 0.5, source: "model", checks, deltaCents: null };
    const ranked = rankOptions([o])[0];
    if (!ranked) return undefined;
    void total;
    return { ...ranked, signOff: { needed: false, reason: "every line is an ordinary product on the plan; the gate judges the order as a whole", approver: null, outcome: "unknown" }, dish: { name, nameFi: r.record.draft.dishes[0]?.nameFi ?? null, nameSv: r.record.draft.dishes[0]?.nameSv ?? null, planId: r.record.planId, lines: lines.flatMap((l) => l.chosen!.quoteLines.map((q) => ({ productId: q.productId, packs: q.quantity, name: l.chosen!.products.find((x) => x.productId === q.productId)?.name ?? q.productId }))) } };
  }

  /** `planId`: the same menu again for another day (no model call: the plan's date moves and its prices are asked again). */
  async function event(k: MenuKitchen, words: string, by: string, opts: { date?: string; swapDishes?: boolean; planId?: string; waitMs?: number } = {}): Promise<EventResult> {
    const first = opts.planId ? await service.get(k, opts.planId) : await service.plan(k, words, by);
    if (first.record.state === "declined") throw new DockError(422, "not_a_menu", first.record.declineReason ?? "This is not a request to plan food.");
    let planned = first;
    if (opts.date && opts.date !== first.record.settings.deliverBy) planned = await service.edit(k, first.record.planId, [{ op: "deliverBy", date: opts.date }], by);
    // The planner's own ways out (the model's ideas by the dish) are welcome if they come within 20 s; the options by
    // role do not wait for them.
    await Promise.race([service.settled(first.record.planId), new Promise((r) => setTimeout(r, opts.waitMs ?? 5_000))]);
    // What the kitchen has, from its own history (and what the words say it has), before anything is said missing.
    planned = opts.planId ? await service.get(k, first.record.planId) : await applyOnHand(k, first.record.planId, by, saidHave(words));
    // A line not priced yet is not "cannot arrive": ask the wholesaler for it first (one short batched call).
    // Up to three rounds of ten: a three-course menu has more lines than one call holds.
    for (let round = 0; round < 3 && planned.view.lines.some((l) => l.doubts.some((d) => !d.accepted && d.kind === "not_priced")); round++) planned = await service.edit(k, first.record.planId, [{ op: "price" }], by);
    // A small need that found only a large, dear pack: look wider for a smaller one before anything is said.
    const large = planned.view.lines.filter((l) => l.doubts.some((d) => !d.accepted && d.doubtId.endsWith(":large_pack"))).map((l) => l.lineId);
    if (large.length) planned = await service.edit(k, first.record.planId, large.map((lineId) => ({ op: "repack" as const, lineId })), by);
    const p = planned.record;
    const view = planned.view;
    const want = p.settings.deliverBy ?? addDaysIso(today(deps.now()), 1);
    const role = roleFor(p);
    const stuck: Stuck[] = [];
    const lines: EventResult["lines"] = [];
    for (const l of view.lines) {
      if (l.status === "merged") continue;
      const facts = lineFacts(l, role);
      if (l.status === "struck") {
        lines.push({ ...facts, arrival: null });
        continue;
      }
      const priced = (p.candidates[l.lineId]?.candidates ?? []).filter((c) => p.live.statuses[c.product.id]);
      const pid = l.chosen?.products[0].productId ?? priced[0]?.product.id;
      const status = pid ? p.live.statuses[pid] : undefined;
      const late = l.doubts.some((d) => !d.accepted && d.kind === "cannot_arrive");
      const arrival: Arrival = l.chosen && !late ? { ok: true, date: l.chosen.deliveryDate, ...(l.chosen.orderBy ? { orderBy: l.chosen.orderBy } : {}) } : arrivalOf(status, want);
      lines.push({ ...facts, arrival });
      if (!arrival.ok || late) {
        const spec = specOf(p, l.lineId);
        const prod = pid ? priced.find((c) => c.product.id === pid)?.product : undefined;
        stuck.push({
          lineId: l.lineId,
          ingredient: l.name,
          dish: spec?.uses[0]?.dish ?? "",
          role: role(l),
          roleText: spec?.uses.map((u) => u.role).join("; ") ?? "",
          product: prod ? { productId: prod.id, name: prod.names?.en ?? prod.name } : null,
          arrival: arrival.ok ? { ok: false, code: "later", why: l.timing?.text ?? "cannot arrive by the day" } : arrival,
        });
      }
    }
    if (stuck.length)
      log(k, p, "cannot_arrive", `Cannot arrive by ${dayText(want)}: ${stuck.map((x) => `${x.ingredient} for ${x.dish} (${x.product?.name ?? "no product"}: ${x.arrival.why})`).join("; ")}.`, {
        deliverBy: want,
        lines: stuck.map((x) => ({ lineId: x.lineId, ingredient: x.ingredient, role: x.role, productId: x.product?.productId ?? null, code: x.arrival.code, why: x.arrival.why, earliest: x.arrival.earliest ?? null })),
      });
    const options: EventResult["options"] = {};
    const unresolved: EventResult["unresolved"] = {};
    // Nothing at all can come by the day (no bought line arrives): the fix is the day, not every recipe. The earliest
    // day is the latest of the days the wholesaler names for the lines it can still deliver.
    const arriving = lines.filter((l) => l.arrival?.ok).length;
    const named = stuck.map((x) => x.arrival.earliest).filter((d): d is string => !!d).sort();
    const allLate = view.totals.allLate ?? (stuck.length && !arriving ? { neededBy: want, earliest: named.at(-1) ?? null } : null);
    if (!allLate) {
      // Every way out of every ingredient that cannot come, searched at once, then priced in one go, then verified.
      const top = stuck.slice(0, 8);
      const gathered = await Promise.all(top.map((st) => gatherFor(k, p, st)));
      await priceMore(k, p, gathered.flatMap(idsOf));
      const results = await Promise.all(top.map((st, i) => optionsForStuck(k, p, view, st, gathered[i])));
      let swapped = 0;
      for (const [i, st] of top.entries()) {
        const r = results[i];
        options[st.lineId] = r.options;
        unresolved[st.lineId] = r.unresolved;
        // Nothing does the job of a main course's protein: another main that can be fully sourced (one, the slowest step).
        const main = /main/.test(p.draft.dishes.find((d) => d.name === st.dish)?.course ?? "") && (st.role === "protein" || st.role === "body");
        if (!r.options.some((o) => o.kind !== "technique") && opts.swapDishes === true && main && swapped++ === 0) {
          const swap = await dishSwap(k, p, st, by);
          if (swap) options[st.lineId] = [...r.options, swap].sort((a, b) => b.score - a.score).map((o, i) => ({ ...o, rank: (["best", "better", "good"] as const)[Math.min(i, 2)] }));
        }
      }
      const shown = Object.entries(options).filter(([, os]) => os.length);
      if (shown.length)
        log(k, p, "substitution_options", `Ways round what cannot arrive, by each ingredient's role in its dish, every product verified (in the assortment, arrives ${dayText(want)}, the kitchen's rules): ${shown.map(([id, os]) => `${stuck.find((x) => x.lineId === id)?.ingredient} (${ROLE_TEXT[stuck.find((x) => x.lineId === id)!.role]}): ${os.map((o) => `${o.rank} ${o.title}${o.signOff.needed ? ", needs sign-off" : ""}`).join("; ")}`).join(" | ")}.`, {
          options: Object.fromEntries(shown.map(([id, os]) => [id, os.map((o) => ({ optionId: o.optionId, rank: o.rank, kind: o.kind, title: o.title, tradeoff: o.tradeoff, products: o.checks.flatMap((c) => (c.product ? [{ productId: c.product.productId, packs: c.product.packs, totalCents: c.product.totalCents }] : [])), signOff: o.signOff.needed }))])),
        });
    }
    const gate = await service.preview(k, p.planId, { view }).catch(() => undefined);
    return {
      scenario: "event",
      planId: p.planId,
      requestId: p.requestId ?? null,
      covers: p.settings.covers,
      deliverBy: want,
      dishes: p.draft.dishes.map((d) => ({ dishId: d.id, name: d.name, nameFi: d.nameFi ?? null, nameSv: d.nameSv ?? null, course: d.course })),
      lines,
      cannotArrive: stuck,
      allLate,
      options,
      unresolved,
      totalCents: view.totals.totalCents,
      gate: preview(gate, view),
      notes: p.notes,
      ...checksOf(view),
    };
  }

  const g = globalThis as typeof globalThis & { __dockScenarioCache?: Map<string, EventResult> };
  const cache: Map<string, EventResult> = (g.__dockScenarioCache ??= new Map<string, EventResult>());

  async function eventCached(k: MenuKitchen, words: string, by: string, opts: { date?: string; swapDishes?: boolean; planId?: string; waitMs?: number } = {}) {
    const r = await event(k, words, by, opts);
    cache.set(r.planId, r);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    return r;
  }

  /**
   * The order sheet's lines: every line being bought that can come by the day, each ingredient that cannot replaced by
   * the option chosen for it (its main part named as the substitute for the product it replaces, so the gate judges the
   * swap), a replacement dish's lines in place of the dish. What has no choice is left off and named. Records each
   * decision and who made it. `choices: "best"`: the agent takes the best option alone only where the gate's preview
   * says it is inside the kitchen's preferences; the others wait for the buyer.
   */
  async function sheetOf(k: MenuKitchen, planId: string, choices: Choice[] | "best", who: { by: string; agentAlone?: boolean; acceptPartial?: boolean }): Promise<SheetLines> {
    const { record: p, view } = await service.get(k, planId);
    const ev = cache.get(planId);
    const want = p.settings.deliverBy ?? undefined;
    const stuckIds = new Set(ev?.cannotArrive.map((x) => x.lineId) ?? []);
    const chosen = new Map<string, SubOption>();
    const decisions: SheetLines["decisions"] = [];
    if (ev) {
      for (const st of ev.cannotArrive) {
        const os = ev.options[st.lineId] ?? [];
        const asked = choices !== "best" && choices.some((c) => c.lineId === st.lineId);
        const named = asked ? os.find((o) => (choices as Choice[]).some((c) => c.lineId === st.lineId && c.optionId === o.optionId)) : undefined;
        if (asked && !named) throw new DockError(404, "option_not_found", `No verified option ${(choices as Choice[]).find((c) => c.lineId === st.lineId)!.optionId} for ${st.ingredient}.`);
        // An ingredient the buyer was not asked about: the agent takes the best option alone only when the gate's
        // preview says no one needs to sign it off (inside the kitchen's preferences, or nothing to buy).
        const pick = named ?? (choices === "best" || who.agentAlone ? os.find((o) => !o.signOff.needed && o.kind === "ingredient") : undefined);
        if (!pick) continue;
        chosen.set(st.lineId, pick);
        decisions.push({ lineId: st.lineId, ingredient: st.ingredient, optionId: pick.optionId, title: pick.title, by: named ? who.by : `agent:${k.agentId} (alone: inside the kitchen's preferences)` });
      }
    }
    const lines = new Map<string, { productId: string; packs: number; substituteFor?: string }>();
    const add = (productId: string, packs: number, substituteFor?: string) => {
      const prev = lines.get(productId);
      if (prev) prev.packs += packs;
      else lines.set(productId, { productId, packs, ...(substituteFor ? { substituteFor } : {}) });
    };
    const leftOff: SheetLines["leftOff"] = [];
    const swappedDishes = new Set([...chosen.entries()].filter(([, o]) => o.kind === "dish" && o.dish).map(([id]) => ev!.cannotArrive.find((x) => x.lineId === id)!.dish));
    for (const l of view.lines) {
      if (l.status !== "ready" && l.status !== "needs_decision") continue;
      if (l.uses.every((u) => swappedDishes.has(u.dish))) continue;
      if (stuckIds.has(l.lineId)) {
        const o = chosen.get(l.lineId);
        const st = ev!.cannotArrive.find((x) => x.lineId === l.lineId)!;
        if (!o) leftOff.push({ name: l.name, why: `${st.arrival.why}; no option chosen` });
        else if (o.kind === "dish" && o.dish) for (const x of o.dish.lines) add(x.productId, x.packs);
        // The main part is declared a substitute for the product it replaces when that product has a price to compare
        // with; one the wholesaler cannot offer at all has none, and the swap is then judged as a menu line (and logged).
        else for (const c of o.checks) if (c.product && c.product.packs > 0) add(c.product.productId, c.product.packs, c.main && st.product && p.live.statuses[st.product.productId]?.offer ? st.product.productId : undefined);
        continue;
      }
      const open = l.doubts.filter((d) => !d.accepted);
      if (!l.chosen || open.some((d) => !d.acceptLabel)) {
        leftOff.push({ name: l.name, why: (open.find((d) => !d.acceptLabel)?.text ?? "nothing to buy").replace(/\s*\(searched:[^)]*\)/g, "") });
        continue;
      }
      for (const q of l.chosen.quoteLines) add(q.productId, q.quantity, q.substituteFor);
    }
    for (const d of decisions) {
      const o = chosen.get(d.lineId)!;
      log(k, p, "substitution_chosen", `${d.ingredient}: ${o.rank} option "${o.title}" chosen by ${d.by}. Trade-off: ${o.tradeoff.taste}; ${o.tradeoff.texture}; work: ${o.tradeoff.work}.${o.checks.length ? ` Buys ${o.checks.filter((c) => c.product).map((c) => `${c.product!.packText} ${c.product!.name}${c.main ? " (the substitute)" : ""}`).join(" + ")}, ${formatEur(o.checks.reduce((s, c) => s + (c.product?.totalCents ?? 0), 0))}.` : ""} ${o.signOff.needed ? `Sign-off: ${o.signOff.reason}` : "Inside the kitchen's preferences."}`, { lineId: d.lineId, optionId: o.optionId, rank: o.rank, kind: o.kind, by: d.by, signOff: o.signOff.needed }, d.by.startsWith("agent:") ? `agent:${k.agentId}` : `buyer:${d.by}`);
    }
    // Not the dish: an ingredient not covered (and not replaced by a chosen option) stops the sheet, unless the buyer
    // accepted ordering only what can be bought. The refusal carries every missing ingredient with its code and words.
    const missing = view.totals.missing.filter((m) => !(m.lineId && chosen.has(m.lineId)) && !swappedDishes.has(m.dish));
    if (missing.length && !p.acceptPartial && !who.acceptPartial)
      throw new DockError(409, "plan_incomplete", `Only ${view.totals.ingredients - missing.length} of ${view.totals.ingredients} ingredients can be bought${missing.some((m) => m.defining) ? ", and what the dish is made of is not among them" : ""}: ${missing.map((m) => `${m.ingredient} (${m.words})`).join("; ")}.`, undefined, { covered: view.totals.ingredients - missing.length, of: view.totals.ingredients, definingMissing: missing.some((m) => m.defining), missing: missing.map((m) => ({ ingredient: m.ingredient, dish: m.dish, code: m.code, words: m.words, defining: m.defining, ...(m.detail?.group ? { group: m.detail.group } : {}) })) });
    if (!lines.size) throw new DockError(409, "menu_nothing_to_order", leftOff.length ? `Nothing on this menu can be ordered: ${leftOff.map((x) => `${x.name} (${x.why})`).join("; ")}.` : "Nothing on this menu is being bought.");
    return { lines: [...lines.values()], ...(want ? { deliveryDate: want } : {}), text: `Menu for ${p.settings.covers ?? "?"} covers: ${p.draft.dishes.filter((d) => !swappedDishes.has(d.name)).map((d) => d.name).concat([...chosen.values()].flatMap((o) => (o.kind === "dish" && o.dish ? [o.dish.name] : []))).join(", ")}`.slice(0, 2000), leftOff, decisions };
  }

  /** For an outside agent: the sheet as one signed quote and one order through the gate, under its own mandate. */
  async function order(k: MenuKitchen, planId: string, sheet: SheetLines) {
    const { record: p } = await service.get(k, planId);
    if (!p.requestId) throw new DockError(409, "plan_not_ready", "The plan has no request.");
    const s = await service.agentSession(k);
    if (sheet.deliveryDate && sheet.deliveryDate !== p.requestNeededBy) await dock.changeNeededBy(s, p.requestId, { neededBy: sheet.deliveryDate, by: p.by, reason: "the menu's service day" }).catch(() => undefined);
    const q = await dock.requestQuote(s, { requestId: p.requestId, lines: sheet.lines.map((l) => ({ productId: l.productId, quantity: l.packs, ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}) })) });
    const placed = await dock.placeOrder(s, { requestId: p.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
    return { quote: { quoteId: q.quote.quoteId, totalCents: q.quote.totalCents, expiresAt: q.quote.expiresAt }, order: placed };
  }

  /** The seasonal plan's lines, every line being bought (the shortfall), as an order sheet. */
  async function seasonalSheet(k: MenuKitchen, planId: string, by: string): Promise<SheetLines> {
    return sheetOf(k, planId, [], { by });
  }

  return { anchors, seasonal, event: eventCached, sheetOf, seasonalSheet, order, applyOnHand, cached: (planId: string) => cache.get(planId) };
}

export type Scenarios = ReturnType<typeof createScenarios>;

