import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Runtime } from "../runtime";
import type { AssortmentItem } from "./match";
import { parsePack, type PackSize } from "./text";

/**
 * The wholesaler's assortment as the matcher reads it: names in three languages, brand, supplier, one consumer pack
 * and every GTIN. Built once per runtime from the catalogue Dock runs on.
 *
 * GTINs: the partner's product file lists a GTIN for the sales unit and for each packaging level, but the catalogue
 * index (src/core/catalog/partner.ts) does not keep them. Until the core does, `pnpm radar:gtins` writes them to
 * .data/radar/gtins.json.gz (git-ignored, like the index; never commit it). Without that file the radar still
 * matches on producer, exact name and pack size, and says on its screen that GTIN matching is off.
 */

export type GtinIndex = { builtAt: string; products: Record<string, string[]> };

export function gtinIndexPath(): string {
  return process.env.RADAR_GTIN_INDEX?.trim() || path.resolve(process.cwd(), ".data", "radar", "gtins.json.gz");
}

function loadGtins(): GtinIndex | undefined {
  const file = gtinIndexPath();
  if (!existsSync(/*turbopackIgnore: true*/ file)) return undefined;
  try {
    const buf = readFileSync(/*turbopackIgnore: true*/ file);
    return JSON.parse((file.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8")) as GtinIndex;
  } catch {
    return undefined;
  }
}

export type Assortment = { items: AssortmentItem[]; byId: Map<string, AssortmentItem>; gtins: boolean; source: "valio" | "seed"; builtAt: string };

const cache = new WeakMap<object, Assortment>();

export async function assortmentOf(rt: Pick<Runtime, "catalog">): Promise<Assortment> {
  const hit = cache.get(rt.catalog);
  if (hit) return hit;
  const gt = loadGtins();
  const items: AssortmentItem[] = [];
  const catalog = rt.catalog as unknown as { index?: { products: { id: string; names: AssortmentItem["names"]; brand: string | null; vendor: string | null; pack: { perSalesUnit: { L?: number; kg?: number }; baseUnitsPerSalesUnit: number | null; primary: "L" | "kg" | null } }[] } };
  let source: Assortment["source"] = "seed";
  if (catalog.index?.products) {
    source = "valio";
    for (const p of catalog.index.products) {
      const name = p.names.fi ?? p.names.en ?? p.names.sv ?? "";
      items.push({ id: p.id, names: { ...p.names }, brand: p.brand, vendor: p.vendor, pack: parsePack(name) ?? packFromIndex(p.pack), gtins: gt?.products[p.id] ?? [] });
    }
  } else {
    for (const p of await rt.catalog.searchProducts({ limit: 100 })) {
      const pack: PackSize | undefined = p.unit === "pcs" ? undefined : { amount: p.packSize, unit: p.unit, count: 1, text: `${p.packSize} ${p.unit}` };
      items.push({ id: p.id, names: { en: p.name, ...(p.names ?? {}) }, brand: p.brand, vendor: p.vendor ?? null, pack: parsePack(p.name) ?? pack, gtins: gt?.products[p.id] ?? [] });
    }
  }
  const a: Assortment = { items, byId: new Map(items.map((i) => [i.id, i])), gtins: !!gt, source, builtAt: new Date().toISOString() };
  cache.set(rt.catalog, a);
  return a;
}

function packFromIndex(pack: { perSalesUnit: { L?: number; kg?: number }; baseUnitsPerSalesUnit: number | null; primary: "L" | "kg" | null }): PackSize | undefined {
  const unit = pack.primary;
  if (!unit) return undefined;
  const total = pack.perSalesUnit[unit];
  if (!total) return undefined;
  const count = pack.baseUnitsPerSalesUnit && pack.baseUnitsPerSalesUnit > 0 ? pack.baseUnitsPerSalesUnit : 1;
  return { amount: Math.round((total / count) * 10000) / 10000, unit, count, text: `${count} x ${total / count} ${unit}` };
}
