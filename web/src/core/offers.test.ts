import { describe, expect, it } from "vitest";
import type { LiveOffer, Product } from "./catalog";
import { generateEd25519KeyPair } from "./keys";
import { NOW, P, STOCK, kitchen, past, regularHistory, statedPref } from "./kitchen-fixtures";
import {
  OFFER_WEEKLY_CAP,
  OfferError,
  buyerCheck,
  emptyPrefs,
  finalize,
  guardOffer,
  offerLine,
  reasonsFor,
  shortlist,
  signOffer,
  usualsOf,
  verifyOffer,
  type KitchenView,
  type OfferBody,
  type PastOffer,
  type SellerContext,
} from "./offers";

const cream = (id: string, over: Partial<Product> = {}): Product => ({ id, name: `Lactose-free whipping cream 35 %, 1 L (${id})`, brand: "C", category: "cream", unit: "L", packSize: 1, attributes: ["lactose_free"], allergens: ["milk"], certificates: [], deliveryReliability: 0.97, carbonKgPerUnit: 4.6, ...over });
const cheapBox: Product = { ...P.box2, id: "C-BOX", name: "Cheaper lactose-free milk 1.5 %, 10 L box", deliveryReliability: 0.99 };
const nutCream = cream("N-CREAM", { allergens: ["milk", "nuts"], name: "Hazelnut cream liqueur base" });
const plainCream = cream("P-CREAM", { attributes: [] });
const PRODUCTS = [P.box, P.box2, cheapBox, P.litre, P.organic, cream("L-CREAM"), nutCream, plainCream, P.oat];

const live = (ids: string[], price: Record<string, number> = {}): Map<string, LiveOffer> =>
  new Map(ids.map((id) => [id, { productId: id, unitPriceCents: price[id] ?? STOCK[id]?.unitPriceCents ?? 520, availablePacks: 100, deliveryDate: "2026-11-17" }]));

function k(over: Partial<KitchenView> = {}): KitchenView {
  // Ten orders of the 10 L box (the usual), and weekly cream it already buys (another product).
  const history = [...regularHistory().map((h) => ({ ...h, lines: h.lines.map((l) => ({ ...l, productId: "T-BOX" })) })), past(cream("OLD-CREAM"), 6, 3), past(cream("OLD-CREAM"), 6, 10)];
  return {
    orgId: "org_laakso",
    name: "Laakso Catering Oy",
    profile: kitchen(history),
    mandate: { allowedCategories: ["milk", "cream"], requiredAttributes: [], forbiddenAllergens: ["nuts"], requiredCertificates: [] },
    prefs: emptyPrefs(),
    past: [],
    bought: ["T-BOX", "U-BOX", "OLD-CREAM"],
    ...over,
  };
}
const ctx = (over: Partial<SellerContext> = {}): SellerContext => ({ now: NOW, newListings: [], ...over });
const offered = (productId: string, daysAgo: number, status: PastOffer["status"] = "offered"): PastOffer => ({ offerId: `ofr_${productId}_${daysAgo}`, productId, family: "milk", at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), status });

describe("what the selling agent proposes", () => {
  it("finds the usual weekly product and a cheaper like-for-like, with the figures, from live prices only", () => {
    const usuals = usualsOf(k().profile, PRODUCTS, NOW);
    expect(usuals.map((u) => [u.family, u.product.id])).toEqual([["milk", "T-BOX"]]);
    const s = shortlist(k(), PRODUCTS, ctx());
    expect(s.priceIds).toContain("T-BOX"); // the usual is priced to compare against
    expect(s.priceIds.length).toBeLessThanOrEqual(6);
    const r = finalize(k(), s, ctx({ live: live(s.priceIds, { "C-BOX": 1150, "T-BOX": 1290 }) }));
    const box = r.proposals.find((p) => p.product.id === "C-BOX")!;
    expect(box.reasons[0]).toMatchObject({ kind: "cheaper", comparedWith: { productId: "T-BOX" }, unit: "L", perUnitCents: 115, theirPerUnitCents: 129, savingPct: 10.9 });
    expect(box.suggestedPacks).toBe(10); // the usual 100 L in 10 L boxes
    expect(offerLine(box.reasons)).toMatch(/€1\.15 per litre against €1\.29 per litre.*10\.9 % less/);
  });

  it("says nothing about price without a live price, and never suggests a 1 L carton for a 10 L box kitchen as like-for-like", () => {
    const rs = reasonsFor(cheapBox, k(), usualsOf(k().profile, PRODUCTS, NOW), ctx());
    expect(rs.some((r) => r.kind === "cheaper")).toBe(false);
    expect(reasonsFor(P.litre, k(), usualsOf(k().profile, PRODUCTS, NOW), ctx({ live: live(["T-1L", "T-BOX"], { "T-1L": 100 }) })).some((r) => r.kind === "cheaper")).toBe(false);
  });

  it("in season: cream in November, new to this kitchen in a family it buys", () => {
    const rs = reasonsFor(cream("L-CREAM"), k(), [], ctx());
    expect(rs.map((r) => r.kind)).toEqual(["in_season", "new_to_kitchen"]);
    expect(rs[0]).toMatchObject({ season: "christmas_cream", source: { url: expect.stringMatching(/^https:/) } });
  });

  it("new in the assortment only when the listing record says so, and only for 90 days", () => {
    expect(reasonsFor(P.organic, k(), [], ctx({ newListings: [{ productId: "T-ORG", listedAt: "2026-11-02" }] }))[0]).toMatchObject({ kind: "new_in_assortment" });
    expect(reasonsFor(P.organic, k(), [], ctx({ newListings: [{ productId: "T-ORG", listedAt: "2026-06-01" }] })).some((r) => r.kind === "new_in_assortment")).toBe(false);
  });

  it("proposes at most the weekly cap, one per family, never what the kitchen already buys", () => {
    const s = shortlist(k(), PRODUCTS, ctx());
    expect(s.candidates.map((c) => c.product.id)).not.toContain("T-BOX");
    const r = finalize(k(), s, ctx({ live: live(s.priceIds, { "C-BOX": 1150 }) }));
    expect(r.proposals.length).toBeLessThanOrEqual(OFFER_WEEKLY_CAP);
    expect(new Set(r.proposals.map((p) => p.product.category)).size).toBe(r.proposals.length);
  });
});

describe("guardrails", () => {
  const usuals = () => usualsOf(k().profile, PRODUCTS, NOW);
  const L = () => live(["L-CREAM", "N-CREAM", "P-CREAM", "C-BOX", "T-BOX", "T-ORG", "T-OAT"], { "C-BOX": 1150 });

  it("forbidden by rule: the mandate's allergens, its categories, and a rule the kitchen's people stated", () => {
    const g = guardOffer({ product: nutCream, reasons: reasonsFor(nutCream, k(), [], ctx()) }, k(), [], ctx({ live: L() }));
    expect(g).toMatchObject({ ok: false, rule: "forbidden_by_rule" });
    expect(guardOffer({ product: P.oat, reasons: [{ kind: "in_season", season: "x", label: "x", months: [11], why: "x", source: { title: "x", url: "https://x" } }] }, k(), [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "forbidden_by_rule", reason: expect.stringMatching(/mandate does not cover plant drink/) });
    const strict = k({ profile: kitchen(k().profile!.history, [statedPref({ kind: "require_claim", claim: "lactose_free", text: "Always lactose-free" })]) });
    expect(guardOffer({ product: plainCream, reasons: reasonsFor(plainCream, strict, [], ctx()) }, strict, [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "forbidden_by_rule", reason: expect.stringMatching(/not lactose_free/) });
    // and the selection never even prices it
    expect(shortlist(strict, PRODUCTS, ctx()).priceIds).not.toContain("P-CREAM");
  });

  it("muted: the product, its family, or the reason; the selling agent does not even consider it", () => {
    const c = cream("L-CREAM");
    const by = { by: "Aino", at: "2026-11-10T10:00:00Z" };
    for (const mute of [{ scope: "product" as const, value: "L-CREAM" }, { scope: "family" as const, value: "cream" }, { scope: "reason" as const, value: "in_season" }]) {
      const kk = k({ prefs: { mutes: [{ ...mute, ...by }] } });
      expect(guardOffer({ product: c, reasons: reasonsFor(c, kk, [], ctx()) }, kk, [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "muted" });
      const s = shortlist(kk, PRODUCTS, ctx());
      expect(finalize(kk, s, ctx({ live: L() })).proposals.map((p) => p.product.id)).not.toContain("L-CREAM");
    }
  });

  it("offers off: nothing at all, whatever the data", () => {
    const kk = k({ prefs: { off: { by: "Aino", at: "2026-11-10T10:00:00Z" }, mutes: [] } });
    const s = shortlist(kk, PRODUCTS, ctx());
    const r = finalize(kk, s, ctx({ live: L() }));
    expect(r.proposals).toEqual([]);
    expect(r.withheld.every((w) => w.rule === "offers_off")).toBe(true);
  });

  it("weekly cap: a kitchen that had two offers this week gets no third; an older one does not count", () => {
    const c = cream("L-CREAM");
    const full = k({ past: [offered("A", 1), offered("B", 6)] });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, full, [], ctx()) }, full, [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "weekly_cap" });
    const old = k({ past: [offered("A", 1), offered("B", 8)] });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, old, [], ctx()) }, old, [], ctx({ live: L() }))).toEqual({ ok: true });
    const r = finalize(k({ past: [offered("A", 1)] }), shortlist(k(), PRODUCTS, ctx()), ctx({ live: L() }));
    expect(r.proposals.length).toBeLessThanOrEqual(1);
  });

  it("unsupported claim: a figure the data does not give, a campaign's claim the data does not back, or no reason at all", () => {
    const c = cream("L-CREAM");
    // "cheaper" with made-up figures
    const fake = { kind: "cheaper" as const, comparedWith: { productId: "T-BOX", name: "box" }, unit: "L" as const, perUnitCents: 50, theirPerUnitCents: 129, savingPct: 61 };
    expect(guardOffer({ product: cheapBox, reasons: [fake] }, k(), usuals(), ctx({ live: L() }))).toMatchObject({ ok: false, rule: "unsupported_claim" });
    // a campaign wants to say "new in the assortment" of a product the listing record does not have
    expect(guardOffer({ product: c, reasons: reasonsFor(c, k(), [], ctx()), claimed: ["new_in_assortment"] }, k(), [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "unsupported_claim", reason: expect.stringMatching(/new in assortment/) });
    // in July, cream is not in season: nothing left to say
    const july = ctx({ now: new Date("2026-07-15T08:00:00Z"), live: L() });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, k(), [], july) }, k(), [], july)).toMatchObject({ ok: false, rule: "unsupported_claim" });
    // "in season" claimed in July
    expect(guardOffer({ product: c, reasons: reasonsFor(c, k(), [], ctx()) }, k(), [], july)).toMatchObject({ ok: false, rule: "unsupported_claim" });
  });

  it("one open offer of a product is enough: a second run does not offer it again", () => {
    const c = cream("L-CREAM");
    const kk = k({ past: [{ ...offered("L-CREAM", 1), family: "cream" }] });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, kk, [], ctx()) }, kk, [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "already_offered" });
    expect(shortlist(kk, PRODUCTS, ctx()).candidates.map((x) => x.product.id)).not.toContain("L-CREAM");
  });

  it("a recent decline keeps the product away for 30 days; no live price, no offer", () => {
    const c = cream("L-CREAM");
    const kk = k({ past: [{ ...offered("L-CREAM", 12, "declined"), family: "cream" }] });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, kk, [], ctx()) }, kk, [], ctx({ live: L() }))).toMatchObject({ ok: false, rule: "declined_recently" });
    expect(guardOffer({ product: c, reasons: reasonsFor(c, k(), [], ctx()) }, k(), [], ctx({ live: new Map() }))).toMatchObject({ ok: false, rule: "not_available" });
  });
});

describe("the signed offer", () => {
  const body = (over: Partial<OfferBody> = {}): OfferBody => ({
    offerId: "ofr_test_1",
    isOrder: false,
    seller: { issuer: "urn:dock:wholesaler", agent: "dock-selling-agent", name: "AimoPilot selling agent" },
    buyer: { orgId: "org_laakso", name: "Laakso Catering Oy" },
    product: { productId: "L-CREAM", name: "Cream", category: "cream", unit: "L", packSize: 1, attributes: ["lactose_free"], allergens: ["milk"], allergensDeclared: true, certificates: [] },
    reasons: reasonsFor(cream("L-CREAM"), k(), [], ctx()),
    line: "In season now.",
    price: { unitPriceCents: 520, currency: "EUR", per: "pack" },
    suggestedPacks: 1,
    validFrom: NOW.toISOString(),
    validUntil: new Date(NOW.getTime() + 24 * 3600_000).toISOString(),
    terms: "This is an offer, not an order.",
    evidence: [],
    ...over,
  });

  it("verifies offline against the wholesaler key, for its buyer only, and not after it expires or once altered", async () => {
    const key = await generateEd25519KeyPair("w1");
    const token = await signOffer(body(), key);
    await expect(verifyOffer(token, [key], { now: NOW, orgId: "org_laakso" })).resolves.toMatchObject({ offerId: "ofr_test_1", isOrder: false });
    await expect(verifyOffer(token, [key], { now: NOW, orgId: "org_other" })).rejects.toMatchObject({ code: "offer_wrong_buyer" });
    await expect(verifyOffer(token, [key], { now: new Date(NOW.getTime() + 25 * 3600_000) })).rejects.toMatchObject({ code: "offer_expired" });
    const [h, p, s] = token.split(".");
    const tampered = JSON.parse(Buffer.from(p, "base64url").toString());
    tampered.credentialSubject.offer.price.unitPriceCents = 1;
    await expect(verifyOffer(`${h}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${s}`, [key], { now: NOW })).rejects.toBeInstanceOf(OfferError);
    const other = await generateEd25519KeyPair("w2");
    await expect(verifyOffer(token, [other], { now: NOW })).rejects.toMatchObject({ code: "offer_unknown_key" });
  });

  it("the buyer's own check judges a nutrition rule on the product's master data, not on the offer's short facts", () => {
    // Metsola's case: a school's rule needs a declared figure. The offer carries no nutrition declaration, so judged on
    // the offer alone every offer looks "undeclared" and was hidden from the kitchen while operations showed it open.
    const school = k({ mandate: { ...k().mandate, nutritionRules: [{ nutrient: "sugar", max: 12, categories: ["cream"] }] } });
    const product = { ...cream("L-CREAM"), nutrition: { per: "100ml" as const, values: { sugar: 3 } } };
    expect(buyerCheck(body(), school, NOW)).toMatchObject({ show: false });
    expect(buyerCheck(body(), school, NOW, product)).toEqual({ show: true });
    expect(buyerCheck(body(), school, NOW, { ...product, nutrition: { per: "100ml", values: { sugar: 20 } } })).toMatchObject({ show: false });
  });

  it("the buyer's own check: rules, mutes, offers off, already bought", () => {
    const b = body();
    expect(buyerCheck(b, k(), NOW)).toEqual({ show: true });
    expect(buyerCheck(b, k({ mandate: { ...k().mandate, allowedCategories: ["milk"] } }), NOW)).toMatchObject({ show: false });
    expect(buyerCheck(b, k({ prefs: { mutes: [{ scope: "family", value: "cream", by: "A", at: "2026-11-10" }] } }), NOW)).toEqual({ show: false, why: "muted" });
    expect(buyerCheck(b, k({ prefs: { off: { by: "A", at: "2026-11-10" }, mutes: [] } }), NOW)).toEqual({ show: false, why: "offers are off" });
    expect(buyerCheck(b, k({ bought: ["L-CREAM"] }), NOW)).toMatchObject({ show: false });
    expect(buyerCheck(b, k(), new Date(NOW.getTime() + 25 * 3600_000))).toEqual({ show: false, why: "expired" });
  });
});
