import type { Product } from "../catalog";
import { amountToSalesUnits, type Amount, type Conversion, type ConversionOptions, type PackInfo } from "./pack";
import { categorySlug, type IndexedProduct } from "./partner";
import { natureOf } from "./nature";
import { productFacets } from "./search";

/**
 * Index record -> Dock `Product`. Keeps every field the policy and the quote already rely on, with the meaning they
 * had for the seed, and adds the partner detail as optional fields.
 *
 * - `unit`/`packSize`: litres or kilograms per pack only when the pack content is certain; otherwise "pcs" and the
 *   number of base units per pack, so nothing downstream compares litres it does not have.
 * - `allergens`: contains plus may-contain (both block a forbidden allergen). Products without allergen data have an
 *   empty list and `allergenInfo.declared === false`: unknown, not safe.
 * - `deliveryReliability` / `carbonKgPerUnit`: 0 when the partner has no figure, flagged by `*Known: false`.
 */
export function toDockProduct(p: IndexedProduct): Product {
  const pack = p.pack;
  const measure = pack.certain ? pack.primary : null;
  const packSize = measure ? pack.perSalesUnit[measure]! : (pack.baseUnitsPerSalesUnit ?? 1);
  const unit: Product["unit"] = measure === "L" ? "L" : measure === "kg" ? "kg" : "pcs";

  // Carbon is a per-kg group average. Per unit only when the kilograms in one unit are known.
  const perKg = p.carbonGroupAvgKgCo2ePerKg;
  const kgPerPack = pack.certainMeasures.includes("kg") ? pack.perSalesUnit.kg : undefined;
  const carbonPerUnit = perKg === null ? null : unit === "kg" ? perKg : kgPerPack !== undefined && packSize > 0 ? (perKg * kgPerPack) / packSize : null;

  return {
    id: p.id,
    name: p.names.en ?? p.names.fi ?? p.names.sv ?? p.id,
    brand: p.brand ?? p.vendor ?? "unknown",
    category: categorySlug(p.categoryCode),
    unit,
    packSize,
    attributes: [...p.claims],
    // By its nature counts as contained too (celeriac is celery), so every check of `allergens` sees it.
    allergens: [...new Set([...p.allergens.contains, ...p.allergens.mayContain, ...(nature(p).byNature?.allergens ?? [])])].sort(),
    certificates: [...p.labels],
    deliveryReliability: p.deliveryReliability ?? 0,
    carbonKgPerUnit: carbonPerUnit === null ? 0 : Math.round(carbonPerUnit * 1000) / 1000,
    source: "valio",
    names: { ...p.names },
    vendor: p.vendor,
    categoryCode: p.categoryCode,
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    lotSize: p.lotSize,
    packContent: {
      perSalesUnit: { ...pack.perSalesUnit },
      baseUnitsPerSalesUnit: pack.baseUnitsPerSalesUnit,
      certain: pack.certain,
      certainMeasures: [...pack.certainMeasures],
      issues: [...pack.issues],
      label: pack.label,
    },
    allergenInfo: { declared: p.allergens.declared, contains: [...p.allergens.contains], mayContain: [...p.allergens.mayContain], freeFrom: [...p.allergens.freeFrom], ...nature(p) },
    deliveryReliabilityKnown: p.deliveryReliability !== null,
    carbonKnown: carbonPerUnit !== null,
    carbonGroupAvgKgCo2ePerKg: perKg,
    temperatureClass: p.temperature.class,
    countryOfOrigin: p.countryOfOrigin,
    substitutes: [...p.substitutes],
    kinds: productFacets(p),
  };
}

/** Conversion facts for any Dock product: partner products carry them; seed products are certain by construction. */
export function packInfoOf(product: Product): PackInfo {
  if (product.packContent) {
    return {
      salesUnit: product.salesUnit ?? "pack",
      perSalesUnit: product.packContent.perSalesUnit,
      certainMeasures: product.packContent.certainMeasures,
      issues: product.packContent.issues as PackInfo["issues"],
      label: product.packContent.label,
      lotSize: product.lotSize,
    };
  }
  if (product.unit === "pcs") return { salesUnit: "pack", perSalesUnit: {}, certainMeasures: [], issues: ["no_content_data"], label: `${product.packSize} pcs per pack`, lotSize: 1 };
  return {
    salesUnit: "pack",
    perSalesUnit: { [product.unit]: product.packSize },
    certainMeasures: [product.unit],
    issues: [],
    label: `${product.packSize} ${product.unit === "L" ? "l" : "kg"} per pack`,
    lotSize: 1,
  };
}

/** How many packs of a product make up an amount in litres or kilograms. See amountToSalesUnits. */
export function packsFor(product: Product, amount: Amount, opts?: ConversionOptions): Conversion {
  return amountToSalesUnits(packInfoOf(product), amount, opts);
}

/**
 * How many pieces (eggs, tortillas, buns) one sales unit holds, when the data says so; undefined otherwise, and then
 * nothing may convert pieces to packs. A product without partner pack data (the seed) is counted in pieces by its
 * own unit. Partner products: only what the name states, in the partner's own conventions, reconciled with the
 * packaging hierarchy (baseUnitsPerSalesUnit):
 *   "Kieku Barn egg M10 580g"          egg size code + count: 10 eggs per sales unit (sold as the base unit)
 *   "20 x Kieku Barn egg L6 408g"      20 base units of 6, sold by the case of 20: 120
 *   "Salud wheat tortilla 30cm 8x18pc" 8 bags of 18, sold by the case of 8: 144
 *   "Salud wheat tortilla 18pc"        18, sold as the base unit
 * A count the hierarchy does not confirm (the name says 8 x but the case holds 6) is not a piece count.
 */
export function piecesPerSalesUnit(product: Product): number | undefined {
  if (!product.packContent) return product.unit === "pcs" && product.packSize > 0 ? product.packSize : undefined;
  const factor = product.packContent.baseUnitsPerSalesUnit;
  if (!factor || factor <= 0) return undefined;
  if (product.salesUnit === "KG") return undefined; // sold by weight: "10 pcs" is the pack the weight comes in, not a count
  const names = [product.names?.en, product.names?.fi, product.names?.sv, product.name].filter((n): n is string => !!n).map((n) => n.toLowerCase().replace(/,/g, "."));
  for (const name of names) {
    let per: number | undefined; // pieces in one base unit, or in what the name's multiplier counts
    let lead: number | undefined; // "20 x ..." or the 8 of "8x18pc": base units in the sales unit
    const counted = /(?<![\d.])(\d{1,3})\s*x\s*(\d{1,4})\s*(?:pcs|pc|kpl|stk|st)\b/.exec(name);
    if (counted) {
      lead = Number(counted[1]);
      per = Number(counted[2]);
    } else {
      // Eggs by the partner's size code ("M10 580g"): only with the pack weight beside it, as egg packs state it.
      const egg = /\begg|\bmuna|\bägg/.test(name) && /\d\s*(?:g|kg)\b/.test(name) ? /(?<![a-z0-9])(?:xs|s|m|l|xl)(\d{1,3})(?![\d.])(?!\s*(?:g|kg|ml|l|cl|dl)\b)/.exec(name) : null;
      const pcs = /(?<![\d.x])(\d{1,4})\s*(?:pcs|pc|kpl|stk|pieces)\b/.exec(name);
      per = egg ? Number(egg[1]) : pcs ? Number(pcs[1]) : undefined;
      const leading = /^(\d{1,3})\s*x\s/.exec(name);
      if (leading) lead = Number(leading[1]);
      // Another multiplier in the name ("2pcs ... 40x40g"): which one counts the sales unit is not decidable.
      const others = [...name.matchAll(/(?<![\d.])\d+\s*x\s*\d/g)].filter((m) => m.index !== 0);
      if (others.length) continue;
    }
    if (!per || per <= 0) continue;
    if (lead !== undefined) {
      if (lead === factor) return lead * per; // the case holds `lead` base units of `per` pieces
      if (factor === 1) return lead * per; // the sales unit is the whole multipack the name describes
      return undefined; // the name and the hierarchy disagree: no count
    }
    if (factor === 1) return per; // sold as the unit the name describes
    return undefined; // "18pc" in a case of 8 bags: per bag or per case? Not decidable.
  }
  return undefined;
}

/** The by-nature evidence for a product without allergen data, when the exception applies (catalog/nature.ts). */
function nature(p: IndexedProduct): { byNature?: { allergens: string[]; basis: string } } {
  const n = p.allergens.declared ? undefined : natureOf(p);
  return n ? { byNature: { allergens: [...n.allergens], basis: n.basis } } : {};
}
