/**
 * GTINs for the recall radar's matcher: every GTIN the partner's product file lists for a product (its sales unit
 * and each packaging level), keyed by product id.
 *
 *   pnpm radar:gtins     reads VALIO_DATA_DIR (default: ../data/valio from web/), writes .data/radar/gtins.json.gz
 *
 * The catalogue index keeps GTINs now (`pnpm index:build`, carried to a deployment by `pnpm index:publish`), and the
 * radar reads them from there. This side file is only for an index built before that. Partner data: the output
 * folder is git-ignored. Never commit it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { gtinIndexPath } from "@/server/radar/assortment";
import { validGtin } from "@/server/radar/text";
import { valioDataDir } from "@/server/valio/index-store";
import { loadLocalEnv } from "./lib/env";

type Raw = { id?: unknown; salesUnitGtin?: unknown; units?: { gtin?: unknown }[] };

function main() {
  loadLocalEnv();
  const file = path.join(valioDataDir(), "valio_aimo_junction26_product_data.json");
  if (!existsSync(file)) {
    console.error(`Partner product file not found: ${file}. Set VALIO_DATA_DIR.`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as Raw[];
  const products: Record<string, string[]> = {};
  let codes = 0;
  for (const p of raw) {
    if (typeof p.id !== "string") continue;
    const all = [p.salesUnitGtin, ...(p.units ?? []).map((u) => u.gtin)].filter((g): g is string => typeof g === "string").map((g) => g.trim());
    const valid = [...new Set(all.filter((g) => validGtin(g) && !/^0+$/.test(g)))];
    if (valid.length) {
      products[p.id] = valid;
      codes += valid.length;
    }
  }
  const out = gtinIndexPath();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(JSON.stringify({ builtAt: new Date().toISOString(), products })));
  console.log(`GTINs for ${Object.keys(products).length} of ${raw.length} products (${codes} codes) -> ${path.relative(process.cwd(), out)}`);
}

main();
