// Fixtures for the kitchen-intake tests. Not used at runtime. Independent of seed.ts on purpose.
import type { Product } from "./catalog";
import { emptyProfile, type HistoryEntry, type KitchenProfile, type StatedPreference } from "./kitchen";

/** Monday 16 Nov 2026, 10:00 in Helsinki: before the 12:00 cut-off for Tuesday. */
export const NOW = new Date("2026-11-16T08:00:00.000Z");

function milk(id: string, name: string, packSize: number, attributes: string[], deliveryReliability: number, carbonKgPerUnit: number, over: Partial<Product> = {}): Product {
  return { id, name, brand: id.split("-")[0], category: "milk", unit: "L", packSize, attributes, allergens: ["milk"], certificates: [], deliveryReliability, carbonKgPerUnit, ...over };
}

export const P = {
  box: milk("T-BOX", "Lactose-free milk 1.5 %, 10 L box", 10, ["lactose_free", "fat_1_5"], 0.98, 1.05),
  box2: milk("U-BOX", "Other lactose-free milk 1.5 %, 10 L box", 10, ["lactose_free", "fat_1_5"], 0.95, 1.12),
  litre: milk("T-1L", "Lactose-free milk 1.5 %, 1 L", 1, ["lactose_free", "fat_1_5"], 0.99, 1.15),
  skim: milk("T-SKIM", "Lactose-free fat-free milk, 1 L", 1, ["lactose_free", "fat_free"], 0.99, 1.02),
  whole: milk("T-WHOLE", "Lactose-free whole milk 3.5 %, 1 L", 1, ["lactose_free", "fat_3_5"], 0.97, 1.31),
  organic: milk("T-ORG", "Organic lactose-free milk 1.5 %, 1 L", 1, ["lactose_free", "fat_1_5", "organic"], 0.96, 1.09),
  bottle: milk("T-1_5L", "Lactose-free milk 1.5 %, 1.5 L", 1.5, ["lactose_free", "fat_1_5"], 0.88, 1.14),
  regular: milk("T-REG", "Milk 1.5 %, 10 L box", 10, ["fat_1_5"], 0.98, 1.03),
  oat: { ...milk("T-OAT", "Oat drink, 1 L", 1, ["lactose_free", "vegan"], 0.94, 0.35), category: "plant_drink", allergens: ["gluten"] },
} satisfies Record<string, Product>;

export const STOCK: Record<string, { unitPriceCents: number; availablePacks: number; leadDays: number }> = {
  "T-BOX": { unitPriceCents: 1290, availablePacks: 60, leadDays: 1 },
  "U-BOX": { unitPriceCents: 1370, availablePacks: 80, leadDays: 1 },
  "T-1L": { unitPriceCents: 149, availablePacks: 2000, leadDays: 1 },
  "T-SKIM": { unitPriceCents: 139, availablePacks: 400, leadDays: 1 },
  "T-WHOLE": { unitPriceCents: 159, availablePacks: 300, leadDays: 2 },
  "T-ORG": { unitPriceCents: 199, availablePacks: 150, leadDays: 2 },
  "T-1_5L": { unitPriceCents: 219, availablePacks: 300, leadDays: 2 },
  "T-REG": { unitPriceCents: 1150, availablePacks: 200, leadDays: 1 },
  "T-OAT": { unitPriceCents: 189, availablePacks: 600, leadDays: 2 },
};

/** A past order of `packs` packs of one product, `daysAgo` days before NOW. */
export function past(product: Product, packs: number, daysAgo: number, over: Partial<HistoryEntry> = {}): HistoryEntry {
  const placed = new Date(NOW.getTime() - daysAgo * 86_400_000);
  const delivery = new Date(placed.getTime() + 86_400_000).toISOString().slice(0, 10);
  return {
    orderId: `ord_past_${product.id}_${daysAgo}`,
    placedAt: placed.toISOString(),
    deliveryDate: delivery,
    neededBy: delivery,
    family: product.category,
    amount: packs * product.packSize,
    unit: product.unit,
    totalCents: packs * (STOCK[product.id]?.unitPriceCents ?? 100),
    lines: [{ productId: product.id, name: product.name, category: product.category, attributes: product.attributes, packs, packSize: product.packSize, unit: product.unit, unitPriceCents: STOCK[product.id]?.unitPriceCents ?? 100 }],
    ...over,
  };
}

/** The usual returning kitchen: ten orders over five weeks of about 100 L of lactose-free 1.5 % milk. */
export function regularHistory(): HistoryEntry[] {
  const packs = [10, 9, 11, 10, 10, 12, 10, 9, 10];
  return [...packs.map((n, i) => past(P.box, n, 38 - i * 4)), past(P.box2, 10, 4)];
}

export function kitchen(history: HistoryEntry[] = [], stated: StatedPreference[] = []): KitchenProfile {
  return { ...emptyProfile("org_laakso", "Laakso Catering Oy"), history, stated };
}

export function statedPref(over: Partial<StatedPreference> & Pick<StatedPreference, "kind">): StatedPreference {
  return { id: "pref_1", text: "Always lactose-free", statedBy: "Aino Virtanen", statedAt: "2026-11-02T09:00:00.000Z", claim: "lactose_free", ...over } as StatedPreference;
}
