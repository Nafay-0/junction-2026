import { describe, expect, it } from "vitest";
import { usableOffer } from "@/core/catalog";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { toDockProduct } from "@/core/catalog/product";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import { evaluatePolicy } from "@/core/policy";
import { buildQuote } from "@/core/quote";
import { arrivalOf } from "@/core/recipe-roles";
import { sampleMandate } from "@/core/test-fixtures";
import { shortfallOf } from "@/core/watch";
import type { ValioLiveResult } from "./live-client";
import { interpret } from "./valio-catalog";

/**
 * Valio's answers about its mock API (14 Nov), as tests:
 *   "closingTime is the cut off related to availableDate."
 *   "Availability ge 999999 means that we do not know the availability and our current logic allows ordering any
 *    quantity. [...] Empty = not available."
 */
const NOW = new Date("2026-11-13T10:00:00.000Z"); // Fri 12:00 Helsinki
const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV, NOW);
const raw = index.products.find((p) => p.id === "900001")!;
const product = toDockProduct(raw);
const price = { ok: true as const, valueCents: 2580, currency: "EUR", validFrom: "2026-01-01", validTo: "2026-12-31" };
const answer = (lines: { availableAmount: number; availableDate: string }[], closingTime = "2026-11-15T17:00:00+0200", extra: Record<string, unknown> = {}): ValioLiveResult => ({
  productId: raw.id,
  requestedDate: "2026-11-16",
  price,
  availability: { timeNow: "2026-11-13T12:00:00+0200", closingTime, salesBlock: false, logisticModel: "Stock", line: lines.map((l) => ({ ...l, salesUnit: raw.salesUnit, salesBlock: false }))[0], ...(lines.length > 1 ? { lines: lines.map((l) => ({ ...l, salesUnit: raw.salesUnit, salesBlock: false })).sort((a, b) => a.availableDate.localeCompare(b.availableDate)) } : {}), ...extra },
});

describe("closingTime pairs with its row's availableDate", () => {
  it("one row: the cut-off is for that row's date, not the requested day", () => {
    const st = interpret(raw, answer([{ availableAmount: 30, availableDate: "2026-11-16" }]), "2026-11-18", NOW);
    expect(st.offer).toMatchObject({ deliveryDate: "2026-11-16", orderBy: "2026-11-15T17:00:00+0200", orderByFor: "2026-11-16", cutoffPassed: false });
  });

  it("two rows with different dates: the cut-off is the earliest row's; when it has passed, the later row is used with no cut-off stated", () => {
    const rows = [
      { availableAmount: 30, availableDate: "2026-11-16" },
      { availableAmount: 20, availableDate: "2026-11-19" },
    ];
    const open = interpret(raw, answer(rows), "2026-11-16", NOW);
    expect(open.offer).toMatchObject({ deliveryDate: "2026-11-16", orderByFor: "2026-11-16", availablePacks: 30 });
    expect(open.problems).toEqual([]);
    const passed = interpret(raw, answer(rows, "2026-11-12T15:00:00+0200"), "2026-11-16", NOW);
    expect(passed.problems).not.toContain("cutoff_passed");
    expect(passed.offer).toMatchObject({ deliveryDate: "2026-11-19", availablePacks: 20 });
    expect(passed.offer?.orderBy).toBeUndefined(); // 12 Nov 15:00 was the cut-off for the 16th, not for the 19th
    expect(passed.message).toMatch(/2026-11-19 has no cut-off stated/);
    // One row, cut-off passed: that date cannot be had, said for that date.
    const one = interpret(raw, answer([rows[0]], "2026-11-12T15:00:00+0200"), "2026-11-18", NOW);
    expect(one.problems).toContain("cutoff_passed");
    expect(one.message).toMatch(/cut-off 2026-11-12T15:00:00\+0200 for delivery 2026-11-16 has passed/);
  });
});

describe("availability: 999999 or more is unknown and takes any quantity; empty is not available", () => {
  const mandate = sampleMandate(NOW, { allowedCategories: ["milk"], requiredAttributes: [], perOrderLimitCents: 50_000_000_000, weeklyBudgetCents: 50_000_000_000, approvers: [{ role: "x", name: "X", maxApprovalCents: 50_000_000_000 }] });
  const quoteFor = (st: ReturnType<typeof interpret>, quantity: number) =>
    buildQuote({ quoteId: "q", buyerOrgId: mandate.issuer.orgId, agentId: mandate.agentId, mandateId: mandate.mandateId, requestId: "r", lines: [{ productId: raw.id, quantity }], products: [product], offers: [usableOffer(st)!], now: NOW, ttlMinutes: 30 });

  for (const amount of [999999, 9999999999]) {
    it(`${amount}: unknown stock, orderable, any quantity through the quote and the gate, never a shortfall`, () => {
      const st = interpret(raw, answer([{ availableAmount: amount, availableDate: "2026-11-16" }]), "2026-11-16", NOW);
      expect(st).toMatchObject({ orderable: true, problems: ["stock_unknown"], offer: { stockKnown: false } });
      expect(st.message).toMatch(/stock isn't reported for this one; the wholesaler takes the order/);
      const q = quoteFor(st, 1_000_000); // more than the placeholder itself
      expect(q.lines[0].quantity).toBe(1_000_000);
      const d = evaluatePolicy(mandate, { agentId: mandate.agentId, quote: q, lines: q.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) }, { now: NOW, spentThisWeekCents: 0, quoteAlreadyUsed: false });
      expect(d.rules.filter((r) => r.outcome === "fail").map((r) => `${r.rule}: ${r.reason}`)).toEqual([]);
      expect(shortfallOf(st, "2026-11-16")).toBeUndefined();
      expect(arrivalOf(st, "2026-11-16")).toMatchObject({ ok: true, date: "2026-11-16" });
    });
  }

  it("a real amount is a real limit: the quote refuses more, the watch sees no shortfall while it lasts", () => {
    const st = interpret(raw, answer([{ availableAmount: 30, availableDate: "2026-11-16" }]), "2026-11-16", NOW);
    expect(st).toMatchObject({ orderable: true, problems: [], offer: { stockKnown: true, availablePacks: 30 } });
    expect(quoteFor(st, 30).lines[0].quantity).toBe(30);
    expect(() => quoteFor(st, 31)).toThrow(/Only 30 packs/);
    expect(shortfallOf(st, "2026-11-16")).toBeUndefined();
    const zero = interpret(raw, answer([{ availableAmount: 0, availableDate: "2026-11-16" }]), "2026-11-16", NOW);
    expect(shortfallOf(zero, "2026-11-16")).toMatchObject({ reason: "not_orderable" });
  });

  it("an empty answer (no rows, or rows without an amount) is out of stock for the day, everywhere", () => {
    for (const st of [interpret(raw, answer([]), "2026-11-16", NOW), interpret(raw, answer([], undefined, { emptyAmount: true }), "2026-11-16", NOW)]) {
      expect(st).toMatchObject({ orderable: false, problems: ["out_of_stock"] });
      expect(st.offer).toBeUndefined();
      expect(st.message).toMatch(/not available for 2026-11-16: the wholesaler's answer is empty/);
      expect(shortfallOf(st, "2026-11-16")).toMatchObject({ reason: "not_orderable" });
      expect(arrivalOf(st, "2026-11-16")).toMatchObject({ ok: false, code: "out_of_stock" });
    }
  });

  it("unknown stock with a passed cut-off is refused for the cut-off alone", () => {
    const st = interpret(raw, answer([{ availableAmount: 999999, availableDate: "2026-11-16" }], "2026-11-12T15:00:00+0200"), "2026-11-16", NOW);
    expect(st.problems).toEqual(["stock_unknown", "cutoff_passed"]);
    expect(shortfallOf(st, "2026-11-16")).toMatchObject({ reason: "cutoff_passed" });
    expect(arrivalOf(st, "2026-11-16")).toMatchObject({ ok: false, code: "cutoff_passed" });
  });
});
