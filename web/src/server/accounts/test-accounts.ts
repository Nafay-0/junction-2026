import type { Product } from "@/core/catalog";
import type { NutritionRule } from "@/core/nutrition";
import { addDaysIso, emptyProfile, isoWeekday, localNow, type HistoryEntry, type KitchenProfile, type StatedPreference } from "@/core/kitchen";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { bigMilkBoxes } from "../demo-kitchen";
import { DEFAULT_TERMS, type MandateTerms } from "./terms";

/**
 * PUBLIC TEST ACCOUNTS. These credentials are meant to be handed out: to judges, testers and anyone at the table.
 * They are not secrets, they give access to made-up kitchens on synthetic data only, and the sign-in page shows
 * them (with one-click sign-in) when DOCK_TEST_ACCOUNTS_SHOWN=1. Because anyone can use them, anyone can change
 * them: they are reset to what is written here every DOCK_TEST_ACCOUNTS_RESET_MINUTES (default 60) and from the
 * operations portal ("Reset test accounts"). A reset starts a fresh organisation, so earlier orders no longer count
 * against the kitchen's weekly budget; they stay in the ledger, which is append-only.
 *
 * The two built-in demo kitchens (kaari, laakso) are NOT here: their passwords come from the environment
 * (DOCK_KAARI_PASSWORD, DOCK_LAAKSO_PASSWORD) and are not in the repository.
 */
export type TestAccountSeed = {
  username: string;
  password: string;
  restaurant: string;
  terms: MandateTerms;
  /** Made-up history and stated rules, so memory and standing orders have something to show. */
  profile: (orgId: string, name: string, now: Date, products: Product[]) => KitchenProfile;
};

/** Metsola school kitchen's nutrition rules, per 100 g or 100 ml (core/nutrition.ts). */
export const SCHOOL_NUTRITION: NutritionRule[] = [
  { nutrient: "protein", min: 3, categories: ["milk", "plant_drink"] },
  { nutrient: "sugar", max: 12, categories: ["yoghurt", "plant_yoghurt", "quark"] },
  { nutrient: "salt", max: 1.2, categories: ["cat_10600", "cat_10602", "cat_10603"] },
  { nutrient: "fibre", min: 6, categories: ["cat_10900", "cat_10901", "cat_11030"] },
];

export const TEST_ACCOUNTS: TestAccountSeed[] = [
  {
    username: "hotel-lumo",
    password: "lumo-breakfast-i4APPxo8",
    restaurant: "Hotel Lumo kitchen",
    terms: { ...DEFAULT_TERMS, perOrderLimitEur: 500, weeklyBudgetEur: 9_000, signer: "Kitchen manager", maxLeadDays: 7 },
    profile: (orgId, name, now, products) => {
      const boxes = bigMilkBoxes(products);
      const cream = pick(products, (p) => p.category === "cream" && p.attributes.includes("lactose_free"));
      const history = [
        ...series(boxes[0], pastDays(now, [1, 4], 10), [400, 380, 420, 400, 440, 400, 380, 400, 420, 400], `ord_t_lumo_m`),
        ...series(cream, pastDays(now, [4], 5), [20, 20, 25, 20, 20], `ord_t_lumo_c`),
      ];
      return {
        ...emptyProfile(orgId, name),
        deliveryWeekdays: [1, 2, 3, 4, 5, 6],
        history: sorted(history),
        stated: [stated(now, "lumo_lf", { kind: "dimension", dimension: "lactose", choice: "lactose_free" }, "Always lactose-free: many breakfast guests ask for it", "Kitchen manager", 18)],
      };
    },
  },
  {
    username: "koulu-metsola",
    password: "metsola-school-NlUJi4B8",
    restaurant: "Metsola school kitchen",
    // A school kitchen's nutrition rules beside its allergen rules (the partner's "allergen-safe substitution under
    // pressure" scenario): what pupils drink as milk keeps milk's protein, so an oat drink is no stand-in; yoghurt,
    // cheese and bread within the sugar, salt and fibre a school menu allows. Finnish origin preferred, not required.
    terms: {
      ...DEFAULT_TERMS,
      perOrderLimitEur: 250,
      weeklyBudgetEur: 2_500,
      forbid: ["nuts", "peanuts", "sesame", "fish"],
      signer: "Food service manager",
      maxLeadDays: 5,
      nutrition: SCHOOL_NUTRITION,
      labels: { require: [], prefer: ["origin_fi"] },
    },
    profile: (orgId, name, now, products) => {
      const milk = pick(products, (p) => p.category === "milk" && p.attributes.includes("fat_1_5") && p.packSize >= 5) ?? pick(products, (p) => p.category === "milk");
      const yoghurt = pick(products, (p) => p.category === "yoghurt");
      const history = [
        ...series(milk, pastDays(now, [1, 3, 5], 12), [60, 60, 55, 60, 65, 60, 60, 55, 60, 60, 65, 60], `ord_t_metsola_m`),
        ...series(yoghurt, pastDays(now, [2], 5), [30, 30, 35, 30, 30], `ord_t_metsola_y`),
      ];
      return {
        ...emptyProfile(orgId, name),
        deliveryWeekdays: [1, 2, 3, 4, 5],
        history: sorted(history),
        stated: [
          stated(now, "metsola_nuts", { kind: "forbid_allergen", allergen: "nuts" }, "Nut-free kitchen: no nuts, no traces", "Food service manager", 30),
          stated(now, "metsola_fat", { kind: "dimension", dimension: "fat", choice: "fat_1_5", family: "milk" }, "Semi-skimmed milk for the pupils", "Food service manager", 25),
        ],
      };
    },
  },
  {
    username: "kahvila-sointu",
    password: "sointu-coffee-sfXLot2O",
    restaurant: "Kahvila Sointu",
    terms: { ...DEFAULT_TERMS, perOrderLimitEur: 60, weeklyBudgetEur: 400, groups: ["10", "11", "22"], signer: "Owner", maxLeadDays: 5 },
    profile: (orgId, name, now, products) => {
      const oat = pick(products, (p) => p.category === "plant_drink");
      const milk = pick(products, (p) => p.category === "milk" && p.packSize <= 2 && !p.attributes.includes("lactose_free")) ?? pick(products, (p) => p.category === "milk");
      const history = [...series(oat, pastDays(now, [2, 5], 10), [12, 12, 10, 12, 14, 12, 12, 10, 12, 12], `ord_t_sointu_o`), ...series(milk, pastDays(now, [2, 5], 10), [10, 10, 8, 10, 10, 12, 10, 10, 8, 10], `ord_t_sointu_m`)];
      return {
        ...emptyProfile(orgId, name),
        deliveryWeekdays: [2, 5],
        history: sorted(history),
        stated: [stated(now, "sointu_price", { kind: "optimise", goal: "price" }, "Cheapest that does the job: the budget is small", "Owner", 12)],
      };
    },
  },
];

export const TEST_USERNAMES = new Set(TEST_ACCOUNTS.map((t) => t.username));

// ---------- made-up history ----------

const CENTS_PER_UNIT: Record<string, number> = { milk: 150, cream: 450, plant_drink: 210, yoghurt: 320 };

function pick(products: Product[], ok: (p: Product) => boolean): Product | undefined {
  return products.filter(ok).sort((a, b) => a.id.localeCompare(b.id))[0];
}

function price(p: Product): number {
  return SEED_STOCK[p.id]?.unitPriceCents ?? Math.round((CENTS_PER_UNIT[p.category] ?? 300) * p.packSize);
}

/** Delivery days on the given weekdays in the six weeks before today, the most recent `count`. */
function pastDays(now: Date, weekdays: number[], count: number): string[] {
  const today = localNow(now).date;
  const out: string[] = [];
  for (let d = addDaysIso(today, -42); d < today; d = addDaysIso(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out.slice(-count);
}

function series(p: Product | undefined, days: string[], amounts: number[], prefix: string): HistoryEntry[] {
  if (!p) return [];
  return days.map((d, i) => {
    const packs = Math.max(1, Math.round(amounts[i % amounts.length] / p.packSize));
    const unitPriceCents = price(p);
    return {
      orderId: `${prefix}${String(i + 1).padStart(2, "0")}`,
      placedAt: `${addDaysIso(d, -1)}T08:00:00.000Z`,
      neededBy: d,
      deliveryDate: d,
      family: p.category,
      amount: Math.round(packs * p.packSize * 100) / 100,
      unit: p.unit,
      totalCents: packs * unitPriceCents,
      lines: [{ productId: p.id, name: p.name, category: p.category, attributes: p.attributes, packs, packSize: p.packSize, unit: p.unit, unitPriceCents }],
    };
  });
}

const sorted = (h: HistoryEntry[]) => h.sort((a, b) => a.placedAt.localeCompare(b.placedAt));

type Body = { kind: "dimension"; dimension: string; choice: string; family?: string } | { kind: "forbid_allergen"; allergen: string } | { kind: "optimise"; goal: "price" | "co2" | "reliability" };

function stated(now: Date, id: string, body: Body, text: string, by: string, daysAgo: number): StatedPreference {
  return { id: `pref_t_${id}`, text, statedBy: by, statedAt: `${addDaysIso(localNow(now).date, -daysAgo)}T09:00:00.000Z`, ...body } as StatedPreference;
}

/** The catalogue products the test histories are drawn from: a few local master-data searches, never a live call. */
export async function testAccountProducts(catalog: { searchProducts(q: { category: string; limit: number }): Promise<Product[]> }): Promise<Product[]> {
  const found = await Promise.all(["milk", "cream", "plant_drink", "yoghurt"].map((category) => catalog.searchProducts({ category, limit: 100 }).catch(() => [] as Product[])));
  const all = found.flat();
  return all.length ? all : SEED_PRODUCTS;
}
