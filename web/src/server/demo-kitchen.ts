import { createPrivateKey } from "node:crypto";
import type { JWK } from "jose";
import type { Product } from "@/core/catalog";
import { addDaysIso, emptyProfile, isoWeekday, localNow, type HistoryEntry, type KitchenProfile } from "@/core/kitchen";
import { importEd25519KeyPair, type KeyPair } from "@/core/keys";
import type { Mandate } from "@/core/mandate";
import { SEED_PRODUCTS, SEED_STOCK } from "@/core/seed";
import { known } from "@/core/options";
import { addDays, sha256Hex } from "@/core/util";

/**
 * DEV ONLY. A returning restaurant kitchen for the demo: six weeks of milk and cream orders, and one rule
 * its head chef stated earlier ("always lactose-free"). Like the other demo org, its key comes from a public
 * string unless DOCK_DEMO_KITCHEN_JWK is set.
 */
export const KITCHEN_ORG = {
  orgId: "org_ravintola_kaari",
  name: "Ravintola Kaari",
  kid: "ravintola-kaari-2026",
  agentId: "agent_kaari_buyer_01",
};

const PUBLIC_DEV_SEED = "dock demo kitchen key v1 - public, not a secret";

function devJwkFromSeed(seedText: string): JWK {
  const seed = Buffer.from(sha256Hex(seedText), "hex"); // 32 bytes, as in dev-fixtures.ts
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }).export({ format: "jwk" }) as JWK;
}

export async function demoKitchenKeyPair(): Promise<KeyPair> {
  const fromEnv = process.env.DOCK_DEMO_KITCHEN_JWK;
  return importEd25519KeyPair(KITCHEN_ORG.kid, fromEnv ? (JSON.parse(fromEnv) as JWK) : devJwkFromSeed(PUBLIC_DEV_SEED));
}

/** The kitchen's mandate: the agent may spend €100 alone; the head chef signs off up to €1,000. */
export function demoKitchenMandate(now: Date, overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: `mnd_kaari_${now.toISOString().slice(0, 10).replaceAll("-", "")}`,
    issuer: { orgId: KITCHEN_ORG.orgId, name: KITCHEN_ORG.name },
    agentId: KITCHEN_ORG.agentId,
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: addDays(now, 7).toISOString(),
    currency: "EUR",
    perOrderLimitCents: 10_000,
    weeklyBudgetCents: 150_000,
    allowedCategories: ["milk", "cream", "yoghurt"],
    requiredAttributes: [],
    forbiddenAllergens: ["nuts"],
    requiredCertificates: [],
    delivery: { maxLeadDays: 5 },
    substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 }, // like for like alone; anything else to the head chef
    approvers: [
      { role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 100_000 },
      { role: "owner", name: "Jari Mäkelä", maxApprovalCents: 500_000 },
    ],
    ...overrides,
  };
}

/** Price per litre for demo history when the seed has no price for a product: plausible food-service levels, ex VAT. */
const DEMO_CENTS_PER_LITRE: Record<string, number> = { milk: 150, cream: 450 };

/** A history entry's price per pack: the seed's when it has one, else the plausible level above. Never a live call. */
function historyPrice(p: Product): number {
  return SEED_STOCK[p.id]?.unitPriceCents ?? Math.round((DEMO_CENTS_PER_LITRE[p.category] ?? 300) * p.packSize);
}

/** Plain products of a kind: no coffee milk, sour milk or portion cups (kinds come from the names). */
const plain = (p: Product) => (p.kinds ?? []).length === 0;

/**
 * Lactose-free semi-skimmed milk in big containers (a 10 l bag-in-box or a case of them), the kind a kitchen buys
 * by the hundred litres, most reliable first. Picked by attributes, so it works on the seed and on the real catalogue.
 */
export function bigMilkBoxes(products: Product[]): Product[] {
  const container = (p: Product) => (p.packContent?.baseUnitsPerSalesUnit ? p.packSize / p.packContent.baseUnitsPerSalesUnit : p.packSize);
  return products
    .filter((p) => p.category === "milk" && p.unit === "L" && plain(p) && container(p) >= 5 && ["lactose_free", "fat_1_5"].every((a) => p.attributes.includes(a)) && !p.attributes.includes("organic"))
    .sort((a, b) => (b.deliveryReliabilityKnown === false ? -1 : (known(b.deliveryReliability) ?? -1)) - (a.deliveryReliabilityKnown === false ? -1 : (known(a.deliveryReliability) ?? -1)) || a.id.localeCompare(b.id));
}

/** Past orders on the given delivery days, `litres` each, from `usual` except the last one from `other` (a sell-out week). */
function milkHistory(usual: Product, other: Product, deliveries: string[], litres: number[], prefix: string, chosenLabels?: string[]): HistoryEntry[] {
  return deliveries.map((d, i) => {
    const p = i === deliveries.length - 1 ? other : usual;
    const packs = Math.max(1, Math.round(litres[i % litres.length] / p.packSize));
    return entry(p, packs, d, `${prefix}${String(i + 1).padStart(2, "0")}`, chosenLabels);
  });
}

function entry(p: Product, packs: number, delivery: string, orderId: string, chosenLabels?: string[]): HistoryEntry {
  const price = historyPrice(p);
  return {
    orderId,
    placedAt: `${addDaysIso(delivery, -1)}T08:00:00.000Z`,
    neededBy: delivery,
    deliveryDate: delivery,
    family: p.category,
    amount: Math.round(packs * p.packSize * 100) / 100,
    unit: p.unit,
    totalCents: packs * price,
    lines: [{ productId: p.id, name: p.name, category: p.category, attributes: p.attributes, packs, packSize: p.packSize, unit: p.unit, unitPriceCents: price }],
    ...(chosenLabels ? { chosenLabels } : {}),
  };
}

/** The delivery days on given weekdays in the six weeks before today, most recent `count`. */
function pastDeliveries(now: Date, weekdays: number[], count: number): string[] {
  const today = localNow(now).date;
  const out: string[] = [];
  for (let d = addDaysIso(today, -42); d < today; d = addDaysIso(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out.slice(-count);
}

/**
 * Six weeks of Monday and Thursday deliveries of about 100 L of lactose-free semi-skimmed milk in big boxes,
 * mostly the most reliable brand, the last one from another (a sell-out week), plus weekly cream.
 * Products are picked from the catalogue by their attributes, so the history follows the catalogue it runs on:
 * the seed, or the partner's real products.
 */
export function demoKitchenProfile(now: Date, products: Product[] = SEED_PRODUCTS): KitchenProfile {
  const profile = emptyProfile(KITCHEN_ORG.orgId, KITCHEN_ORG.name);
  const boxes = bigMilkBoxes(products);
  const cream = products.filter((p) => p.category === "cream" && p.unit === "L" && plain(p) && p.attributes.includes("lactose_free")).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (boxes.length === 0) return profile;
  const [usual, other = usual] = boxes;
  const today = localNow(now).date;
  const deliveries = pastDeliveries(now, [1, 4], 12);
  const history = milkHistory(usual, other, deliveries, [100, 90, 110, 100, 120, 100, 90, 100, 110, 100, 100, 90], "ord_hist_");
  if (cream) deliveries.filter((d) => isoWeekday(d) === 4).forEach((d, i) => history.push(entry(cream, Math.max(1, Math.round(6 / cream.packSize)), d, `ord_hist_${50 + i}`)));
  return {
    ...profile,
    history: history.sort((a, b) => a.placedAt.localeCompare(b.placedAt)),
    stated: [
      {
        id: "pref_kaari_lactose",
        kind: "dimension",
        dimension: "lactose",
        choice: "lactose_free",
        text: "Always lactose-free",
        statedBy: "Sanna Koskinen (head chef)",
        statedAt: `${addDaysIso(today, -21)}T09:00:00.000Z`,
      },
    ],
  };
}

/**
 * A visitor's hotel kitchen: deliveries Monday to Saturday, about 400 L of lactose-free semi-skimmed milk on
 * Mondays and Thursdays for the breakfast buffet, chosen by price. For a hotel that size, the partner's 1,000 L
 * example is a big week, not a slip, so no mistake check stops it; the memory settles the fat content and the
 * usual product, so the request reaches its options without a question.
 */
export function hotelKitchenProfile(orgId: string, name: string, now: Date, products: Product[] = SEED_PRODUCTS): KitchenProfile {
  const profile = { ...emptyProfile(orgId, name), deliveryWeekdays: [1, 2, 3, 4, 5, 6] };
  const boxes = bigMilkBoxes(products);
  if (boxes.length === 0) return profile;
  const [usual, other = usual] = boxes;
  const history = milkHistory(usual, other, pastDeliveries(now, [1, 4], 10), [400, 380, 420, 400, 440, 400, 380, 400, 420, 400], `ord_${orgId}_`, ["best_price"]);
  return { ...profile, history };
}

/** The catalogue products the demo histories are drawn from: a few local master-data searches, never a live call. */
export async function demoProducts(catalog: { searchProducts(q: { category: string; attributes: string[]; limit: number }): Promise<Product[]> }): Promise<Product[]> {
  const [milk, cream] = await Promise.all([catalog.searchProducts({ category: "milk", attributes: ["lactose_free"], limit: 100 }), catalog.searchProducts({ category: "cream", attributes: ["lactose_free"], limit: 100 })]);
  return [...milk, ...cream];
}
