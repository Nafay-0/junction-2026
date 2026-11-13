import type { Product } from "../catalog";
import { amountToSalesUnits, type Amount, type Conversion, type ConversionOptions, type PackInfo } from "./pack";
import { categorySlug, type IndexedProduct } from "./partner";

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
    allergens: [...new Set([...p.allergens.contains, ...p.allergens.mayContain])].sort(),
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
    allergenInfo: { declared: p.allergens.declared, contains: [...p.allergens.contains], mayContain: [...p.allergens.mayContain], freeFrom: [...p.allergens.freeFrom] },
    deliveryReliabilityKnown: p.deliveryReliability !== null,
    carbonKnown: carbonPerUnit !== null,
    carbonGroupAvgKgCo2ePerKg: perKg,
    temperatureClass: p.temperature.class,
    countryOfOrigin: p.countryOfOrigin,
    substitutes: [...p.substitutes],
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
