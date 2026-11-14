import { DockError } from "@/core/errors";
import type { Mandate, MandateRegister, MandateReissue } from "@/core/mandate";
import { newId } from "@/core/util";
import { NutritionRuleSchema, sameRule, type NutritionRule } from "@/core/nutrition";
import { allergenOf, claimOf } from "@/core/vocabulary";
import type { RecordStore } from "./records";

/**
 * Reissued mandates: what makes "Add to signed mandate" on the kitchen's memory page true.
 *
 * When the kitchen's own signed-in person adds a remembered safety rule to the mandate, the kitchen's mandate is
 * signed again with the rule in it (with the kitchen's key: the configured key of a built-in demo kitchen, a fresh
 * key for a visitor's kitchen, whose earlier private key was discarded by design), and every mandate the kitchen
 * signed before stops working at the gate (core/mandate.ts supersededBy, checked in core/orders.ts). This book is
 * the register the core reads, and it keeps what was added, so that every mandate this server signs for the
 * kitchen from then on (the store's agent, the menu agent, the hosted buyer) carries it.
 *
 * A reissue only ever narrows: it adds forbidden allergens, required attributes and nutrition rules. Limits, budget, categories and
 * approvers are never touched here.
 *
 * Kept in a record store (server/records.ts): in memory by default, PostgreSQL with DOCK_STORE=postgres, read back
 * at start-up, so a reissue survives a restart.
 */
export type MandatePatch = { forbiddenAllergens?: string[]; requiredAttributes?: string[]; /** Nutrition rules (core/nutrition.ts): a narrowing like an allergen rule. */ nutritionRules?: NutritionRule[] };
/** What a patch adds, in the mandate's vocabulary: the two lists always, nutrition rules when there are any. */
export type PatchAdded = { forbiddenAllergens: string[]; requiredAttributes: string[]; nutritionRules?: NutritionRule[] };

export type ReissueRecord = MandateReissue & {
  /** Everything the kitchen has added so far, in the mandate's own vocabulary. */
  added: PatchAdded;
  /** Each reissue, oldest first: who, when, what was added, and the mandate it produced. */
  history: { at: string; by: string; added: MandatePatch; mandateId: string; replaced: string }[];
};

/**
 * A remembered rule as the mandate can state it, or undefined when it cannot: the gate checks allergens and
 * attributes it has data for (core/vocabulary.ts), on every product. A word outside that vocabulary would make the
 * gate refuse everything (it cannot show a product is free of it), so it is never written into a mandate.
 */
export function expressible(patch: MandatePatch): PatchAdded | undefined {
  const allergens = (patch.forbiddenAllergens ?? []).map((a) => allergenOf(a));
  const claims = (patch.requiredAttributes ?? []).map((c) => claimOf(c));
  const rules = (patch.nutritionRules ?? []).map((x) => NutritionRuleSchema.safeParse(x));
  if (allergens.some((a) => !a) || claims.some((c) => !c) || rules.some((x) => !x.success) || allergens.length + claims.length + rules.length === 0) return undefined;
  const nutritionRules = rules.map((x) => x.data!);
  return { forbiddenAllergens: allergens as string[], requiredAttributes: claims as string[], ...(nutritionRules.length ? { nutritionRules } : {}) };
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const unionRules = (a: NutritionRule[] = [], b: NutritionRule[] = []) => [...a, ...b.filter((x) => !a.some((y) => sameRule(x, y)))];

export class MandateBook implements MandateRegister {
  private readonly byOrg = new Map<string, ReissueRecord>();
  private store?: RecordStore<ReissueRecord>;

  /** Read back the reissues a store holds (after a restart) and keep writing new ones to it. */
  async restore(store: RecordStore<ReissueRecord>): Promise<number> {
    this.store = store;
    for (const r of await store.list()) this.byOrg.set(r.orgId, r);
    return this.byOrg.size;
  }

  reissueOf(orgId: string): MandateReissue | undefined {
    const r = this.byOrg.get(orgId);
    return r && { orgId: r.orgId, at: r.at, mandateIds: r.mandateIds, by: r.by, replaced: r.history.map((h) => h.replaced), requires: structuredClone(r.added) };
  }

  recordOf(orgId: string): ReissueRecord | undefined {
    const r = this.byOrg.get(orgId);
    return r && structuredClone(r);
  }

  /**
   * A mandate this server is about to sign for a kitchen, with everything the kitchen added: never wider than the
   * kitchen's current mandate. `current: true` for the mandate of the kitchen's own store agent, which keeps the id
   * of the last reissue.
   */
  restrict(m: Mandate, opts: { current?: boolean } = {}): Mandate {
    const r = this.byOrg.get(m.issuer.orgId);
    if (!r) return m;
    return {
      ...m,
      ...(opts.current ? { mandateId: r.mandateIds.at(-1)! } : {}),
      forbiddenAllergens: union(m.forbiddenAllergens, r.added.forbiddenAllergens),
      requiredAttributes: union(m.requiredAttributes, r.added.requiredAttributes),
      ...(r.added.nutritionRules?.length ? { nutritionRules: unionRules(m.nutritionRules, r.added.nutritionRules) } : {}),
    };
  }

  /**
   * A kitchen re-signed its mandate on terms of its own (an account changing what its agent may do, from Agent and
   * rules): from this second on its earlier mandates are refused, as after any reissue. Nothing is added here; what
   * the kitchen added before stays in force through `restrict`. The caller has already signed `next`.
   */
  async supersede(next: Mandate, by: string, replaced: string, now = new Date()): Promise<ReissueRecord> {
    const prev = this.byOrg.get(next.issuer.orgId);
    const at = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
    const record: ReissueRecord = {
      orgId: next.issuer.orgId,
      at,
      by,
      mandateIds: [next.mandateId],
      added: prev?.added ?? { forbiddenAllergens: [], requiredAttributes: [] },
      history: [...(prev?.history ?? []), { at, by, added: {}, mandateId: next.mandateId, replaced }],
    };
    await this.store?.put(record.orgId, record);
    this.byOrg.set(record.orgId, record);
    return structuredClone(record);
  }

  /**
   * Record a reissue: from this second on, the gate refuses the organisation's earlier mandates. Returns the terms
   * to sign (the mandate given, with the rule and a new id) and the record. The caller signs and stores the token.
   */
  async reissue(current: Mandate, patch: MandatePatch, by: string, now = new Date(), sign?: (mandate: Mandate) => Promise<void>): Promise<{ mandate: Mandate; record: ReissueRecord; added: PatchAdded }> {
    const add = expressible(patch);
    if (!add) throw new DockError(422, "rule_not_expressible", "This rule cannot be stated in the mandate's vocabulary (allergens and product attributes the gate has data for), so the gate cannot enforce it. It stays a preference the intake uses.", "data_access");
    const freshRules = (add.nutritionRules ?? []).filter((x) => !(current.nutritionRules ?? []).some((y) => sameRule(x, y)));
    const fresh: PatchAdded = { forbiddenAllergens: add.forbiddenAllergens.filter((a) => !current.forbiddenAllergens.includes(a)), requiredAttributes: add.requiredAttributes.filter((c) => !current.requiredAttributes.includes(c)), ...(freshRules.length ? { nutritionRules: freshRules } : {}) };
    if (fresh.forbiddenAllergens.length + fresh.requiredAttributes.length + freshRules.length === 0) throw new DockError(409, "rule_already_in_mandate", "The kitchen's mandate already states this rule.");
    const prev = this.byOrg.get(current.issuer.orgId);
    // To the second, as a token's `iat` is: a mandate signed in or after this second is the kitchen's current word.
    const at = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
    const mandate: Mandate = {
      ...current,
      mandateId: newId("mnd"),
      forbiddenAllergens: union(current.forbiddenAllergens, fresh.forbiddenAllergens),
      requiredAttributes: union(current.requiredAttributes, fresh.requiredAttributes),
      ...(freshRules.length || current.nutritionRules?.length ? { nutritionRules: unionRules(current.nutritionRules, freshRules) } : {}),
    };
    const record: ReissueRecord = {
      orgId: current.issuer.orgId,
      at,
      by,
      mandateIds: [mandate.mandateId],
      added: {
        forbiddenAllergens: union(prev?.added.forbiddenAllergens ?? [], fresh.forbiddenAllergens),
        requiredAttributes: union(prev?.added.requiredAttributes ?? [], fresh.requiredAttributes),
        ...(prev?.added.nutritionRules?.length || freshRules.length ? { nutritionRules: unionRules(prev?.added.nutritionRules, freshRules) } : {}),
      },
      history: [...(prev?.history ?? []), { at, by, added: fresh, mandateId: mandate.mandateId, replaced: current.mandateId }],
    };
    // A kitchen whose new mandate has to be signed and stored first (a visitor's): nothing is recorded if that fails.
    await sign?.(mandate);
    await this.store?.put(record.orgId, record); // in the store before it is in force here: it must outlive a restart
    this.byOrg.set(record.orgId, record);
    return { mandate, record: structuredClone(record), added: fresh };
  }
}
