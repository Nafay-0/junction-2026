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
    substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 },
    approvers: [
      { role: "head_chef", name: "Sanna Koskinen", maxApprovalCents: 100_000 },
      { role: "owner", name: "Jari Mäkelä", maxApprovalCents: 500_000 },
    ],
    ...overrides,
  };
}

/**
 * Six weeks of Monday and Thursday deliveries of about 100 L of lactose-free semi-skimmed milk in 10 L boxes,
 * mostly the most reliable brand, the last one from the other brand (a sell-out week), plus weekly cream.
 * Products are picked from the catalogue by their attributes, so the history follows the catalogue it runs on.
 */
export function demoKitchenProfile(now: Date, products: Product[] = SEED_PRODUCTS): KitchenProfile {
  const profile = emptyProfile(KITCHEN_ORG.orgId, KITCHEN_ORG.name);
  const boxes = products
    .filter((p) => p.category === "milk" && p.unit === "L" && p.packSize >= 5 && ["lactose_free", "fat_1_5"].every((a) => p.attributes.includes(a)) && !p.attributes.includes("organic"))
    .sort((a, b) => (known(b.deliveryReliability) ?? 0) - (known(a.deliveryReliability) ?? 0) || a.id.localeCompare(b.id));
  const cream = products.find((p) => p.category === "cream" && p.attributes.includes("lactose_free"));
  if (boxes.length === 0) return profile;
  const [usual, other = usual] = boxes;

  const today = localNow(now).date;
  const deliveries: string[] = [];
  for (let d = addDaysIso(today, -42); d < today; d = addDaysIso(d, 1)) if ([1, 4].includes(isoWeekday(d))) deliveries.push(d);
  const amounts = [10, 9, 11, 10, 12, 10, 9, 10, 11, 10, 10, 9];
  const price = (p: Product) => SEED_STOCK[p.id]?.unitPriceCents ?? 1000;
  const entry = (p: Product, packs: number, delivery: string, n: number): HistoryEntry => ({
    orderId: `ord_hist_${String(n).padStart(2, "0")}`,
    placedAt: `${addDaysIso(delivery, -1)}T08:00:00.000Z`,
    neededBy: delivery,
    deliveryDate: delivery,
    family: p.category,
    amount: packs * p.packSize,
    unit: p.unit,
    totalCents: packs * price(p),
    lines: [{ productId: p.id, name: p.name, category: p.category, attributes: p.attributes, packs, packSize: p.packSize, unit: p.unit, unitPriceCents: price(p) }],
  });
  const recent = deliveries.slice(-amounts.length);
  const history: HistoryEntry[] = recent.map((d, i) => entry(i === recent.length - 1 ? other : usual, amounts[i], d, i + 1));
  if (cream) recent.filter((d) => isoWeekday(d) === 4).forEach((d, i) => history.push(entry(cream, 6, d, 50 + i)));
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
