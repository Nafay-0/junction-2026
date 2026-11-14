import { beforeAll, describe, expect, it } from "vitest";
import { base64url } from "jose";
import { InMemoryCatalog } from "./catalog";
import { generateEd25519KeyPair, type KeyPair } from "./keys";
import { signMandate } from "./mandate";
import { QuoteError, QuoteSchema, buildQuote, signQuote, verifyQuote, type QuoteInput } from "./quote";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";
import { sampleMandate } from "./test-fixtures";

const NOW = new Date("2026-11-13T10:00:00.000Z");
let wholesaler: KeyPair;
let input: Omit<QuoteInput, "lines">;

beforeAll(async () => {
  wholesaler = await generateEd25519KeyPair("dock-wholesaler-1");
  const catalog = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => NOW);
  const ids = ["VA-1010", "AR-2010", "VA-1001"];
  input = {
    quoteId: "qt_1",
    buyerOrgId: "org_laakso",
    agentId: "agent_buyer_1",
    mandateId: "mnd_test_1",
    requestId: "req_1",
    products: await catalog.searchProducts({ ids }),
    offers: await catalog.getLiveOffers(ids),
    now: NOW,
    ttlMinutes: 30,
  };
});

describe("buildQuote", () => {
  it("prices each line at the live price and fixes the total", () => {
    const q = buildQuote({ ...input, lines: [{ productId: "VA-1010", quantity: 60 }] });
    expect(q.lines[0]).toMatchObject({
      productId: "VA-1010",
      quantity: 60,
      unitPriceCents: 1290,
      lineTotalCents: 77_400,
      deliveryDate: "2026-11-14",
      unit: "L",
      packSize: 10,
      attributes: ["lactose_free", "fat_1_5"],
    });
    expect(q.totalCents).toBe(77_400);
    expect(q.issuedAt).toBe(NOW.toISOString());
    expect(q.expiresAt).toBe("2026-11-13T10:30:00.000Z");
  });

  it("records what a substitute replaces, with the original's price", () => {
    const q = buildQuote({
      ...input,
      lines: [
        { productId: "VA-1010", quantity: 60 },
        { productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" },
      ],
    });
    expect(q.lines[1].substituteFor).toMatchObject({ productId: "VA-1010", unitPriceCents: 1290, packSize: 10 });
    expect(q.totalCents).toBe(77_400 + 54_800);
  });

  it("quotes a stand-in whose replaced product cannot be priced now (its cut-off passed): never a failed quote", () => {
    const q = buildQuote({ ...input, offers: input.offers.filter((o) => o.productId !== "VA-1010"), lines: [{ productId: "AR-2010", quantity: 40, substituteFor: "VA-1010" }] });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].substituteFor).toMatchObject({ productId: "VA-1010", unitPriceCents: 0 });
  });

  it.each([
    [{ productId: "XX-1", quantity: 1 }, "quote_unknown_product"],
    [{ productId: "VA-1010", quantity: 61 }, "quote_insufficient_stock"],
    [{ productId: "VA-1010", quantity: 0 }, "quote_invalid_line"],
    [{ productId: "VA-1010", quantity: 1.5 }, "quote_invalid_line"],
    [{ productId: "VA-1010", quantity: 1, substituteFor: "VA-1010" }, "quote_invalid_line"],
    [{ productId: "AR-2010", quantity: 1, substituteFor: "XX-1" }, "quote_unknown_product"],
  ])("refuses %o with %s", (line, code) => {
    expect(() => buildQuote({ ...input, lines: [line] })).toThrow(expect.objectContaining({ code }));
  });

  it("names the available quantity when stock is short", () => {
    try {
      buildQuote({ ...input, lines: [{ productId: "VA-1010", quantity: 100 }] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteError);
      expect((err as QuoteError).details).toMatchObject({ productId: "VA-1010", requested: 100, available: 60 });
    }
  });

  it("refuses a product with master data but no live offer", () => {
    expect(() => buildQuote({ ...input, offers: [], lines: [{ productId: "VA-1010", quantity: 1 }] })).toThrow(
      expect.objectContaining({ code: "quote_no_offer" }),
    );
  });

  it("refuses duplicate lines and empty quotes", () => {
    const dup = [
      { productId: "VA-1010", quantity: 1 },
      { productId: "VA-1010", quantity: 2 },
    ];
    expect(() => buildQuote({ ...input, lines: dup })).toThrow(expect.objectContaining({ code: "quote_invalid_line" }));
    expect(() => buildQuote({ ...input, lines: [] })).toThrow(expect.objectContaining({ code: "quote_invalid_line" }));
  });
});

describe("quote life", () => {
  const withOffer = (over: Record<string, unknown>) => ({ ...input, offers: input.offers.map((o) => (o.productId === "VA-1001" ? { ...o, ...over } : o)), lines: [{ productId: "VA-1001", quantity: 1 }] });

  it("never outlives the price it rests on", () => {
    const q = buildQuote(withOffer({ priceValidUntil: "2026-12-31T00:00:00+0200" }));
    expect(q).toMatchObject({ expiresAt: "2026-11-13T10:30:00.000Z", expiresBecause: "ttl" });
    const short = buildQuote(withOffer({ priceValidUntil: "2026-11-13T12:10:00+02:00" }));
    expect(short).toMatchObject({ expiresAt: "2026-11-13T10:10:00.000Z", expiresBecause: "price_validity" });
  });

  it("never outlives the order cut-off of the date it promises", () => {
    const q = buildQuote(withOffer({ orderBy: "2026-11-13T12:20:00+0200", priceValidUntil: "9999-12-31T00:00:00+0200" }));
    expect(q).toMatchObject({ expiresAt: "2026-11-13T10:20:00.000Z", expiresBecause: "order_cutoff" });
  });

  it("caps any configured time to live at a day, and refuses a quote with no time left", () => {
    expect(buildQuote({ ...input, ttlMinutes: 60 * 24 * 365, lines: [{ productId: "VA-1001", quantity: 1 }] }).expiresAt).toBe("2026-11-14T10:00:00.000Z");
    expect(() => buildQuote(withOffer({ orderBy: "2026-11-13T12:00:30+0200" }))).toThrow(expect.objectContaining({ code: "quote_source_expired" }));
  });
});

describe("quote signatures", () => {
  it("round-trips through a compact JWS signed by the wholesaler", async () => {
    const q = buildQuote({ ...input, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const token = await signQuote(q, wholesaler);
    expect(await verifyQuote(token, wholesaler)).toEqual(q);
  });

  it("does not judge expiry itself: that is a policy rule with a reason", async () => {
    const q = buildQuote({ ...input, ttlMinutes: 3, lines: [{ productId: "VA-1001", quantity: 1 }] });
    const token = await signQuote(q, wholesaler);
    await expect(verifyQuote(token, wholesaler)).resolves.toMatchObject({ quoteId: "qt_1" });
  });

  it("fails when an agent edits the price inside the token", async () => {
    const q = buildQuote({ ...input, lines: [{ productId: "VA-1001", quantity: 20 }] });
    const [h, p, s] = (await signQuote(q, wholesaler)).split(".");
    const body = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    body.lines[0].unitPriceCents = 1;
    const tampered = [h, base64url.encode(JSON.stringify(body)), s].join(".");
    await expect(verifyQuote(tampered, wholesaler)).rejects.toMatchObject({ code: "quote_signature_invalid" });
  });

  it("fails when the quote was signed by anyone but the wholesaler", async () => {
    const forger = await generateEd25519KeyPair("dock-wholesaler-1");
    const q = buildQuote({ ...input, lines: [{ productId: "VA-1001", quantity: 20 }] });
    await expect(verifyQuote(await signQuote(q, forger), wholesaler)).rejects.toMatchObject({ code: "quote_signature_invalid" });
  });

  it("fails on garbage and on other document types", async () => {
    await expect(verifyQuote("x.y.z", wholesaler)).rejects.toMatchObject({ code: "quote_malformed" });
    const mandateToken = await signMandate(sampleMandate(NOW), wholesaler);
    await expect(verifyQuote(mandateToken, wholesaler)).rejects.toMatchObject({ code: "quote_malformed" });
  });
});

describe("quote: deposits, VAT and the customer's own price (data depth)", () => {
  const NOW2 = new Date("2026-11-13T10:00:00.000Z");
  const product = { ...SEED_PRODUCTS.find((p) => p.id === "VA-1001")!, deposits: [{ material: "4", quantity: 24 }, { material: "171", quantity: 1 }] };
  const offer = { productId: "VA-1001", unitPriceCents: 2469, availablePacks: 100, deliveryDate: "2026-11-16", taxRatePct: 13.5, listPriceCents: 3086, netPrice: false };
  const build = (p = product, o: Record<string, unknown> = offer) => buildQuote({ quoteId: "q", buyerOrgId: "o", agentId: "a", mandateId: "m", requestId: "r", lines: [{ productId: "VA-1001", quantity: 10 }], products: [p], offers: [o as never], now: NOW2, ttlMinutes: 30 });

  it("adds the deposit as its own part of the total, outside VAT, and names what it cannot price", () => {
    const q = build();
    const l = q.lines[0];
    expect(l.deposit).toMatchObject({ perPackCents: 360, totalCents: 3600, unknown: ["171"] });
    expect(q).toMatchObject({ goodsCents: 24690, depositCents: 3600, totalCents: 28290 });
    expect(q.vat).toEqual({ byRate: [{ ratePct: 13.5, baseCents: 24690, vatCents: 3333 }], vatCents: 3333, incomplete: false });
    expect(QuoteSchema.safeParse({ ...q, totalCents: 24690 }).success).toBe(false); // a total without the deposit does not add up
  });

  it("states the rate and where it came from, and the list price beside the customer's own", () => {
    const l = build().lines[0];
    expect(l).toMatchObject({ taxRatePct: 13.5, taxSource: "price_service", listUnitPriceCents: 3086 });
    const fromFile = build(product, { ...offer, taxRatePct: undefined, listPriceCents: 2469 }).lines[0];
    expect(fromFile).toMatchObject({ taxRatePct: 13.5, taxSource: "product_file" });
    expect(fromFile.listUnitPriceCents).toBeUndefined();
    const unknown = build({ ...product, vatRatePct: undefined }, { ...offer, taxRatePct: undefined }).lines[0];
    expect(unknown.taxRatePct).toBeUndefined();
  });

  it("signs the nutrition declaration with the line, for the gate", () => {
    expect(build().lines[0].nutrition?.values.protein).toBe(3.6);
  });
});

describe("quote: order steps from the partner's lot size", () => {
  const NOW3 = new Date("2026-11-13T10:00:00.000Z");
  const base = SEED_PRODUCTS.find((p) => p.id === "VA-3101")!; // yoghurt by the kilo
  const offer = { productId: "VA-3101", unitPriceCents: 349, availablePacks: 500, deliveryDate: "2026-11-16" };
  const q = (lotSize: number | undefined, quantity: number) =>
    buildQuote({ quoteId: "q", buyerOrgId: "o", agentId: "a", mandateId: "m", requestId: "r", lines: [{ productId: "VA-3101", quantity }], products: [{ ...base, ...(lotSize !== undefined ? { lotSize } : {}), salesUnit: "KG" }], offers: [offer], now: NOW3, ttlMinutes: 30 });

  it("0.01 (the partner's default), 1 and none mean whole sales units", () => {
    for (const lot of [0.01, 1, undefined]) {
      expect(q(lot, 3).lines[0]).toMatchObject({ quantity: 3, lineTotalCents: 1047 });
      expect(() => q(lot, 2.5)).toThrow(/whole number of packs/);
    }
  });

  it("a real fractional lot (1.5 kg) takes its multiples, priced to the cent", () => {
    const l = q(1.5, 4.5).lines[0];
    expect(l).toMatchObject({ quantity: 4.5, lineTotalCents: 1571 }); // 4.5 x 3.49 = 15.705 -> 15.71
    expect(() => q(1.5, 4)).toThrow(/multiple of its order step 1.5 KG/);
  });
});
