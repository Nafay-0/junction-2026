import { signMandate, type Mandate } from "@/core/mandate";
import { categorySlug } from "@/core/catalog/partner";
import { SEED_PRODUCTS } from "@/core/seed";
import { addDays } from "@/core/util";
import { KITCHEN_ORG, demoKitchenKeyPair } from "../../demo-kitchen";
import { DEMO_ORG, demoOrgKeyPair } from "../../dev-fixtures";
import type { Runtime } from "../../runtime";
import type { DietRules } from "./safety";

/**
 * The kitchens the menu planner speaks for, and the mandate each one's menu agent carries.
 *
 * Each organisation signs a second mandate, for its menu-planning agent, with its own key (the same key Dock already
 * trusts for it): the menu agent may buy food of any kind, where the buyer console's agent may buy only dairy. The
 * gate then checks every plan against this mandate exactly as it checks any agent's order. Nothing here widens what
 * the existing agents may do.
 *
 *   kaari   Ravintola Kaari, a lunch restaurant: lactose-free dairy (the head chef's stated rule), sign-off over €300
 *   laakso  Laakso Catering, school and daycare lunches: no nuts or peanuts by mandate (no "may contain", no
 *           unknown allergen data), lactose-free dairy, sign-off over €500
 */

export type MenuKitchenInfo = {
  slug: "kaari" | "laakso";
  name: string;
  kind: string;
  city: string;
  agentName: string;
  /** Who the screen relays for, recorded in the ledger with every acceptance. */
  by: string;
  /** The kitchen's rules in words, with where each comes from. */
  rules: { text: string; source: string }[];
  /** Staples the kitchen says it always has: lines for these start struck. */
  pantry: string[];
  mandate: { perOrderLimitCents: number; weeklyBudgetCents: number; forbiddenAllergens: string[]; maxLeadDays: number; substitution: Mandate["substitution"]; approvers: { name: string; role: string; maxApprovalCents: number }[]; categories: number };
  examples: string[];
};

export type MenuKitchen = { info: MenuKitchenInfo; mandateToken: string; agentId: string; mandate: Mandate; diet: DietRules };

/** Partner category families that are not food: kitchenware, cleaning, packaging, office, newspapers, gases. */
const NON_FOOD_FAMILIES = new Set(["200", "300", "329", "630", "631", "632", "633", "639", "640", "641", "643", "645", "677", "678", "777", "900"]);

/** Every food category of the catalogue in use, as Dock slugs. */
export function foodCategories(rt: Pick<Runtime, "catalog">): string[] {
  const c = rt.catalog as { index?: { products: { categoryCode: string }[] } };
  if (c.index) return [...new Set(c.index.products.map((p) => p.categoryCode).filter((code) => !NON_FOOD_FAMILIES.has(code.slice(0, 3))).map(categorySlug))].sort();
  return [...new Set(SEED_PRODUCTS.map((p) => p.category))].sort();
}

const PANTRY = ["salt", "black pepper", "white pepper", "sugar", "wheat flour", "rapeseed oil", "dried bay leaves", "dried spices"];

type Def = Omit<MenuKitchenInfo, "mandate"> & { orgId: string; orgName: string; agentId: string; mandate: (now: Date, categories: string[]) => Mandate; diet: DietRules };

const DEFS: Record<MenuKitchenInfo["slug"], Def> = {
  kaari: {
    slug: "kaari",
    name: "Ravintola Kaari",
    kind: "lunch restaurant, about 300 lunches a day",
    city: "Helsinki",
    orgId: KITCHEN_ORG.orgId,
    orgName: KITCHEN_ORG.name,
    agentId: "agent_kaari_menu_01",
    agentName: "Kaari's menu agent",
    by: "Sanna Koskinen (head chef)",
    rules: [{ text: "Dairy must be lactose-free", source: "stated by Sanna Koskinen (head chef)" }],
    pantry: PANTRY,
    examples: [
      "Salmon soup for 300 on Friday",
      "Next week's lunch around chanterelles: two dishes, 250 covers a day, Wednesday and Thursday",
      "Lohikeitto 300 annosta perjantaiksi",
      "Tomorrow: unexpected booking, 120 covers, three-course lunch, lactose-free and nut-free",
    ],
    mandate: (now, categories) => ({
      mandateId: `mnd_kaari_menu_${now.toISOString().slice(0, 10).replaceAll("-", "")}`,
      issuer: { orgId: KITCHEN_ORG.orgId, name: KITCHEN_ORG.name },
      agentId: "agent_kaari_menu_01",
      validFrom: new Date(now.getTime() - 60_000).toISOString(),
      validUntil: addDays(now, 7).toISOString(),
      currency: "EUR",
      perOrderLimitCents: 30_000,
      weeklyBudgetCents: 600_000,
      allowedCategories: categories,
      requiredAttributes: [],
      forbiddenAllergens: [],
      requiredCertificates: [],
      delivery: { maxLeadDays: 7 },
      substitution: { rule: "within_preferences", maxPriceIncreasePct: 15 },
      approvers: [
        { role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 250_000 },
        { role: "owner", name: "Jari Mäkelä", maxApprovalCents: 1_000_000 },
      ],
    }),
    diet: { forbiddenAllergens: [], requiredClaims: [{ claim: "lactose_free", source: "kitchen rule" }], mandateAllergens: [] },
  },
  laakso: {
    slug: "laakso",
    name: "Laakso Catering",
    kind: "school and daycare kitchen, lunches for pupils aged 7 to 15",
    city: "Espoo",
    orgId: DEMO_ORG.orgId,
    orgName: DEMO_ORG.name,
    agentId: "agent_laakso_menu_01",
    agentName: "Laakso's menu agent",
    by: "Aino Virtanen (kitchen manager)",
    rules: [
      { text: "No nuts or peanuts of any kind, including 'may contain' and products without allergen data", source: "mandate" },
      { text: "Dairy must be lactose-free", source: "kitchen rule" },
    ],
    pantry: PANTRY,
    examples: [
      "School lunch for 450 on Monday: salmon soup, rye bread, berry quark for dessert",
      "Koululounas 450 oppilaalle maanantaiksi: broileria ja riisiä",
      "Peanut satay chicken for 200 pupils on Tuesday",
    ],
    mandate: (now, categories) => ({
      mandateId: `mnd_laakso_menu_${now.toISOString().slice(0, 10).replaceAll("-", "")}`,
      issuer: { orgId: DEMO_ORG.orgId, name: DEMO_ORG.name },
      agentId: "agent_laakso_menu_01",
      validFrom: new Date(now.getTime() - 60_000).toISOString(),
      validUntil: addDays(now, 7).toISOString(),
      currency: "EUR",
      perOrderLimitCents: 50_000,
      weeklyBudgetCents: 800_000,
      allowedCategories: categories,
      requiredAttributes: [],
      forbiddenAllergens: ["nuts", "peanuts"],
      requiredCertificates: [],
      delivery: { maxLeadDays: 7 },
      substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 },
      approvers: [
        { role: "kitchen_manager", name: "Aino Virtanen", maxApprovalCents: 300_000 },
        { role: "finance_director", name: "Mikko Laine", maxApprovalCents: 1_000_000 },
      ],
    }),
    diet: {
      forbiddenAllergens: [
        { allergen: "nuts", source: "mandate" },
        { allergen: "peanuts", source: "mandate" },
      ],
      requiredClaims: [{ claim: "lactose_free", source: "kitchen rule" }],
      mandateAllergens: ["nuts", "peanuts"],
    },
  },
};

export const MENU_KITCHENS = Object.keys(DEFS) as MenuKitchenInfo["slug"][];

const TOKEN_TTL_MS = 60 * 60 * 1000;
const g = globalThis as typeof globalThis & { __dockMenuTokens?: Map<string, { token: string; mandate: Mandate; at: number }> };

export async function resolveMenuKitchen(slug: string, rt: Pick<Runtime, "catalog">, now = new Date()): Promise<MenuKitchen | undefined> {
  const def = DEFS[slug as MenuKitchenInfo["slug"]];
  if (!def) return undefined;
  g.__dockMenuTokens ??= new Map();
  let hit = g.__dockMenuTokens.get(slug);
  if (!hit || Date.now() - hit.at > TOKEN_TTL_MS) {
    const mandate = def.mandate(now, foodCategories(rt));
    const key = slug === "kaari" ? await demoKitchenKeyPair() : await demoOrgKeyPair();
    hit = { token: await signMandate(mandate, key), mandate, at: Date.now() };
    g.__dockMenuTokens.set(slug, hit);
  }
  const m = hit.mandate;
  const { orgId: _o, orgName: _n, agentId, mandate: _m, diet, ...info } = def;
  void _o;
  void _n;
  void _m;
  return {
    info: {
      ...info,
      mandate: {
        perOrderLimitCents: m.perOrderLimitCents,
        weeklyBudgetCents: m.weeklyBudgetCents,
        forbiddenAllergens: m.forbiddenAllergens,
        maxLeadDays: m.delivery.maxLeadDays,
        substitution: m.substitution,
        approvers: m.approvers.map((a) => ({ name: a.name, role: a.role, maxApprovalCents: a.maxApprovalCents })),
        categories: m.allowedCategories.length,
      },
    },
    mandateToken: hit.token,
    agentId,
    mandate: m,
    diet,
  };
}
