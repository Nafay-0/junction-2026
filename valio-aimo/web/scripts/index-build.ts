/**
 * Build the compact catalogue index from the partner's files.
 *
 *   pnpm index:build                 reads VALIO_DATA_DIR (default: ../data/valio from web/), writes .data/valio/
 *   pnpm index:build --out <file>    write somewhere else (VALIO_INDEX_PATH is read the same way at runtime)
 *   pnpm index:build --costs         also say what each data-depth column adds to the gzipped file
 *   pnpm index:build --no-texts      leave the product texts out (ingredients, storage, usage, disposal, about): a smaller file
 *
 * The partner restricts the data to this challenge and the repo becomes public: the output folder is git-ignored.
 * Never commit it, never copy product text into code or tests.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { DEPTH_COLUMNS, buildCatalogIndex, encodeIndex } from "@/core/catalog/partner";
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
  const json = JSON.stringify(encodeIndex(index, { omit: process.argv.includes("--no-texts") ? ["texts"] : [] }));
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
  const has = (f: (p: (typeof index.products)[number]) => unknown) => index.products.filter((p) => f(p)).length;
  console.log(
    `  nutrition for ${has((p) => p.nutrition)}; deposits for ${has((p) => p.deposits)}; VAT class for ${has((p) => p.vatRatePct !== undefined)}; ingredients text for ${has((p) => p.texts?.ingredients)}; storage text for ${has((p) => p.texts?.storage)}; usage text for ${has((p) => p.texts?.usage)}; main ingredient for ${has((p) => p.mainIngredient)}; origins for ${has((p) => p.origins)}; fish reports for ${has((p) => p.fish)}; storage temperature for ${has((p) => p.storageTempC)}`,
  );
  if (process.argv.includes("--costs")) {
    // What each data-depth column adds: the gzipped file with that column left empty, against the whole file.
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    const all = gz.length;
    const without = (cols: readonly string[]) => gzipSync(JSON.stringify(encodeIndex(index, { omit: cols })), { level: 9 }).length;
    const base = without(DEPTH_COLUMNS);
    console.log(`  costs (gzipped): without any data-depth column ${kb(base)}; with all ${kb(all)} (+${kb(all - base)})`);
    for (const c of DEPTH_COLUMNS) console.log(`    ${c.padEnd(12)} +${kb(all - without([c]))}`);
  }
}

main();
