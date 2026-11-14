import type { AlternativesSource } from "@/core/alternatives";
import type { Door } from "@/core/orders";
import { MAX_LIVE_IDS_PER_CALL, usableOffer, type LiveOffer, type LiveStatus, type Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import { allergenInName, definingConflict, isDefining, missingEssentials } from "@/core/dish-rules";
import { addDaysIso, formatDay, isoWeekday, latestDeliveryDay, localNow } from "@/core/kitchen";
import { CATEGORY_SLUGS } from "@/core/catalog/partner";
import labels from "../../catalog-categories.json";
import { groupName, kitchenGroups, setGroupLabels } from "./coverage";
import { nutritionFindings } from "@/core/nutrition";
import { agentKeyOf } from "@/core/live-allowance";
import type { AgentSession, Dock, PublicOrder } from "@/core/orders";
import type { Decision } from "@/core/policy";
import type { Quote } from "@/core/quote";
import type { OnHand } from "@/core/on-hand";
import { formatEur, newId } from "@/core/util";
import { onsiteSession } from "../../ops/onsite";
import type { CallStats, DraftIngredient, DraftOptions, DraftOutline, DraftResult, MenuDraft } from "./draft";
import type { FixResult, FixRequest } from "./fixes";
import { toFixOptions } from "./fixes";
import type { MenuKitchen } from "./kitchens";
import { findCandidates, type CandidateSet, type MenuCatalog } from "./match";
import { checkSafety, withRequestRules, type DietRules } from "./safety";
import {
  packAmount,
  buildSpecs,
  computePlan,
  formatAmt,
  liveShortlist,
  optionsFor,
  toBase,
  type Acceptance,
  type FixOption,
  type LineEdits,
  type LineSpec,
  type LiveData,
  type PlanInput,
  type PlanView,
} from "./plan";
import type { PickLine, PickResult } from "./pick";
import type { MenuPromptContext } from "./prompts";

/**
 * The menu planner's flow, holding a plan's state between the chef's edits:
 *
 *   plan    the model drafts dishes and amounts (outline, then every dish in parallel); plain code finds products,
 *           prices a short list in batched live calls (at most 10 products each, within the agent's hourly
 *           allowance), and asks the model for ways out only for lines that cannot be bought as planned
 *   edit    covers, date, amounts, yields, struck lines, another option, acceptances, a fix: plain code only, no
 *           model call; a live call only for products not priced yet
 *   quote   the whole plan as ONE multi-line fixed-price quote through the existing gate, each line explained in
 *           the ledger first
 *   order   placed through the gate: mandate, weekly budget, substitution rules and sign-off apply to the basket
 */

export type PlanState = "declined" | "planned" | "quoted" | "ordered";

export type PlanRecord = {
  planId: string;
  kitchen: string;
  text: string;
  by: string;
  createdAt: string;
  updatedAt: string;
  state: PlanState;
  declineReason?: string;
  requestId?: string;
  requestNeededBy?: string | null;
  model: { id: string; ms: number; costUsd: number | null; calls: CallStats[]; recorded: boolean };
  draft: MenuDraft;
  /** The model's raw outputs, kept for recordings and the evaluation; never sent to screens. */
  raw: { draft: import("./draft").LlmMenuDraft; fixes: Record<string, import("./fixes").LlmFixes> };
  specs: LineSpec[];
  candidates: PlanInput["candidates"];
  live: LiveData;
  edits: Record<string, LineEdits>;
  acceptances: Acceptance[];
  fixes: Record<string, FixOption[]>;
  settings: PlanInput["settings"];
  timings: { draftMs: number; matchMs: number; liveMs: number; fixMs: number; totalMs: number };
  /** Live calls this plan made, and products priced, in total. */
  liveUse: { calls: number; products: number; refused?: string };
  notes: string[];
  /** True while proposals for stuck lines are still being worked out. */
  pending?: boolean;
  quote?: { quote: Quote; quoteToken: string; policyPreview: Decision; claims: number };
  order?: PublicOrder;
  error?: { code: string; message: string; rule?: string };
  /** Dishes refused because what they are made of breaks a kitchen rule (core/dish-rules.ts), with the rule named. */
  refused?: RefusedDish[];
  /** Up to three dishes of the same kind that can be made instead, each ingredient checked against the rules. */
  instead?: InsteadDish[];
  /** The buyer accepted ordering only what can be bought ("order just those three"): who, when, and of how many. */
  acceptPartial?: { by: string; at: string; covered: number; of: number };
  /** Lines plain code added because the recipe could not be made without them (a cake's flour and sweetener). */
  added?: { dishId: string; dish: string; key: string; name: string; what: string }[];
};

setGroupLabels(labels as { departments: Record<string, string>; categories: Record<string, { label: string }> });
const SLUG_CODE = new Map(Object.entries(CATEGORY_SLUGS).map(([code, slug]) => [slug, code]));
/** The partner's category code of a Dock category slug ("cream" -> 10401, "cat_18760" -> 18760). */
export const codeOfSlug = (slug: string) => /^cat_(\d+)$/.exec(slug)?.[1] ?? SLUG_CODE.get(slug);

/** One dish idea and what plain code found for each of its ingredients in master data and the kitchen's rules. */
export type IdeaCheck = {
  dishId: string;
  name: string;
  nameFi: string | null;
  nameSv: string | null;
  course: string;
  portion: string;
  buyable: boolean;
  refused?: { ingredient: string; rule: { text: string; source: string } };
  items: { ingredient: string; ingredientFi: string | null; status: "buyable" | "staple" | "not_covered"; code?: "outside_groups" | "rule" | "not_sold"; words: string; defining: boolean; group?: string }[];
  missing: IdeaCheck["items"];
  definingMissing: boolean;
  kitchenGroups: string[];
};

export type RefusedDish = { dishId: string; name: string; ingredient: string; allergen: string; rule: { text: string; source: string } };
export type InsteadDish = { name: string; nameFi: string | null; nameSv?: string | null; course: string; portion: string; ingredients: string[]; checked: string };

export type PlanDeps = {
  dock: Dock;
  catalog: MenuCatalog;
  now: () => Date;
  draft: (text: string, ctx: MenuPromptContext, now: Date, onDish?: (ingredients: DraftIngredient[], dish?: { dishId: string; name: string }) => void, onOutline?: (outline: DraftOutline) => void, onDishPartial?: DraftOptions["onDishPartial"]) => Promise<DraftResult & { recorded?: boolean }>;
  fix?: (req: FixRequest, ctx: MenuPromptContext) => Promise<FixResult>;
  /** Which found products are the ingredient (a fast model judging names). Absent: the code's ranking stands. */
  pick?: (lines: PickLine[]) => Promise<PickResult>;
  /** What can stand in for a line's product in the dish's use (the product knowledge map; see core/alternatives.ts). */
  alternatives?: AlternativesSource;
  store: PlanStore;
};

export interface PlanStore {
  get(planId: string): Promise<PlanRecord | undefined>;
  save(plan: PlanRecord): Promise<void>;
}

export class InMemoryPlanStore implements PlanStore {
  private items = new Map<string, PlanRecord>();
  async get(id: string) {
    const p = this.items.get(id);
    return p && structuredClone(p);
  }
  async save(p: PlanRecord) {
    this.items.set(p.planId, structuredClone(p));
    if (this.items.size > 200) this.items.delete(this.items.keys().next().value!);
  }
}

/**
 * What a plan has so far, while it is being made (plan(…, { onProgress })): the outline (dishes, other menus offered),
 * each dish's ingredients as it is written, then the lines matched to products before live prices. Additive: a
 * caller that passes nothing gets the same plan at the same time.
 */
export type PlanProgress =
  | { kind: "outline"; planId: string; outline: DraftOutline }
  /** A dish still being written: the ingredients complete so far, unchecked (the checked list follows as `dish`). */
  | { kind: "dish_partial"; planId: string; dishId: string; name: string; ingredients: Parameters<NonNullable<DraftOptions["onDishPartial"]>>[0] }
  | { kind: "dish"; planId: string; dishId: string; name: string; ingredients: DraftIngredient[] }
  | { kind: "matched"; planId: string; record: PlanRecord; view: PlanView; ms: number };

/** Live products per plan: two per line at first, so one plan stays inside the agent's hourly allowance. */
export const LIVE_PER_LINE = 2;
export const LIVE_MAX_PER_PLAN = 16;

export function promptContext(k: MenuKitchen): MenuPromptContext {
  return { kitchenName: k.info.name, kitchenKind: k.info.kind, rules: k.info.rules.map((r) => r.text), pantry: k.info.pantry };
}

/** Candidate sets with each product's safety judged again under `diet`; blocked products move to `rejected`. */
export function recheck(sets: PlanInput["candidates"], diet: DietRules): PlanInput["candidates"] {
  const out: PlanInput["candidates"] = {};
  for (const [id, set] of Object.entries(sets)) {
    if (!set) continue;
    const kept: CandidateSet["candidates"] = [];
    const rejected = [...set.rejected];
    for (const c of set.candidates) {
      const safety = checkSafety(c.product, diet);
      if (safety.verdict === "block") rejected.push({ productId: c.product.id, name: c.product.name, reason: safety.checks.filter((x) => x.verdict === "block").map((x) => x.reason).join("; ") });
      else kept.push({ ...c, safety });
    }
    out[id] = { ...set, candidates: kept, rejected };
  }
  return out;
}

function statusesFrom(r: { offers: import("@/core/catalog").LiveOffer[]; unavailable: { productId: string; problems: LiveStatus["problems"]; message: string }[]; statuses?: LiveStatus[] }): LiveStatus[] {
  // The wholesaler's own statuses when the lookup returns them: a product that cannot come keeps its cut-off and day.
  if (r.statuses?.length) return r.statuses.map((st) => (r.offers.some((o) => o.productId === st.productId) ? { ...st, offer: r.offers.find((o) => o.productId === st.productId) } : st));
  return [
    ...r.offers.map((o) => ({ productId: o.productId, orderable: true, problems: [], offer: o, message: "" }) as LiveStatus),
    ...r.unavailable.map((u) => ({ productId: u.productId, orderable: false, problems: u.problems, message: u.message }) as LiveStatus),
  ];
}

export function createPlanService(deps: PlanDeps) {
  const { dock, catalog, store } = deps;

  /** The menu agent's session, through the same operations check as a call over HTTP (ops/onsite.ts): suspended, it plans, quotes and orders nothing. Its requests carry the door. */
  async function session(k: MenuKitchen, door: Door = "menu"): Promise<AgentSession> {
    // An outside agent's own session (MCP, REST): its mandate binds the plan, never the kitchen's menu agent's.
    if (k.session) return { ...k.session, door: k.session.door ?? door };
    return { ...(await onsiteSession(dock, k, door === "menu" ? "menu planner" : `${door} door`)), door };
  }

  async function spentThisWeek(orgId: string): Promise<number> {
    const since = deps.now().getTime() - 7 * 86_400_000;
    return (await dock.listOrders({ orgId }))
      .filter((o) => (o.status === "committed" || o.status === "pending_approval") && Date.parse(o.createdAt) > since)
      .reduce((s, o) => s + o.totalCents, 0);
  }

  function log(p: PlanRecord, k: MenuKitchen, actor: string, summary: string, data: Record<string, unknown> = {}) {
    if (!p.requestId) return;
    dock.ledger.append({ type: "intake", actor, requestId: p.requestId, summary, data: { step: "menu_plan", planId: p.planId, ...data } });
    void k;
  }

  /** One batched live lookup per 10 products, in parallel; refusals by the allowance are kept, not thrown. */
  async function price(p: PlanRecord, s: AgentSession, ids: string[]): Promise<void> {
    const todo = [...new Set(ids)].filter((id) => !p.live.statuses[id]);
    if (!todo.length || !p.requestId) return;
    const left = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId));
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += MAX_LIVE_IDS_PER_CALL) batches.push(todo.slice(i, i + MAX_LIVE_IDS_PER_CALL));
    const t0 = Date.now();
    const results = await Promise.allSettled(
      batches.map((productIds) => dock.lookupAvailability(s, { requestId: p.requestId!, productIds, ...(p.settings.deliverBy ? { deliveryDate: p.settings.deliverBy } : {}) })),
    );
    p.timings.liveMs += Date.now() - t0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        for (const st of statusesFrom(r.value)) p.live.statuses[st.productId] = st;
        p.liveUse.calls += 1;
        p.liveUse.products += batches[i].length;
      } else {
        const e = r.reason as DockError;
        p.liveUse.refused = e instanceof DockError ? `${e.message}${e.code === "live_lookup_budget_exceeded" ? ` (${left.callsLeft} calls and ${left.newProductsLeft} new products were left this hour)` : ""}` : "Live prices could not be fetched.";
      }
    });
    p.live.calls = p.liveUse.calls;
    p.live.at = deps.now().toISOString();
  }

  function input(p: PlanRecord, k: MenuKitchen, spent: number): PlanInput {
    // Every line passes the kitchen's rules and the request's own ("nut-free"), checked again here on the data,
    // whatever the draft or an edit put on the plan; a product that breaks one is moved to the rejected list.
    const diet = withRequestRules(k.diet, p.draft ?? {});
    const candidates = diet === k.diet ? p.candidates : recheck(p.candidates, diet);
    return { draft: p.draft, specs: p.specs, candidates, live: p.live, edits: p.edits, acceptances: p.acceptances, fixes: p.fixes, settings: p.settings, mandate: k.mandate, diet, now: deps.now(), spentThisWeekCents: spent, rules: k.info.rules, refused: p.refused ?? [], instead: p.instead ?? [], coverageCtx: { codeOf: codeOfSlug, kitchenGroups: kitchenGroups(k.mandate.allowedCategories, codeOfSlug) }, ...(p.acceptPartial ? { acceptPartial: p.acceptPartial } : {}) };
  }

  const allowedFor = (k: MenuKitchen) => {
    const allowed = new Set(k.mandate.allowedCategories);
    return (p: Product) => allowed.has(p.category);
  };

  /**
   * Ways out for lines that cannot be bought as planned, checked here. First what the product knowledge map ranks as
   * a stand-in for the line's product in the dish's use (good, better, best, with its reason; or its reason why there
   * is no good alternative), then the model's ideas by the dish's logic. Plain code checks every one the same way.
   */
  async function proposeFixesFor(p: PlanRecord, k: MenuKitchen, s: AgentSession, view: PlanView): Promise<void> {
    if (!deps.fix && !deps.alternatives) return;
    // When nothing can arrive by the date, the fix is the date, not every recipe: no proposals for lateness then.
    const kinds = view.totals.allLate ? ["no_safe_product", "no_product", "rule_conflict"] : ["cannot_arrive", "no_safe_product", "no_product", "rule_conflict"];
    const stuck = view.lines.filter((l) => l.doubts.some((d) => !d.accepted && kinds.includes(d.kind)) && !p.fixes[l.lineId]);
    if (!stuck.length) return;
    const t0 = Date.now();
    const rules = [...k.info.rules.map((r) => r.text), ...p.draft.requiredClaims.map((c) => `must be ${c.replace(/_/g, "-")}`), ...p.draft.forbiddenAllergens.map((a) => `no ${a}`)];
    const pending: { lineId: string; fix: FixOption; spec: LineSpec; only?: string[] }[] = [];
    const lines = stuck.slice(0, 6);
    for (const line of lines) p.fixes[line.lineId] = [];

    // 1. The product map, by the dish's use. The kitchen's rules go in as constraints; plain code re-checks below.
    if (deps.alternatives) {
      const requiredClaims = [...new Set([...k.diet.requiredClaims.map((c) => c.claim), ...p.draft.requiredClaims])];
      const forbiddenAllergens = [...new Set([...k.diet.forbiddenAllergens.map((f) => f.allergen), ...p.draft.forbiddenAllergens])];
      for (const line of lines) {
        const spec = p.specs.find((x) => x.lineId === line.lineId)!;
        const dish = p.draft.dishes.find((d) => d.id === spec.uses[0].dishId);
        const set = p.candidates[line.lineId];
        const anchor = set?.candidates[0]?.product.id ?? set?.rejected[0]?.productId;
        if (!anchor) continue;
        const alt = await deps.alternatives(anchor, { text: `${spec.ingredient.name} for ${dish?.name ?? spec.uses[0].dish} ${spec.uses.map((u) => u.role).join(" ")}`, requiredClaims, forbiddenAllergens }).catch(() => undefined);
        if (!alt) continue;
        const found = new Map((alt.substitutes.length ? await catalog.get(alt.substitutes.slice(0, 3).map((x) => x.productId)) : []).map((x) => [x.id, x]));
        for (const x of alt.substitutes.slice(0, 3)) {
          const prod = found.get(x.productId);
          if (!prod) continue;
          const name = prod.names?.en ?? prod.name;
          const fix: FixOption = {
            fixId: `${line.lineId}:map${p.fixes[line.lineId].length + 1}`,
            kind: "substitute",
            title: `${name} instead (${x.tier} alternative${alt.use ? ` for ${alt.use}` : ""})`,
            effect: x.reason,
            changesDish: false,
            source: "code",
            ingredient: { ...spec.ingredient, key: `${spec.ingredient.key}_alt`, name, searchTerms: [prod.names?.fi ?? prod.name, name].filter(Boolean) as string[] },
          };
          p.fixes[line.lineId].push(fix);
          pending.push({ lineId: line.lineId, fix, spec, only: [x.productId, ...x.otherPacks] });
        }
        if (!alt.substitutes.length && alt.none) {
          p.fixes[line.lineId].push({ fixId: `${line.lineId}:map0`, kind: "substitute", title: "No good alternative in the catalogue", effect: alt.none, changesDish: false, source: "code", check: { ok: false, reason: alt.none } });
        }
      }
    }

    // 2. The model's ideas by the dish's logic.
    const results = deps.fix
      ? await Promise.allSettled(
          lines.map(async (line) => {
            const spec = p.specs.find((x) => x.lineId === line.lineId)!;
            const dish = p.draft.dishes.find((d) => d.id === spec.uses[0].dishId)!;
            const problem = line.doubts.filter((d) => !d.accepted).map((d) => d.text).join(" ");
            const r = await deps.fix!({ lineKey: spec.key, dish: dish.name, method: dish.method, ingredient: spec.ingredient, problem, rules }, promptContext(k));
            p.model.calls.push({ step: `fix ${spec.key}`, ms: r.ms, tokens: r.tokens, costUsd: r.costUsd });
            p.raw.fixes[spec.key] = r.fixes;
            return { line, spec, proposals: toFixOptions(r.fixes, spec.ingredient) };
          }),
        )
      : [];
    // Search for every substitute, then price the best of each in one batched call.
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { line, spec, proposals } = r.value;
      for (const [i, pr] of proposals.entries()) {
        const fix: FixOption = { fixId: `${line.lineId}:fix${i + 1}`, kind: pr.kind, title: pr.title, effect: pr.effect, changesDish: pr.changesDish, source: "model", ...(pr.ingredient ? { ingredient: pr.ingredient } : {}), ...(pr.perCover ? { perCover: pr.perCover } : {}) };
        p.fixes[line.lineId].push(fix);
        pending.push({ lineId: line.lineId, fix, spec });
      }
    }
    const allowed = allowedFor(k);
    const subs = await Promise.all(
      pending.map(async (x) => {
        if (!x.fix.ingredient) return { x, set: undefined };
        const set = await findCandidates(catalog, x.fix.ingredient, k.diet, allowed, x.only ? 12 : 3);
        // A product the map proposed is checked as itself, not as whatever else its name finds.
        return { x, set: x.only ? { ...set, candidates: set.candidates.filter((c) => x.only!.includes(c.product.id)) } : set };
      }),
    );
    for (const { x, set } of subs) if (set) p.candidates[`fix:${x.fix.fixId}`] = set;
    await pick(
      p,
      subs.filter(({ set }) => set && set.candidates.length).map(({ x }) => ({ ...x.spec, lineId: `fix:${x.fix.fixId}`, ingredient: x.fix.ingredient! })),
    );
    for (const sub of subs) if (sub.set) sub.set = p.candidates[`fix:${sub.x.fix.fixId}`];
    await price(p, s, subs.flatMap(({ set }) => (set?.candidates[0] ? [set.candidates[0].product.id] : [])).slice(0, 10));
    const covers = p.settings.covers ?? 0;
    for (const { x, set } of subs) {
      const current = view.lines.find((l) => l.lineId === x.lineId);
      const before = current?.chosen?.totalCents ?? null;
      if (x.fix.kind === "change_dish" && !x.fix.ingredient) {
        x.fix.check = { ok: true, product: "nothing to buy for this line", packs: "-", totalCents: 0, deltaCents: before === null ? null : -before, deliveryDate: "-", note: "The line is struck; the dish changes as described." };
        continue;
      }
      const ing = x.fix.ingredient ?? { ...x.spec.ingredient, perCover: { amount: x.fix.perCover!, unit: x.spec.ingredient.perCover.unit } };
      const cands = set ? set.candidates : (p.candidates[x.lineId]?.candidates ?? []);
      if (!cands.length) {
        x.fix.check = { ok: false, reason: set?.rejected[0] ? `no product passes: ${set.rejected[0].name} (${set.rejected[0].reason})` : "no product in the catalogue fits it" };
        continue;
      }
      if (covers <= 0) {
        x.fix.check = { ok: false, reason: "give the number of covers first" };
        continue;
      }
      const amount = toBase((ing.perCover.amount * covers) / (ing.yieldPct / 100), ing.perCover.unit);
      const res = optionsFor(amount, cands, p.live, k.mandate, deps.now(), p.settings.deliverBy);
      const card = res.cards.find((c) => c.match === "full") ?? res.cards[0];
      const safety = cands.find((c) => c.product.id === card?.lines[0].productId)?.safety;
      if (!card) {
        x.fix.check = { ok: false, reason: res.excluded[0]?.reason ?? "not priced" };
        continue;
      }
      if (safety && safety.verdict !== "ok") {
        x.fix.check = { ok: false, reason: `not offered as safe: ${safety.checks.filter((c) => c.verdict !== "ok").map((c) => c.reason).join("; ")}` };
        continue;
      }
      x.fix.check = {
        ok: true,
        product: card.lines.map((l) => l.name).join(" + "),
        packs: card.lines.map((l) => `${l.packs} × ${formatAmt({ amount: l.packSize, unit: l.unit === "L" ? "L" : l.unit === "kg" ? "kg" : "pcs" })}`).join(" + "),
        totalCents: card.totalCents,
        deltaCents: before === null ? null : card.totalCents - before,
        deliveryDate: card.deliveryDate,
        ...(card.orderBy ? { orderBy: card.orderBy } : {}),
        ...(card.match === "compromise" ? { note: card.givesUp.map((g) => g.text).join(" ") } : {}),
      };
      if (x.fix.ingredient && set) p.candidates[`fix:${x.fix.fixId}`] = set;
    }
    p.timings.fixMs += Date.now() - t0;
  }

  /** Narrow each line's candidates to the products that are the ingredient, in the order a cook would take them. */
  async function pick(p: PlanRecord, specs: LineSpec[], key = (s: LineSpec) => s.lineId): Promise<void> {
    if (!deps.pick) return;
    const lines: PickLine[] = specs
      .map((spec) => ({ lineId: key(spec), ingredient: spec.ingredient.name, role: spec.uses.map((u) => `${u.role} in ${u.dish}`).join("; "), form: spec.ingredient.form, candidates: (p.candidates[key(spec)]?.candidates ?? []).map((c) => ({ id: c.product.id, name: [c.product.names?.en, c.product.names?.fi].filter(Boolean).join(" / ") || c.product.name })) }))
      .filter((l) => l.candidates.length > 0 && !p.candidates[l.lineId]?.judged); // smart search's judge already checked these
    if (!lines.length) return;
    // One small call per ingredient, all at once: the answer for the last dish comes back in about two seconds.
    const results = await Promise.allSettled(lines.map((l) => deps.pick!([l])));
    let failed = 0;
    results.forEach((res) => {
      if (res.status !== "fulfilled") {
        failed++;
        return;
      }
      const r = res.value;
      p.model.calls.push({ step: "pick", ms: r.ms, tokens: r.tokens, costUsd: r.costUsd });
      for (const l of r.pick.lines) {
        const set = p.candidates[l.lineId];
        if (!set) continue;
        const fits = l.fits.filter((id) => set.candidates.some((c) => c.product.id === id));
        const kept = fits.map((id) => set.candidates.find((c) => c.product.id === id)!);
        for (const c of set.candidates.filter((c) => !fits.includes(c.product.id))) set.rejected.unshift({ productId: c.product.id, name: c.product.name, reason: `not this ingredient for the role, judged by ${r.model}${l.note ? `: ${l.note}` : ""}` });
        set.candidates = kept;
      }
    });
    if (failed) p.notes.push(`The check of product names did not answer for ${failed} ingredient${failed > 1 ? "s" : ""}; the code's own ranking was used there.`);
  }

  async function finishView(p: PlanRecord, k: MenuKitchen) {
    p.model.costUsd = p.model.calls.some((c) => c.costUsd === null) ? null : Math.round(p.model.calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) * 1e6) / 1e6;
    const spent = await spentThisWeek(k.mandate.issuer.orgId);
    return { record: p, view: computePlan(input(p, k, spent)) };
  }

  /**
   * Plain code over the draft, before anything is matched: a dish made of what a kitchen rule forbids is refused with
   * the rule named (core/dish-rules.ts definingConflict), never planned with the ingredient quietly left out; a dish
   * of a known kind missing what it cannot be made without (a cake's flour and sweetener) gets those lines added,
   * visibly, at a standard amount to check, or as a staple the kitchen keeps when it is on its pantry list.
   */
  function checkDishes(p: PlanRecord, k: MenuKitchen, pantry: string[]) {
    const forbidden = [...new Set([...k.diet.forbiddenAllergens.map((f) => f.allergen), ...p.draft.forbiddenAllergens])];
    for (const dish of p.draft.dishes) {
      const c = definingConflict(dish, forbidden, k.info.rules);
      if (c) {
        (p.refused ??= []).push({ dishId: dish.id, name: dish.name, ingredient: c.ingredient, allergen: c.allergen, rule: c.rule });
        continue;
      }
      for (const m of missingEssentials(dish)) {
        const staple = pantry.some((w) => w.toLowerCase() === m.add.name.toLowerCase() || m.add.searchTerms.some((t) => t.toLowerCase() === w.toLowerCase()));
        dish.ingredients.push({ ...m.add, yieldPct: 100, amountBasis: `added by plain code: a ${m.kind} cannot be made without ${m.what}; a standard share per cover, check it`, pantry: staple, avoid: [] });
        (p.added ??= []).push({ dishId: dish.id, dish: dish.name, key: m.add.key, name: m.add.name, what: m.what });
      }
    }
    for (const r of p.refused ?? []) p.notes.push(`${r.name} cannot be made under the kitchen's rule "${r.rule.text}" (${r.rule.source}): its ${r.ingredient} is ${r.allergen.replace(/_/g, " ")}. It is not planned.`);
    for (const a of p.added ?? []) p.notes.push(`${a.dish} had no ${a.what} in the draft: ${a.name} added at a standard amount to check.`);
  }

  /** Up to three dishes of the same kind that can be made instead of a refused one: drafted, then every ingredient checked against the kitchen's rules in master data. */
  async function insteadOf(p: PlanRecord, k: MenuKitchen, drafter: PlanDeps["draft"], now: Date): Promise<void> {
    const r = p.refused![0];
    const dish = p.draft.dishes.find((x) => x.id === r.dishId);
    const school = /school|koulu|päiväko|daycare|pupil|oppila/i.test(`${k.info.name} ${k.info.kind}`);
    const text = `Three ${dish?.course ?? "main"} dishes for ${p.settings.covers ?? "the same number of"} ${school ? "pupils" : "covers"}, instead of ${r.name}, which needs ${r.ingredient} against the kitchen's rule "${r.rule.text}". The same slot on the menu${school ? ", child-friendly, a school lunch" : ""}, with no ${r.allergen.replace(/_/g, " ")}, each different from the others.`;
    try {
      const alt = await drafter(text, promptContext(k), now);
      p.model.calls.push(...alt.calls.map((c) => ({ ...c, step: `instead ${c.step}` })));
      const allowed = allowedFor(k);
      const forbidden = [...new Set([...k.diet.forbiddenAllergens.map((f) => f.allergen), r.allergen])];
      const out: InsteadDish[] = [];
      for (const d of alt.draft.dishes) {
        if (out.length >= 3 || definingConflict(d, forbidden, k.info.rules) || d.ingredients.some((i) => allergenInName([i.name, ...i.searchTerms].join(" "), forbidden))) continue;
        const sets = await Promise.all(d.ingredients.filter((i) => !i.pantry).map((i) => findCandidates(catalog, i, k.diet, allowed, 4)));
        const ok = sets.every((set) => set.candidates.some((c) => c.safety.verdict === "ok" && !nutritionFindings(k.mandate.nutritionRules ?? [], { productId: c.product.id, category: c.product.category, nutrition: c.product.nutrition ?? null }).length));
        if (ok) out.push({ name: d.name, nameFi: d.nameFi, nameSv: d.nameSv ?? null, course: d.course, portion: d.portion, ingredients: d.ingredients.map((i) => i.name), checked: "every ingredient has a product in the range that passes the kitchen's allergen, diet and nutrition rules (master data); prices and delivery are checked when it is chosen" });
      }
      p.instead = out;
    } catch (err) {
      p.instead = [];
      p.notes.push(`Dishes to make instead could not be drafted: ${(err as Error).message}`);
    }
  }

  async function plan(k: MenuKitchen, text: string, by: string, opts: { onProgress?: (e: PlanProgress) => void } = {}): Promise<{ record: PlanRecord; view: PlanView }> {
    return planFrom(k, text, by, deps.draft, { door: "menu", pantry: k.info.pantry, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
  }

  /**
   * A list of plain items (a photo of a whiteboard, an emailed order) as one plan, one quote, one order: the same
   * candidates, safety rules, batched live lookups, options per line and gate as a menu, with no model at all. Every
   * amount is the one written on the list (no covers, no yield, nothing added), so quantities are never invented.
   */
  async function planItems(k: MenuKitchen, items: ListItem[], by: string, opts: { deliverBy?: string; door?: Door; source?: string } = {}): Promise<{ record: PlanRecord; view: PlanView; notPlanned: { item: string; reason: string }[] }> {
    const { draft, notPlanned } = listDraft(items, opts.deliverBy);
    const text = `${opts.source === "text" ? "Pasted list" : opts.source === "pdf" ? "List from a PDF" : "List from a photo"}: ${items.map((x) => `${x.amount} ${x.unit} ${x.item}`).join(", ")}`.slice(0, 2000);
    const r = await planFrom(k, text, by, async () => ({ draft, raw: draft as unknown as DraftResult["raw"], model: "none: read as written on the list", ms: 0, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] }), { door: opts.door ?? "photo", pantry: [] });
    return { ...r, notPlanned };
  }

  async function planFrom(k: MenuKitchen, text: string, by: string, drafter: PlanDeps["draft"], opts: { door: Door; pantry: string[]; onProgress?: (e: PlanProgress) => void }): Promise<{ record: PlanRecord; view: PlanView }> {
    const t0 = Date.now();
    const now = deps.now();
    const planId = newId("plan");
    const emit = (e: PlanProgress) => {
      try {
        opts.onProgress?.(e);
      } catch {
        // a watcher's failure never stops the plan
      }
    };
    let outlined = false;
    const dishesShown = new Set<string>();
    // Each dish's ingredients are searched (master data) and judged by name while the other dishes are still written.
    const allowed = allowedFor(k);
    const early = new Map<string, Promise<{ set: PlanInput["candidates"][string]; calls: CallStats[]; notes: string[] }>>();
    const prepare = (ings: DraftIngredient[]) => {
      const fresh = ings.filter((i) => !early.has(i.key));
      if (!fresh.length) return;
      const job = (async () => {
        const sets = await Promise.all(fresh.map((ing) => findCandidates(catalog, ing, k.diet, allowed, 8)));
        const tmp = { candidates: Object.fromEntries(fresh.map((ing, i) => [ing.key, sets[i]])), model: { calls: [] as CallStats[], costUsd: 0 as number | null }, notes: [] as string[] } as unknown as PlanRecord;
        const specs = fresh.filter((i) => !i.pantry).map((ing) => ({ lineId: ing.key, key: ing.key, name: ing.name, ingredient: ing, uses: [{ dishId: "", dish: "the dish", course: "", serviceDate: null, perCover: ing.perCover, yieldPct: ing.yieldPct, basis: ing.amountBasis, role: ing.role }], pantry: false }));
        await pick(tmp, specs);
        return { sets: tmp.candidates, calls: tmp.model.calls, notes: tmp.notes };
      })();
      for (const [i, ing] of fresh.entries()) early.set(ing.key, job.then((r) => ({ set: r.sets[ing.key], calls: i === 0 ? r.calls : [], notes: i === 0 ? r.notes : [] })));
    };
    const d = await drafter(
      text,
      promptContext(k),
      now,
      (ings, dish) => {
        if (dish) {
          dishesShown.add(dish.dishId);
          emit({ kind: "dish", planId, dishId: dish.dishId, name: dish.name, ingredients: ings });
        }
        prepare(ings);
      },
      (outline) => {
        outlined = true;
        emit({ kind: "outline", planId, outline });
      },
      opts.onProgress
        ? (ings, dish) => {
            if (!dishesShown.has(dish.dishId)) emit({ kind: "dish_partial", planId, dishId: dish.dishId, name: dish.name, ingredients: ings });
          }
        : undefined,
    );
    // A drafter that hands on nothing early (recorded outputs, a list): the same steps, from the full draft.
    if (d.draft.isFoodOrderRequest) {
      if (!outlined) emit({ kind: "outline", planId, outline: { covers: d.draft.covers, serviceDate: d.draft.serviceDate, occasion: d.draft.occasion, dishes: d.draft.dishes.map((x) => ({ dishId: x.id, name: x.name, course: x.course, portion: x.portion, serviceDate: x.serviceDate })), alternatives: [], ms: d.ms } });
      for (const x of d.draft.dishes) if (!dishesShown.has(x.id)) emit({ kind: "dish", planId, dishId: x.id, name: x.name, ingredients: x.ingredients });
    }
    const at = now.toISOString();
    const p: PlanRecord = {
      planId,
      kitchen: k.info.slug,
      text,
      by,
      createdAt: at,
      updatedAt: at,
      state: "planned",
      model: { id: d.model, ms: d.ms, costUsd: d.costUsd, calls: [...d.calls], recorded: !!d.recorded },
      draft: d.draft,
      raw: { draft: d.raw, fixes: {} },
      specs: [],
      candidates: {},
      live: { statuses: {}, deliverBy: null, calls: 0, at },
      edits: {},
      acceptances: [],
      fixes: {},
      settings: { covers: d.draft.covers, deliverBy: null },
      timings: { draftMs: d.ms, matchMs: 0, liveMs: 0, fixMs: 0, totalMs: 0 },
      liveUse: { calls: 0, products: 0 },
      notes: [],
    };
    if (!d.draft.isFoodOrderRequest) {
      p.state = "declined";
      p.declineReason = d.draft.declineReason ?? "This is not a request to plan or buy food.";
      p.timings.totalMs = Date.now() - t0;
      await store.save(p);
      return finishView(p, k);
    }
    // The delivery date: the earliest day a dish is served; never a day already past.
    const today = localNow(now).date;
    checkDishes(p, k, opts.pantry);
    const days = [d.draft.serviceDate, ...d.draft.dishes.map((x) => x.serviceDate)].filter((x): x is string => !!x).sort();
    let deliverBy: string | null = days[0] ?? null;
    if (deliverBy && deliverBy < today) {
      p.notes.push(`The service day ${formatDay(deliverBy)} is already past, so the plan is for the earliest delivery instead. Change the date if that is wrong.`);
      deliverBy = null;
    }
    // Never a day the gate will refuse: the mandate's lead time is checked here, before the day is offered.
    const latest = latestDeliveryDay(now, k.mandate.delivery.maxLeadDays);
    if (deliverBy && deliverBy > latest) {
      p.notes.push(`The kitchen's rules let the agent order at most ${k.mandate.delivery.maxLeadDays} days ahead, so the plan is delivered by ${formatDay(latest)}, before the service day ${formatDay(deliverBy)}.`);
      deliverBy = latest;
    } else if (!deliverBy && k.deliveryWeekdays?.length) {
      // No day given: the kitchen's next delivery day within its lead time, so the day said is the day ordered.
      for (let i = 1; i <= k.mandate.delivery.maxLeadDays && !deliverBy; i++) {
        const d = addDaysIso(today, i);
        if (k.deliveryWeekdays.includes(isoWeekday(d))) deliverBy = d;
      }
      p.notes.push(deliverBy ? `No service day given: planned for ${formatDay(deliverBy)}, the kitchen's next delivery day.` : "No service day given, and no delivery day of the kitchen within its lead time: planned for the earliest delivery.");
    } else if (!deliverBy) p.notes.push("No service day given: planned for the earliest delivery.");
    else p.notes.push(`Delivered by ${formatDay(deliverBy)}, the ${days.length > 1 ? "first service day" : "service day"}, at the latest.`);
    p.settings.deliverBy = deliverBy;
    p.live.deliverBy = deliverBy;
    if (p.settings.covers === null) p.notes.push("The request does not say how many covers: give the number and every amount follows.");

    const s = await session(k, opts.door);
    const req = await dock.openRequest(s, { text: (opts.door === "menu" ? `Menu plan: ${text}` : text).slice(0, 2000), ...(deliverBy ? { neededBy: deliverBy } : {}) });
    p.requestId = req.requestId;
    p.requestNeededBy = deliverBy;
    log(p, k, `agent:${k.agentId}`, `The model (${d.model}${d.recorded ? ", recorded output" : ""}) drafted ${d.draft.dishes.length} dish${d.draft.dishes.length === 1 ? "" : "es"} for ${d.draft.covers ?? "an unstated number of"} covers: ${d.draft.dishes.map((x) => x.name).join(", ")}. Plain code checks everything after this.`, {
      model: d.model,
      ms: d.ms,
      costUsd: d.costUsd,
      assumptions: d.draft.assumptions,
      corrections: d.draft.corrections,
      conflicts: d.draft.conflicts,
    });

    // Master data: candidates for every line, in parallel. No live call.
    const m0 = Date.now();
    // A refused dish is not planned at all: none of its lines is bought under its name.
    const refusedIds = new Set((p.refused ?? []).map((r) => r.dishId));
    p.specs = buildSpecs({ ...p.draft, dishes: p.draft.dishes.filter((x) => !refusedIds.has(x.id)) }, opts.pantry);
    const late: LineSpec[] = [];
    for (const spec of p.specs) {
      const e = early.get(spec.key);
      if (e && spec.lineId === spec.key) {
        const r = await e;
        p.candidates[spec.lineId] = r.set;
        p.model.calls.push(...r.calls);
        p.notes.push(...r.notes);
      } else {
        p.candidates[spec.lineId] = await findCandidates(catalog, spec.ingredient, k.diet, allowed, 8);
        if (!spec.pantry) late.push(spec);
      }
    }
    await pick(p, late);
    p.timings.matchMs = Date.now() - m0;
    if (p.refused?.length) await insteadOf(p, k, drafter, now);
    if (opts.onProgress) emit({ kind: "matched", planId, record: structuredClone(p), view: computePlan(input(p, k, 0)), ms: Date.now() - t0 });

    // Live: a short list, batched. Two products a line when the plan is small, else one, so a plan, its second
    // chances and its proposals fit in the agent's hourly allowance.
    const left = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId));
    const active = p.specs.filter((x) => !x.pantry).length;
    const perLine = active * LIVE_PER_LINE <= LIVE_MAX_PER_PLAN && left.newProductsLeft >= LIVE_PER_LINE * active ? LIVE_PER_LINE : 1; // a week menu: one each, up to the cap
    await price(p, s, liveShortlist(p.specs, p.candidates, p.edits, { perLine, max: Math.min(LIVE_MAX_PER_PLAN, left.newProductsLeft), covers: p.settings.covers }));

    // A line whose first products cannot come: price its next products before changing the recipe.
    const firstView = computePlan(input(p, k, 0));
    const stuckLines = firstView.lines.filter((l) => l.doubts.some((d) => d.kind === "cannot_arrive" && !d.accepted)).map((l) => l.lineId);
    if (stuckLines.length) {
      const more = stuckLines.flatMap((id) => (p.candidates[id]?.candidates ?? []).filter((c) => !p.live.statuses[c.product.id]).slice(0, 2).map((c) => c.product.id));
      const room = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId)).newProductsLeft;
      await price(p, s, more.slice(0, Math.min(10, room)));
    }
    // A line whose only products cannot show a kitchen rule is met (no allergen data under "always lactose-free"): a
    // wider search for one that can, priced, before the line is called not covered.
    const held = computePlan(input(p, k, 0)).lines.filter((l) => l.doubts.some((d) => d.kind === "allergen_unknown" && !d.accepted)).map((l) => l.lineId);
    if (held.length) {
      const diet = withRequestRules(k.diet, p.draft);
      const found = await Promise.all(held.map(async (id) => ({ id, set: await findCandidates(catalog, { ...p.specs.find((x) => x.lineId === id)!.ingredient, avoid: [] }, diet, allowed, 16) })));
      const ids: string[] = [];
      for (const { id, set } of found) {
        const ok = set.candidates.filter((c) => c.safety.verdict === "ok" && !(p.candidates[id]?.candidates ?? []).some((x) => x.product.id === c.product.id));
        if (!ok.length) continue;
        p.candidates[id] = { ...(p.candidates[id] ?? { rejected: [], searched: [] }), candidates: [...ok.slice(0, 4), ...(p.candidates[id]?.candidates ?? [])] };
        ids.push(...ok.slice(0, 2).map((c) => c.product.id));
      }
      const room = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId)).newProductsLeft;
      if (ids.length) await price(p, s, ids.slice(0, Math.min(10, room)));
    }
    p.timings.totalMs = Date.now() - t0;
    p.pending = true;
    await store.save(p);
    // Ways out, only where needed, and after the plan is on screen: the sheet shows "finding a way out" meanwhile.
    background.set(p.planId, settle(p.planId, k, s));
    return finishView(p, k);
  }

  const background = new Map<string, Promise<void>>();

  async function settle(planId: string, k: MenuKitchen, s: AgentSession): Promise<void> {
    const p = (await store.get(planId))!;
    try {
      await proposeFixesFor(p, k, s, computePlan(input(p, k, 0)));
    } catch (err) {
      p.notes.push(`Proposals for the lines that cannot be bought as planned failed: ${(err as Error).message}`);
    }
    // Edits made meanwhile win: only the proposals and what they priced are written back.
    const latest = (await store.get(planId)) ?? p;
    latest.fixes = { ...p.fixes, ...latest.fixes };
    for (const [key, set] of Object.entries(p.candidates)) if (key.startsWith("fix:")) latest.candidates[key] = set;
    latest.live.statuses = { ...p.live.statuses, ...latest.live.statuses };
    latest.liveUse = { calls: Math.max(latest.liveUse.calls, p.liveUse.calls), products: Math.max(latest.liveUse.products, p.liveUse.products), ...(p.liveUse.refused ? { refused: p.liveUse.refused } : {}) };
    latest.live.calls = latest.liveUse.calls;
    latest.model = p.model;
    latest.raw = p.raw;
    latest.timings.fixMs = p.timings.fixMs;
    latest.timings.liveMs = Math.max(latest.timings.liveMs, p.timings.liveMs);
    latest.notes = [...new Set([...latest.notes, ...p.notes])];
    latest.pending = false;
    await store.save(latest);
    background.delete(planId);
  }

  /** For tests and scripts: wait until the plan's proposals are in. */
  async function settled(planId: string): Promise<void> {
    await background.get(planId);
  }

  async function load(k: MenuKitchen, planId: string): Promise<PlanRecord> {
    const p = await store.get(planId);
    if (!p || p.kitchen !== k.info.slug) throw new DockError(404, "plan_not_found", `No plan ${planId} for ${k.info.name}.`);
    return p;
  }

  async function get(k: MenuKitchen, planId: string) {
    const p = await load(k, planId);
    if (p.order && p.order.status === "pending_approval") {
      try {
        p.order = await dock.getOrder(await session(k), p.order.orderId);
        if (p.order.status !== "pending_approval") p.state = "ordered";
        await store.save(p);
      } catch {
        // keep the last known state
      }
    }
    return finishView(p, k);
  }

  async function edit(k: MenuKitchen, planId: string, edits: PlanEdit[], by: string) {
    const p = await load(k, planId);
    if (p.state !== "planned") throw new DockError(409, "plan_locked", p.state === "declined" ? "This request was declined; start a new plan." : "This plan has a fixed price already; start a new plan to change it.");
    const s = await session(k);
    const at = deps.now().toISOString();
    let reprice = false;
    for (const e of edits) {
      const line = "lineId" in e ? p.specs.find((x) => x.lineId === e.lineId) : undefined;
      if ("lineId" in e && !line) throw new DockError(404, "line_not_found", `No line ${e.lineId} on this plan.`);
      const ed = line ? (p.edits[line.lineId] ??= {}) : undefined;
      switch (e.op) {
        case "covers":
          if (!Number.isInteger(e.covers) || e.covers <= 0 || e.covers > 20_000) throw new DockError(400, "invalid_covers", "Covers must be a whole number from 1 to 20,000.");
          p.settings.covers = e.covers;
          break;
        case "deliverBy":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < localNow(deps.now()).date) throw new DockError(400, "invalid_date", "The delivery date must be today or later, as YYYY-MM-DD.");
          if (e.date > latestDeliveryDay(deps.now(), k.mandate.delivery.maxLeadDays)) throw new DockError(422, "delivery_too_far", `The kitchen's rules let the agent order at most ${k.mandate.delivery.maxLeadDays} days ahead: the latest delivery day is ${formatDay(latestDeliveryDay(deps.now(), k.mandate.delivery.maxLeadDays))}.`, "delivery_deadline");
          if (e.date !== p.settings.deliverBy) {
            p.settings.deliverBy = e.date;
            if (p.requestId) {
              await dock.changeNeededBy(s, p.requestId, { neededBy: e.date, by, reason: "the chef changed the plan's delivery date" });
              p.requestNeededBy = e.date;
            }
            // Cut-offs depend on the date: what was priced for the old one is asked again, in batches.
            const ids = Object.keys(p.live.statuses);
            p.live = { statuses: {}, deliverBy: e.date, calls: p.live.calls, at };
            await price(p, s, ids);
          }
          break;
        case "strike":
          ed!.struck = e.struck;
          if (!e.struck) {
            delete ed!.onHand; // "buy it after all": what was taken as on hand no longer counts
            reprice = true;
          }
          break;
        case "onHand":
          if (e.onHand) ed!.onHand = e.onHand;
          else delete ed!.onHand;
          log(p, k, e.by ?? `agent:${k.agentId}`, e.onHand ? `On hand for ${line!.name}: ${e.onHand.amount === null ? "enough" : formatAmt({ amount: e.onHand.amount, unit: e.onHand.unit })} (${e.onHand.text}); only the shortfall is bought.` : `Nothing taken as on hand for ${line!.name} any more.`, { lineId: line!.lineId, onHand: e.onHand, estimate: e.onHand?.estimate ?? false });
          reprice = true;
          break;
        case "perCover":
          if (!(e.amount > 0) || e.amount > 2000) throw new DockError(400, "invalid_amount", "The amount per cover must be above 0.");
          ed!.perCover = { ...(ed!.perCover ?? {}), [e.dishId]: e.amount };
          if (e.unit && e.unit !== line!.ingredient.perCover.unit) {
            // Another measure (eggs in g instead of pieces): the line is searched again for products sold that way.
            line!.ingredient = { ...line!.ingredient, perCover: { amount: e.amount, unit: e.unit } };
            line!.uses = line!.uses.map((u) => ({ ...u, perCover: { amount: u.dishId === e.dishId ? e.amount : u.perCover.amount, unit: e.unit! } }));
            ed!.perCover = { [e.dishId]: e.amount };
            p.candidates[line!.lineId] = await findCandidates(catalog, line!.ingredient, k.diet, allowedFor(k), 8);
            await pick(p, [line!]);
            reprice = true;
          }
          break;
        case "price":
          reprice = true;
          break;
        case "yield":
          if (!(e.yieldPct >= 20 && e.yieldPct <= 100)) throw new DockError(400, "invalid_yield", "The usable share must be 20 to 100 %.");
          ed!.yieldPct = e.yieldPct;
          break;
        case "choose":
          ed!.optionId = e.optionId;
          break;
        case "accept": {
          const view = computePlan(input(p, k, 0));
          const doubt = view.lines.flatMap((l) => l.doubts).find((d) => d.doubtId === e.doubtId);
          if (!doubt) throw new DockError(404, "doubt_not_found", `Nothing to decide with id ${e.doubtId}.`);
          if (!doubt.acceptLabel) throw new DockError(409, "doubt_not_acceptable", "This cannot be accepted as it is: take one of the proposals or strike the line.");
          p.acceptances = p.acceptances.filter((a) => a.doubtId !== e.doubtId);
          p.acceptances.push({ doubtId: e.doubtId, by, at, text: `${doubt.acceptLabel}: ${doubt.text}` });
          log(p, k, `buyer:${by}`, `${by} decided on the plan: "${doubt.acceptLabel}" for: ${doubt.text}`, { doubtId: e.doubtId, kind: doubt.kind, relayedBy: k.agentId });
          break;
        }
        case "rules": {
          // A constraint on the plan on the table ("make it lactose-free", "no nuts"): the request's own rules grow
          // (never shrink), every line is searched again under them, and a dish made of what they forbid is refused.
          const claims = new Set([...p.draft.requiredClaims, ...(e.requiredClaims ?? [])]);
          const allergens = new Set([...p.draft.forbiddenAllergens, ...(e.forbiddenAllergens ?? [])]);
          p.draft = { ...p.draft, requiredClaims: [...claims], forbiddenAllergens: [...allergens] };
          const diet = withRequestRules(k.diet, p.draft);
          for (const spec of p.specs) {
            if (p.edits[spec.lineId]?.struck ?? spec.pantry) continue;
            // Only what the rule touches: a line keeps its products that pass it (so the same one stays chosen); only a
            // line left with none is searched again.
            const set = p.candidates[spec.lineId];
            const kept = (set?.candidates ?? []).filter((c) => checkSafety(c.product, diet).verdict === "ok");
            if (set && kept.length) {
              if (kept.length < set.candidates.length) p.candidates[spec.lineId] = { ...set, candidates: kept };
              continue;
            }
            p.candidates[spec.lineId] = await findCandidates(catalog, spec.ingredient, diet, allowedFor(k), 8);
            delete p.edits[spec.lineId]?.optionId;
          }
          for (const dish of p.draft.dishes) {
            if (p.refused?.some((r) => r.dishId === dish.id)) continue;
            const c = definingConflict(dish, [...diet.forbiddenAllergens.map((f) => f.allergen)], k.info.rules);
            if (c) {
              (p.refused ??= []).push({ dishId: dish.id, name: dish.name, ingredient: c.ingredient, allergen: c.allergen, rule: c.rule });
              for (const spec of p.specs) if (spec.uses.every((u) => u.dishId === dish.id)) (p.edits[spec.lineId] ??= {}).struck = true;
            }
          }
          log(p, k, `buyer:${by}`, `${by} added to the plan's rules: ${[...(e.requiredClaims ?? []).map((c) => c.replace(/_/g, "-")), ...(e.forbiddenAllergens ?? []).map((a) => `no ${a}`)].join(", ")}; every line searched again under them.`, { requiredClaims: e.requiredClaims ?? [], forbiddenAllergens: e.forbiddenAllergens ?? [] });
          reprice = true;
          break;
        }
        case "replaceDish": {
          // A dish the buyer names in place of one on the plan ("braised pork shoulder instead", or one of the dishes
          // offered instead of a refused one): drafted as exactly that dish, in the same slot; its lines join this plan,
          // so a main and its side stay one plan and one order.
          const old = p.draft.dishes.find((x) => x.id === e.dishId);
          if (!old) throw new DockError(404, "dish_not_found", `No dish ${e.dishId} on this plan.`);
          const text = `${e.name} for ${p.settings.covers ?? "the same number of"} covers${p.settings.deliverBy ? ` on ${p.settings.deliverBy}` : ""}: exactly this one dish, as the ${old.course} in place of ${old.name}.`;
          const d = await deps.draft(text, promptContext(k), deps.now());
          p.model.calls.push(...d.calls.map((c) => ({ ...c, step: `replace ${c.step}` })));
          const drafted = d.draft.dishes[0];
          if (!drafted) throw new DockError(422, "dish_not_planned", `${e.name} could not be planned as a dish.`);
          const dish = { ...drafted, id: old.id, course: old.course };
          for (const m of missingEssentials(dish)) dish.ingredients.push({ ...m.add, yieldPct: 100, amountBasis: `added by plain code: a ${m.kind} cannot be made without ${m.what}; a standard share per cover, check it`, pantry: k.info.pantry.some((w) => w.toLowerCase() === m.add.name.toLowerCase()), avoid: [] });
          p.draft = { ...p.draft, dishes: p.draft.dishes.map((x) => (x.id === old.id ? dish : x)) };
          p.refused = (p.refused ?? []).filter((r) => r.dishId !== old.id);
          const forbidden = [...new Set([...k.diet.forbiddenAllergens.map((f) => f.allergen), ...p.draft.forbiddenAllergens])];
          const conflict = definingConflict(dish, forbidden, k.info.rules);
          // The old dish's uses leave the plan; lines only it used go.
          for (const spec of p.specs) spec.uses = spec.uses.filter((u) => u.dishId !== old.id);
          for (const spec of p.specs.filter((x) => !x.uses.length)) {
            delete p.candidates[spec.lineId];
            delete p.edits[spec.lineId];
          }
          p.specs = p.specs.filter((x) => x.uses.length);
          if (conflict) (p.refused ??= []).push({ dishId: dish.id, name: dish.name, ingredient: conflict.ingredient, allergen: conflict.allergen, rule: conflict.rule });
          else {
            const diet = withRequestRules(k.diet, p.draft);
            for (const ns of buildSpecs({ ...p.draft, dishes: [dish] }, k.info.pantry)) {
              const same = p.specs.find((x) => x.key === ns.key && x.ingredient.perCover.unit === ns.ingredient.perCover.unit);
              if (same) {
                same.uses.push(...ns.uses);
                continue;
              }
              let id = ns.lineId;
              while (p.specs.some((x) => x.lineId === id)) id = `${id}_2`;
              p.specs.push({ ...ns, lineId: id });
              p.candidates[id] = await findCandidates(catalog, ns.ingredient, diet, allowedFor(k), 8);
            }
          }
          log(p, k, `buyer:${by}`, `${by} put ${dish.name} in place of ${old.name} on the plan${conflict ? `; it cannot be made either: "${conflict.rule.text}"` : ""}.`, { dishId: old.id, from: old.name, to: dish.name });
          reprice = true;
          break;
        }
        case "ingredient": {
          // One ingredient swapped in words ("use lingonberry jam instead of fresh lingonberries"): the same amount and
          // role, the new ingredient searched under the kitchen's and the plan's rules.
          const spec = line!;
          const name = e.name.trim().slice(0, 80);
          spec.replaces = { name: spec.name, fixTitle: `${name} instead, as the buyer asked`, changesDish: false };
          spec.name = name;
          spec.ingredient = { ...spec.ingredient, name, searchTerms: [name, ...(e.searchTerms ?? [])].slice(0, 4), avoid: [] };
          p.candidates[spec.lineId] = await findCandidates(catalog, spec.ingredient, withRequestRules(k.diet, p.draft), allowedFor(k), 8);
          delete p.edits[spec.lineId];
          log(p, k, `buyer:${by}`, `${by} swapped ${spec.replaces.name} for ${name} on the plan.`, { lineId: spec.lineId, from: spec.replaces.name, to: name });
          reprice = true;
          break;
        }
        case "repack": {
          // Only a large, dear pack was found for a small need: a wider search for the same ingredient, and the packs
          // nearest the need priced too, so the price ranking can take the smaller one (6 l of stock: not a 333 l tub).
          const spec = line!;
          const covers = p.settings.covers ?? 0;
          const wide = await findCandidates(catalog, { ...spec.ingredient, avoid: [] }, withRequestRules(k.diet, p.draft), allowedFor(k), 16);
          const have = new Map((p.candidates[spec.lineId]?.candidates ?? []).map((c) => [c.product.id, c]));
          for (const c of wide.candidates) if (!have.has(c.product.id) && !c.why.some((w) => /stand-in/.test(w))) have.set(c.product.id, c);
          const unit = spec.ingredient.perCover.unit === "g" ? "kg" : spec.ingredient.perCover.unit === "ml" ? "L" : "pcs";
          const need = covers ? toBase(spec.ingredient.perCover.amount * covers, spec.ingredient.perCover.unit).amount : 0;
          const sized = [...have.values()].map((c) => ({ c, size: packAmount(c.product, unit) ?? Infinity })).filter((x) => x.size !== Infinity);
          // The packs nearest the need from above first, then the largest below it (two of those can still be cheaper).
          sized.sort((a, b) => (a.size >= need ? 0 : 1) - (b.size >= need ? 0 : 1) || (a.size >= need ? a.size - b.size : b.size - a.size));
          p.candidates[spec.lineId] = { ...(p.candidates[spec.lineId] ?? { rejected: [], searched: [] }), candidates: [...have.values()] };
          const room = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId)).newProductsLeft;
          await price(p, s, sized.slice(0, Math.min(4, room)).map((x) => x.c.product.id));
          delete p.edits[spec.lineId]?.optionId;
          break;
        }
        case "acceptPartial": {
          // Only on the buyer's own words: order what can be bought, the rest named as not covered.
          const view = computePlan(input(p, k, 0));
          p.acceptPartial = { by, at, covered: view.totals.covered, of: view.totals.ingredients };
          log(p, k, `buyer:${by}`, `${by} chose to order only what can be bought: ${view.totals.covered} of ${view.totals.ingredients} ingredients; not covered: ${view.totals.missing.map((m) => `${m.ingredient} (${m.code})`).join(", ")}.`, { covered: view.totals.covered, of: view.totals.ingredients, missing: view.totals.missing.map((m) => ({ ingredient: m.ingredient, code: m.code })) });
          break;
        }
        case "dropDish": {
          const dish = p.draft.dishes.find((x) => x.id === e.dishId);
          if (!dish) throw new DockError(404, "dish_not_found", `No dish ${e.dishId} on this plan.`);
          for (const spec of p.specs) if (spec.uses.every((u) => u.dishId === dish.id)) (p.edits[spec.lineId] ??= {}).struck = true;
          log(p, k, `buyer:${by}`, `${by} dropped ${dish.name} from the plan.`, { dishId: dish.id });
          break;
        }
        case "applyFix": {
          const fix = (p.fixes[line!.lineId] ?? []).find((f) => f.fixId === e.fixId);
          if (!fix) throw new DockError(404, "fix_not_found", `No proposal ${e.fixId} for this line.`);
          if (!fix.check?.ok) throw new DockError(409, "fix_not_offered", `This proposal did not pass the checks: ${fix.check && !fix.check.ok ? fix.check.reason : "not checked"}.`);
          const spec = line!;
          if (fix.kind === "change_amount") {
            ed!.perCover = Object.fromEntries(spec.uses.map((u) => [u.dishId, fix.perCover!]));
          } else if (fix.kind === "change_dish" && !fix.ingredient) {
            ed!.struck = true;
          } else {
            const ing = fix.ingredient!;
            spec.replaces = { name: spec.name, fixTitle: fix.title, changesDish: fix.changesDish };
            spec.name = ing.name;
            spec.ingredient = ing;
            spec.uses = spec.uses.map((u) => ({ ...u, perCover: { ...ing.perCover }, yieldPct: ing.yieldPct, basis: ing.amountBasis, role: ing.role }));
            p.candidates[spec.lineId] = p.candidates[`fix:${fix.fixId}`] ?? (await findCandidates(catalog, ing, k.diet, allowedFor(k)));
            delete p.edits[spec.lineId];
            reprice = true;
          }
          p.acceptances = p.acceptances.filter((a) => !a.doubtId.startsWith(`${spec.lineId}:`));
          log(p, k, `buyer:${by}`, `${by} took a proposal for ${spec.replaces?.name ?? spec.name}: ${fix.title}. ${fix.effect}${fix.check.ok ? ` ${fix.check.product}, ${formatEur(fix.check.totalCents)}${fix.check.deltaCents !== null ? ` (${fix.check.deltaCents >= 0 ? "+" : ""}${formatEur(fix.check.deltaCents)})` : ""}.` : ""}`, {
            fixId: fix.fixId,
            kind: fix.kind,
            changesDish: fix.changesDish,
            relayedBy: k.agentId,
          });
          break;
        }
      }
    }
    if (reprice) {
      const room = dock.liveAllowance.remaining(agentKeyOf(s.mandate.issuer.orgId, s.agentId)).newProductsLeft;
      await price(p, s, liveShortlist(p.specs, p.candidates, p.edits, { perLine: 1, max: Math.min(10, room), already: Object.keys(p.live.statuses), covers: p.settings.covers }));
    }
    p.updatedAt = at;
    await store.save(p);
    return finishView(p, k);
  }

  async function quote(k: MenuKitchen, planId: string, by: string) {
    const p = await load(k, planId);
    if (p.state !== "planned") throw new DockError(409, "plan_locked", "This plan already has a fixed price.");
    const s = await session(k);
    const spent = await spentThisWeek(k.mandate.issuer.orgId);
    const view = computePlan(input(p, k, spent));
    if (!view.totals.canQuote) throw new DockError(409, "plan_not_ready", view.totals.blockers.join(" "), "human_input", { blockers: view.totals.blockers });
    // The request's need-by date must be the plan's: move it if the chef changed it (same request, one ledger line).
    if (p.requestNeededBy !== p.settings.deliverBy) {
      await dock.changeNeededBy(s, p.requestId!, { neededBy: p.settings.deliverBy, by, reason: "the chef changed the plan's delivery date" });
      p.requestNeededBy = p.settings.deliverBy;
    }
    const buying = view.lines.filter((l) => l.chosen && (l.status === "ready" || l.status === "needs_decision"));
    buying.forEach((l, i) => {
      const c = l.chosen!;
      log(
        p,
        k,
        `agent:${k.agentId}`,
        `Plan line ${i + 1} of ${buying.length}, ${l.name} for ${[...new Set(l.uses.map((u) => u.dish))].join(" and ")}: ${l.working}; ${c.products.map((x) => `${x.packText}, ${x.name}, at ${formatEur(x.unitPriceCents)}`).join(" + ")} = ${formatEur(c.totalCents)}, arrives ${formatDay(c.deliveryDate)}. ${c.rank === "best" ? "Best" : c.rank} of ${l.alternatives.length + 1} priced option${l.alternatives.length ? "s" : ""}${c.match === "full" ? "" : `, a compromise: ${c.cons[0] ?? ""}`}.`,
        { lineId: l.lineId, working: l.working, uses: l.uses.map((u) => ({ dish: u.dish, perCover: u.perCover, yieldPct: u.yieldPct, basis: u.basis })), products: c.products, safety: c.safety, accepted: l.doubts.filter((d) => d.accepted).map((d) => d.accepted) },
      );
    });
    const struck = view.lines.filter((l) => l.status === "struck");
    if (struck.length) log(p, k, `agent:${k.agentId}`, `Not ordered: ${struck.map((l) => `${l.name} (${l.struckReason})`).join("; ")}.`, { struck: struck.map((l) => l.lineId) });
    const merged = new Map<string, { productId: string; quantity: number; substituteFor?: string }>();
    for (const l of buying) for (const q of l.chosen!.quoteLines) {
      const prev = merged.get(q.productId);
      if (prev) prev.quantity += q.quantity;
      else merged.set(q.productId, { ...q });
    }
    try {
      const r = await dock.requestQuote(s, { requestId: p.requestId!, lines: [...merged.values()] });
      p.quote = { quote: r.quote, quoteToken: r.quoteToken, policyPreview: r.policyPreview, claims: r.claims?.length ?? 0 };
      p.state = "quoted";
      p.error = undefined;
    } catch (err) {
      if (!(err instanceof DockError)) throw err;
      // The day was checked for every line when it was offered; if the wholesaler's answer changed since, say which line.
      const pid = (err.details as { productId?: string } | undefined)?.productId;
      const line = pid ? buying.find((l) => l.chosen!.products.some((x) => x.productId === pid)) : undefined;
      p.error = { code: line ? "day_changed" : err.code, message: line ? `${line.name} (${line.chosen!.products.find((x) => x.productId === pid)!.name}) changed since the plan was offered: ${err.message}` : err.message, rule: err.rule };
    }
    p.updatedAt = deps.now().toISOString();
    void by;
    await store.save(p);
    return finishView(p, k);
  }

  async function order(k: MenuKitchen, planId: string) {
    const p = await load(k, planId);
    if (p.state !== "quoted" || !p.quote) throw new DockError(409, "plan_not_quoted", "Get a fixed price first.");
    const s = await session(k);
    try {
      p.order = await dock.placeOrder(s, { requestId: p.requestId!, quoteToken: p.quote.quoteToken, lines: p.quote.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) });
      p.state = "ordered";
      p.error = undefined;
    } catch (err) {
      if (!(err instanceof DockError)) throw err;
      p.error = { code: err.code, message: err.message, rule: err.rule };
    }
    p.updatedAt = deps.now().toISOString();
    await store.save(p);
    return finishView(p, k);
  }

  /**
   * The gate's own preview of the plan as one order (orders.ts previewDecision: the same rules as a quote, on an
   * unsigned quote never issued): every line being bought, merged by product, at the live offers the plan holds.
   * Undefined when nothing is bought or the lines cannot be priced from those offers.
   */
  async function preview(k: MenuKitchen, planId: string, opts: { swap?: { lineId: string; optionId: string }; view?: PlanView } = {}): Promise<Decision | undefined> {
    const p = await load(k, planId);
    if (!p.requestId || p.state !== "planned") return undefined;
    const view = opts.view ?? computePlan(input(p, k, 0));
    const merged = new Map<string, { productId: string; quantity: number; substituteFor?: string }>();
    for (const l of view.lines) {
      if (!l.chosen || (l.status !== "ready" && l.status !== "needs_decision")) continue;
      // "What if this line took that option instead": the same plan with one line's products swapped.
      const option = opts.swap?.lineId === l.lineId ? l.alternatives.find((a) => a.optionId === opts.swap!.optionId) : undefined;
      for (const q of (option ?? l.chosen).quoteLines) {
        const prev = merged.get(q.productId);
        if (prev) prev.quantity += q.quantity;
        else merged.set(q.productId, { ...q });
      }
    }
    if (!merged.size) return undefined;
    const offers = Object.values(p.live.statuses).map(usableOffer).filter((o): o is LiveOffer => !!o);
    return dock.previewDecision(await session(k), p.requestId, [...merged.values()], offers).catch(() => undefined);
  }

  /** The kitchen's menu agent as Dock sees it (its own mandate): for an order sheet made from a plan (server/thread/menu.ts). */
  const agentSession = (k: MenuKitchen) => session(k);

  /**
   * Dish ideas, checked before they are offered: the model drafts the dishes with their ingredients (one call), then
   * plain code checks every ingredient against master data and the kitchen's rules (its product groups, allergens,
   * claims, nutrition; sold at all). No live price: that is for the dish that is picked.
   */
  async function ideaCheck(k: MenuKitchen, text: string): Promise<{ draft: MenuDraft; ms: number; costUsd: number | null; dishes: IdeaCheck[] }> {
    const t0 = Date.now();
    const d = await deps.draft(text, promptContext(k), deps.now());
    const forbidden = [...new Set([...k.diet.forbiddenAllergens.map((f) => f.allergen), ...d.draft.forbiddenAllergens])];
    const diet = withRequestRules(k.diet, d.draft);
    const allowed = allowedFor(k);
    const groups = kitchenGroups(k.mandate.allowedCategories, codeOfSlug);
    const dishes = await Promise.all(
      d.draft.dishes.map(async (dish): Promise<IdeaCheck> => {
        const conflict = definingConflict(dish, forbidden, k.info.rules);
        const items = await Promise.all(
          dish.ingredients.map(async (ing) => {
            if (ing.pantry) return { ingredient: ing.name, ingredientFi: ing.searchTerms[0] ?? null, status: "staple" as const, words: "a staple the kitchen keeps: assumed, not bought", defining: isDefining(ing, dish.name) };
            const set = await findCandidates(catalog, ing, diet, allowed, 4);
            const ok = set.candidates.some((c) => c.safety.verdict === "ok");
            const outside = set.rejected.map((r) => /category (\S+) is not in the mandate/.exec(r.reason)?.[1]).find((x): x is string => !!x);
            const unsafe = set.rejected.find((r) => /contains|may contain|lactose|claim|allergen data/.test(r.reason));
            const status = ok ? ("buyable" as const) : ("not_covered" as const);
            const code = ok ? undefined : outside ? ("outside_groups" as const) : unsafe ? ("rule" as const) : ("not_sold" as const);
            const words = ok ? (set.candidates[0].product.names?.en ?? set.candidates[0].product.name) : outside ? `${ing.name} is in ${groupName(outside, codeOfSlug)}, which your product groups do not cover` : unsafe ? `${ing.name}: ${unsafe.reason}` : `the assortment has no ${ing.name}`;
            return { ingredient: ing.name, ingredientFi: ing.searchTerms[0] ?? null, status, ...(code ? { code } : {}), words, defining: isDefining(ing, dish.name), ...(code === "outside_groups" && outside ? { group: groupName(outside, codeOfSlug) } : {}) };
          }),
        );
        const missing = items.filter((x) => x.status === "not_covered");
        return { dishId: dish.id, name: dish.name, nameFi: dish.nameFi, nameSv: dish.nameSv ?? null, course: dish.course, portion: dish.portion, buyable: !conflict && missing.length === 0, ...(conflict ? { refused: { ingredient: conflict.ingredient, rule: conflict.rule } } : {}), items, missing, definingMissing: missing.some((x) => x.defining), kitchenGroups: groups };
      }),
    );
    return { draft: d.draft, ms: Date.now() - t0, costUsd: d.costUsd, dishes };
  }

  /** A plan from a dish already drafted (an idea the buyer picked): no model call for the recipe, live prices now. */
  async function planFromDraft(k: MenuKitchen, text: string, by: string, draft: MenuDraft, opts: { onProgress?: (e: PlanProgress) => void } = {}) {
    return planFrom(k, text, by, async () => ({ draft, raw: draft as unknown as DraftResult["raw"], model: "none: the idea already drafted", ms: 0, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] }), { door: "menu", pantry: k.info.pantry, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
  }

  return { plan, planItems, get, edit, quote, order, settled, preview, agentSession, ideaCheck, planFromDraft };
}

/** One line of a list, as a person reviewed it (the photo door's reviewed lines). */
export type ListItem = { item: string; amount: number; unit: string };

const LIST_UNITS: Record<string, { unit: "g" | "ml" | "pcs"; factor: number }> = {
  l: { unit: "ml", factor: 1000 }, litre: { unit: "ml", factor: 1000 }, liter: { unit: "ml", factor: 1000 }, dl: { unit: "ml", factor: 100 }, cl: { unit: "ml", factor: 10 }, ml: { unit: "ml", factor: 1 },
  kg: { unit: "g", factor: 1000 }, g: { unit: "g", factor: 1 },
  pcs: { unit: "pcs", factor: 1 }, kpl: { unit: "pcs", factor: 1 }, st: { unit: "pcs", factor: 1 }, pieces: { unit: "pcs", factor: 1 },
};

/** The list as a plan draft, by plain code: one dish ("the list"), one cover, every amount as written. */
export function listDraft(items: ListItem[], deliverBy?: string): { draft: MenuDraft; notPlanned: { item: string; reason: string }[] } {
  const notPlanned: { item: string; reason: string }[] = [];
  const used = new Set<string>();
  const ingredients: DraftIngredient[] = [];
  for (const x of items) {
    const u = LIST_UNITS[x.unit.trim().toLowerCase()];
    if (!u || !(x.amount > 0)) {
      notPlanned.push({ item: x.item, reason: u ? "no amount" : `"${x.unit}" is a pack count, which depends on the product's pack: send it as its own request` });
      continue;
    }
    let key = x.item.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";
    while (used.has(key)) key = `${key}_2`;
    used.add(key);
    ingredients.push({ key, name: x.item, searchTerms: [x.item], role: "on the list", perCover: { amount: Math.round(x.amount * u.factor * 1000) / 1000, unit: u.unit }, yieldPct: 100, amountBasis: "as written on the list", pantry: false, form: "any", avoid: [] });
  }
  return {
    notPlanned,
    draft: {
      isFoodOrderRequest: ingredients.length > 0,
      declineReason: ingredients.length ? null : "No line of the list has an amount Dock can plan by.",
      covers: 1,
      serviceDate: deliverBy ?? null,
      occasion: null,
      requiredClaims: [],
      forbiddenAllergens: [],
      assumptions: ["Read as written on the list: one line per item, the amount given, nothing scaled, added or left out."],
      conflicts: [],
      corrections: [],
      dishes: [{ id: "list", name: "The list", nameFi: null, nameSv: null, course: "other", serviceDate: deliverBy ?? null, portion: "as written", method: "a list of items to buy", ingredients }],
    },
  };
}

export type PlanEdit =
  | { op: "covers"; covers: number }
  | { op: "deliverBy"; date: string }
  | { op: "strike"; lineId: string; struck: boolean }
  | { op: "perCover"; lineId: string; dishId: string; amount: number; unit?: "g" | "ml" | "pcs" }
  | { op: "price" }
  | { op: "yield"; lineId: string; yieldPct: number }
  | { op: "choose"; lineId: string; optionId: string }
  | { op: "accept"; doubtId: string }
  | { op: "applyFix"; lineId: string; fixId: string }
  /** What the kitchen has on hand of a line (core/on-hand.ts), or null to take it away; `by` names who said it, else the agent. */
  | { op: "onHand"; lineId: string; onHand: OnHand | null; by?: string }
  /** A constraint on the whole plan in words ("make it lactose-free", "no nuts"): added to the request's rules. */
  | { op: "rules"; requiredClaims?: string[]; forbiddenAllergens?: string[] }
  /** A dish the buyer named in place of one on the plan: drafted as that dish, its lines join this plan. */
  | { op: "replaceDish"; dishId: string; name: string }
  /** One ingredient replaced by another the buyer named, same amount and role. */
  | { op: "ingredient"; lineId: string; name: string; searchTerms?: string[] }
  /** A dish taken off the plan: every line only it uses is struck. */
  | { op: "dropDish"; dishId: string }
  /** A line where only a large, dear pack was found: a wider search, and the packs nearest the need priced. */
  | { op: "repack"; lineId: string }
  /** The buyer's own "order just those": an incomplete plan may be quoted, the rest named as not covered. */
  | { op: "acceptPartial" };

export type PlanService = ReturnType<typeof createPlanService>;
