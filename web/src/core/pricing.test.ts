import { describe, expect, it } from "vitest";
import { demoCustomerNumber, ownPrice, packDeposit, vatBreakdown, vatRateOf, vatRateOfCode } from "./pricing";

describe("deposits", () => {
  it("prices a case of cans at the published rate, per sales unit", () => {
    const d = packDeposit([{ material: "4", quantity: 24 }])!;
    expect(d.knownCents).toBe(360);
    expect(d.lines[0]).toMatchObject({ kind: "can", unitCents: 15, totalCents: 360 });
    expect(d.unknown).toEqual([]);
  });

  it("states what it knows and names what it cannot price (a crate), never counting it as zero silently", () => {
    const d = packDeposit([{ material: "3", quantity: 24 }, { material: "171", quantity: 1 }])!;
    expect(d.knownCents).toBe(480);
    expect(d.unknown).toEqual(["171"]);
    expect(packDeposit([{ material: "x99", quantity: 2 }])!.lines[0]).toMatchObject({ kind: "unknown", totalCents: null });
  });

  it("has no deposit when the data lists none", () => {
    expect(packDeposit(undefined)).toBeUndefined();
    expect(packDeposit([])).toBeUndefined();
  });
});

describe("VAT", () => {
  it("reads the product file's VAT class, and nothing from an ambiguous one", () => {
    expect(vatRateOfCode("MEDIUM")).toBe(13.5);
    expect(vatRateOfCode("MEDIUM MEDIUM")).toBe(13.5);
    expect(vatRateOfCode("STANDARD")).toBe(25.5);
    expect(vatRateOfCode("LOW")).toBe(10);
    expect(vatRateOfCode("STANDARD MEDIUM")).toBeUndefined();
    expect(vatRateOfCode("NOT_APPLICABLE")).toBeUndefined();
    expect(vatRateOfCode(undefined)).toBeUndefined();
  });

  it("takes the price service's rate over the product file's, and says where it came from", () => {
    expect(vatRateOf({ taxRatePct: 25.5 }, { vatRatePct: 13.5 })).toEqual({ pct: 25.5, source: "price_service" });
    expect(vatRateOf({}, { vatRatePct: 13.5 })).toEqual({ pct: 13.5, source: "product_file" });
    expect(vatRateOf(undefined, {})).toBeUndefined();
  });

  it("adds VAT up by rate, and marks the total incomplete when a rate is unknown", () => {
    const b = vatBreakdown([{ lineTotalCents: 10000, taxRatePct: 13.5 }, { lineTotalCents: 2000, taxRatePct: 25.5 }, { lineTotalCents: 1000, taxRatePct: 13.5 }]);
    expect(b.byRate).toEqual([{ ratePct: 13.5, baseCents: 11000, vatCents: 1485 }, { ratePct: 25.5, baseCents: 2000, vatCents: 510 }]);
    expect(b.vatCents).toBe(1995);
    expect(b.incomplete).toBe(false);
    expect(vatBreakdown([{ lineTotalCents: 500 }]).incomplete).toBe(true);
  });
});

describe("the customer's own price", () => {
  it("shows the list price only when the customer pays less", () => {
    expect(ownPrice({ unitPriceCents: 2469, listPriceCents: 3086, netPrice: false })).toEqual({ listCents: 3086, savingCents: 617, pct: 20, netPrice: false });
    expect(ownPrice({ unitPriceCents: 2469, listPriceCents: 2469 })).toBeUndefined();
    expect(ownPrice({ unitPriceCents: 2469 })).toBeUndefined();
  });

  it("gives each kitchen a stable demo customer number that cannot pass for a real one", () => {
    expect(demoCustomerNumber("org_kaari")).toBe(demoCustomerNumber("org_kaari"));
    expect(demoCustomerNumber("org_kaari")).not.toBe(demoCustomerNumber("org_laakso"));
    expect(demoCustomerNumber("org_kaari")).toMatch(/^9\d{7}$/);
  });
});
