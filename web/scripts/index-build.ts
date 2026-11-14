/**
 * Build the compact catalogue index from the partner's files.
 *
 *   pnpm index:build                 reads VALIO_DATA_DIR (default: ../data/valio from web/), writes .data/valio/
 *   pnpm index:build --out <file>    write somewhere else (VALIO_INDEX_PATH is read the same way at runtime)
 *
 * The partner restricts the data to this challenge and the repo becomes public: the output folder is git-ignored.
 * Never commit it, never copy product text into code or tests.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { buildCatalogIndex, encodeIndex } from "@/core/catalog/partner";
import { defaultIndexPath, loadCatalogIndex, valioDataDir } from "@/server/valio/index-store";
import { loadLocalEnv } from "./lib/env";

const FILES = {
  products: "valio_aimo_junction26_product_data.json",
  reliability: "valio_aimo_junction26_delivery_reliability.csv",
  carbon: "valio_aimo_junction26_carbon_footprint.csv",
};

function main() {
  loadLocalEnv();
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1]) : defaultIndexPath();
  const dir = valioDataDir();
  const missing = Object.values(FILES).filter((f) => !existsSync(path.join(dir, f)));
  if (missing.length) {
    console.error(`Partner files not found in ${dir}: ${missing.join(", ")}.\nSet VALIO_DATA_DIR to the folder with the Valio Aimo files.`);
    process.exit(1);
  }
  const t0 = performance.now();
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, FILES.products), "utf8"));
  const index = buildCatalogIndex(raw, readFileSync(path.join(dir, FILES.reliability), "utf8"), readFileSync(path.join(dir, FILES.carbon), "utf8"));
  const json = JSON.stringify(encodeIndex(index));
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, out.endsWith(".gz") ? gz : json);
  const ms = Math.round(performance.now() - t0);

  const loaded = loadCatalogIndex(out);
  if (!loaded || loaded.index.products.length !== index.products.length) throw new Error("The written index does not load back.");
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const s = index.stats;
  console.log(`Indexed ${s.products} products (${s.skipped} skipped) in ${ms} ms -> ${path.relative(process.cwd(), out)}`);
  console.log(`  file ${mb(statSync(out).size)} (${mb(json.length)} uncompressed JSON); load and decode ${loaded.loadMs} ms`);
  console.log(`  pack content certain for ${s.packCertain} (${Math.round((s.packCertain / s.products) * 100)} %); delivery reliability for ${s.withReliability}; carbon (group average) for ${s.withCarbon}`);
  console.log(`  GTINs for ${index.products.filter((p) => p.gtins?.length).length} products (the recall radar matches EANs on them; index:publish carries them)`);
}

main();
