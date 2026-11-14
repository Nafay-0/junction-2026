import { describe, expect, it } from "vitest";
import { InMemoryCatalog, MeteredCatalog, type Product } from "@/core/catalog";
import { addDaysIso, localNow } from "@/core/kitchen";
import { sampleMandate } from "@/core/test-fixtures";
import type { KitchenAgent } from "../flow";
import { kindCheck, kindSay } from "./kind-check";

/** "I can't get oat drink for Thursday; I can offer other products instead", said before the read-back's yes. */

const drink = (id: string, name: string, allergens: string[]): Product =>
  ({ id, name, brand: "Test", category: "plant_drink", unit: "L", packSize: 1, attributes: ["lactose_free", "vegan"], allergens, certificates: [], deliveryReliability: 0.95, carbonKgPerUnit: 0.3 }) as Product;
const PRODUCTS = [drink("OAT-1", "Test oat drink 1 L", ["gluten"]), drink("OAT-2", "Other oat drink 1 L", ["gluten"]), drink("SOY-1", "Test soya drink 1 L", ["soy"]), drink("RICE-1", "Test rice drink 1 L", [])];
const today = () => localNow(new Date()).date;

function agent(opts: { forbid?: string[]; oatLeadDays?: number } = {}): KitchenAgent {
  const stock = Object.fromEntries(PRODUCTS.map((p) => [p.id, { unitPriceCents: 200, availablePacks: 500, leadDays: p.id.startsWith("OAT") ? (opts.oatLeadDays ?? 1) : 1 }]));
  const catalog = new MeteredCatalog(new InMemoryCatalog(PRODUCTS, stock));
  const mandate = sampleMandate(new Date(), { allowedCategories: ["plant_drink"], requiredAttributes: [], forbiddenAllergens: opts.forbid ?? [] });
  return { rt: { catalog, kitchens: { getProfile: async () => undefined } }, session: { mandate } } as unknown as KitchenAgent;
}
const need = (deliverBy?: string) => ({ text: "20 litres of oat drink", item: { text: "oat drink", category: "plant_drink" }, quantity: { amount: 20, unit: "L" as const }, ...(deliverBy ? { deliverBy } : {}) });

describe("the kind asked for, checked before the read-back's yes", () => {
  it("says the kitchen's rules allow none of it (oat drink where gluten is never allowed)", async () => {
    const k = await kindCheck(agent({ forbid: ["gluten"] }), need());
    expect(k).toMatchObject({ asked: "oat drink", why: "rules" });
    expect(kindSay(k!, (d) => d)).toMatch(/^I can't get oat drink: your rules do not allow any of it\. I can offer other products instead\.$/);
  });

  it("says none can arrive on the day asked, from the wholesaler's live status for a few products only", async () => {
    const day = addDaysIso(today(), 2);
    const k = await kindCheck(agent({ oatLeadDays: 6 }), need(day));
    expect(k).toMatchObject({ asked: "oat drink", why: "day", day });
  });

  it("says nothing when the kind can be had", async () => {
    expect(await kindCheck(agent(), need(addDaysIso(today(), 3)))).toBeUndefined();
  });
});
