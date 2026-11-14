/**
 * What an order costs beyond the price per pack, and how a Finnish wholesaler states it: prices before VAT with the
 * rate said, returnable-packaging deposits as their own line, and the customer's own price beside the list price.
 * Pure: no I/O, no clock.
 *
 * VAT. The price service returns the rate for each product (`tax.taxRate`: 13.5 % for food, 25.5 % for other goods,
 * 10 % for the low rate in 2026) and the partner calls it the source of truth; the product file's `vatCode`
 * (MEDIUM, STANDARD, LOW) is the fallback when no live price was asked. No rate is ever guessed: unknown is shown
 * as unknown. Deposits are outside VAT in Finland, so the deposit line carries none.
 *
 * Deposits. The product file lists, per sales unit, how many deposit items of which material are charged with it
 * (`deposits`: 24 x material "4" on a case of 24 cans). The price service returns no price for the materials
 * (`error: true` for every code), so the amount per item is an assumption, stated wherever it is used: the
 * published rates of the Finnish deposit system (Palpa), by the kind of packaging each material code is used for
 * in the product file. A material whose rate is not known (a returnable crate, a gas cylinder) is charged by the
 * wholesaler at delivery, and Dock says it cannot state that amount rather than leave it out silently.
 */

export type DepositKind = "can" | "glass_bottle" | "plastic_bottle_small" | "plastic_bottle" | "plastic_bottle_large" | "crate" | "gas_cylinder";

export type DepositRate = { kind: DepositKind; cents: number | null };

/**
 * The partner's deposit material codes, read from the products that use them: "4" on cans; "1" on glass bottles
 * (20 cl to 75 cl); "147" on plastic bottles of 0.33 l; "3" on 0.5 l plastic bottles; "2" on 1.5 l plastic bottles;
 * "171" one per crate of bottles; "9708918" one per gas cylinder. Amounts: Palpa's published rates (cans 0.15,
 * glass bottles 0.10, plastic bottles up to 0.35 l 0.10, 0.35 to 1.0 l 0.20, over 1.0 l 0.40). A crate and a gas
 * cylinder: no published rate, so null (unknown).
 */
export const DEPOSIT_RATES: Record<string, DepositRate> = {
  "4": { kind: "can", cents: 15 },
  "1": { kind: "glass_bottle", cents: 10 },
  "147": { kind: "plastic_bottle_small", cents: 10 },
  "3": { kind: "plastic_bottle", cents: 20 },
  "2": { kind: "plastic_bottle_large", cents: 40 },
  "171": { kind: "crate", cents: null },
  "9708918": { kind: "gas_cylinder", cents: null },
};

/** Where the deposit amounts come from, for every place that shows one. */
export const DEPOSIT_BASIS = "Deposit per item at the Finnish deposit system's (Palpa) published rates; the wholesaler's price service states no deposit price.";

export type DepositItem = { material: string; quantity: number };
export type DepositLine = { material: string; kind: DepositKind | "unknown"; quantity: number; unitCents: number | null; totalCents: number | null };
export type PackDeposit = {
  /** Per sales unit: what is charged with one pack. */
  lines: DepositLine[];
  /** The sum Dock can state per pack (known rates only). */
  knownCents: number;
  /** Materials charged with the pack whose amount Dock cannot state. */
  unknown: string[];
};

/** The deposit charged with one sales unit, or undefined when the product carries none (or the data says nothing). */
export function packDeposit(items: readonly DepositItem[] | undefined): PackDeposit | undefined {
  if (!items?.length) return undefined;
  const lines: DepositLine[] = items
    .filter((d) => d.quantity > 0)
    .map((d) => {
      const r = DEPOSIT_RATES[d.material];
      const unitCents = r?.cents ?? null;
      return { material: d.material, kind: r?.kind ?? "unknown", quantity: d.quantity, unitCents, totalCents: unitCents === null ? null : Math.round(unitCents * d.quantity) };
    });
  if (!lines.length) return undefined;
  return { lines, knownCents: lines.reduce((s, l) => s + (l.totalCents ?? 0), 0), unknown: lines.filter((l) => l.totalCents === null).map((l) => l.material) };
}

// ---------- VAT ----------

/** The product file's VAT class as a rate in percent; undefined when absent or not one class ("STANDARD MEDIUM"). */
export function vatRateOfCode(code: string | null | undefined): number | undefined {
  const parts = [...new Set((code ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean))];
  if (parts.length !== 1) return undefined;
  return { STANDARD: 25.5, MEDIUM: 13.5, LOW: 10 }[parts[0]];
}

/** The rate to state: the price service's (authoritative), else the product file's, else unknown. */
export function vatRateOf(offer: { taxRatePct?: number } | undefined, product: { vatRatePct?: number | null } | undefined): { pct: number; source: "price_service" | "product_file" } | undefined {
  if (typeof offer?.taxRatePct === "number" && Number.isFinite(offer.taxRatePct) && offer.taxRatePct >= 0 && offer.taxRatePct < 100) return { pct: offer.taxRatePct, source: "price_service" };
  if (typeof product?.vatRatePct === "number") return { pct: product.vatRatePct, source: "product_file" };
  return undefined;
}

/** VAT on an amount before tax, rounded to the cent. */
export const vatCents = (beforeTaxCents: number, ratePct: number) => Math.round((beforeTaxCents * ratePct) / 100);

export type VatBreakdown = {
  /** Goods before VAT, by rate. `rate: null` holds lines whose rate is not known. */
  byRate: { ratePct: number | null; baseCents: number; vatCents: number | null }[];
  /** VAT Dock can state (known rates only). */
  vatCents: number;
  /** True when some line's rate is not known: the total with VAT is then not stated. */
  incomplete: boolean;
};

/** VAT on an order's goods, one entry per rate, the way an invoice shows it. Deposits carry no VAT. */
export function vatBreakdown(lines: readonly { lineTotalCents: number; taxRatePct?: number | null }[]): VatBreakdown {
  const by = new Map<number | null, number>();
  for (const l of lines) {
    const r = typeof l.taxRatePct === "number" ? l.taxRatePct : null;
    by.set(r, (by.get(r) ?? 0) + l.lineTotalCents);
  }
  const byRate = [...by.entries()]
    .sort((a, b) => (a[0] ?? 999) - (b[0] ?? 999))
    .map(([ratePct, baseCents]) => ({ ratePct, baseCents, vatCents: ratePct === null ? null : vatCents(baseCents, ratePct) }));
  return { byRate, vatCents: byRate.reduce((s, x) => s + (x.vatCents ?? 0), 0), incomplete: byRate.some((x) => x.ratePct === null) };
}

// ---------- the customer's own price ----------

/**
 * The list price beside the customer's own price, when they differ: the price service returns both (`catalogPrice`
 * is what this customer pays; `listPrice` is before any customer-specific price or discount), and says when a
 * customer-specific net price was used. Undefined when there is nothing to show.
 */
export function ownPrice(offer: { unitPriceCents: number; listPriceCents?: number; netPrice?: boolean }): { listCents: number; savingCents: number; pct: number; netPrice: boolean } | undefined {
  const list = offer.listPriceCents;
  if (typeof list !== "number" || !Number.isFinite(list) || list <= offer.unitPriceCents) return undefined;
  return { listCents: list, savingCents: list - offer.unitPriceCents, pct: Math.round(((list - offer.unitPriceCents) / list) * 1000) / 10, netPrice: offer.netPrice === true };
}

// ---------- the customer number sent to the price service ----------

/**
 * The kitchen's customer number at the wholesaler: what Dock sends as `customer`, because prices and availability are
 * customer-specific. The challenge's service ignores it (any string works) and its accounts have no numbers, so a
 * kitchen without one gets a stable demo number derived from its organisation id (eight digits, prefixed 9 so it
 * can never be mistaken for a real account). A deployment with real accounts passes the real number instead.
 */
export function demoCustomerNumber(orgId: string): string {
  let h = 2166136261;
  for (const ch of orgId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `9${String(h % 10_000_000).padStart(7, "0")}`;
}
