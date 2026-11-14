/**
 * Check the search evaluation's request set against the catalogue index and the knowledge map.
 *
 *   pnpm tsx eval/search/check-cases.ts            every case: how many products are right, how many stand in
 *   pnpm tsx eval/search/check-cases.ts --quiet    the summary line and failures only
 *
 * Fails (exit 1) when a case that should have right products has none, when a stand-in-only case has right products
 * or no stand-in, when a slug is not a kind in the map, when ids repeat, or when the holdout count is not 30.
 * Prints ids and counts only, never product names: product text is partner data.
 */
import type { IndexedProduct } from "@/core/catalog/partner";
import { registerNatureProfiles } from "@/core/catalog/nature";
import { allergenEvidence } from "@/core/catalog/search";
import { loadKnowledgeFile, resolveKnowledgeFile } from "@/server/knowledge/store";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { SEARCH_CASES, type SearchCase } from "./cases";

export const HOLDOUT_COUNT = 30;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= Math.max(0.03 * b, 1e-6);

/** The hard constraints a case puts on any product it counts (right or stand-in), from the partner's data only. */
export function meetsConstraints(c: SearchCase, p: IndexedProduct): boolean {
  if (c.productId && p.id !== c.productId) return false;
  if (c.claims?.some((cl) => !p.claims.includes(cl))) return false;
  for (const a of c.allergenFree ?? []) {
    const e = allergenEvidence(p, a);
    if (e === "contains" || e === "may_contain" || e === "unknown") return false;
  }
  if (c.brand && !fold(`${p.brand ?? ""} ${p.vendor ?? ""}`).includes(fold(c.brand))) return false;
  if (c.pack) {
    // One handled unit holds the amount (a 10 l box), or the sales unit is a single unit that does.
    const k = p.pack;
    const base = k.perBaseUnit[c.pack.unit];
    const single = k.baseUnitsPerSalesUnit === 1 || k.baseUnitsPerSalesUnit === null;
    if (!near(base, c.pack.amount) && !(single && near(k.perSalesUnit[c.pack.unit], c.pack.amount))) return false;
  }
  return true;
}

/** Right: the product's kind is one the case accepts, and it meets every constraint. */
export function isRight(c: SearchCase, p: IndexedProduct, kindSlugOf: (id: string) => string | undefined): boolean {
  const slug = kindSlugOf(p.id);
  return ((!!slug && c.right.includes(slug)) || !!c.alsoRight?.includes(p.id)) && meetsConstraints(c, p);
}

/** A stand-in: not right, but a kind the case accepts as standing in, meeting the same hard constraints. */
export function isStandin(c: SearchCase, p: IndexedProduct, kindSlugOf: (id: string) => string | undefined): boolean {
  const slug = kindSlugOf(p.id);
  if (!slug || !c.standins?.includes(slug) || c.right.includes(slug)) return false;
  // A product id request has one right product; anything else of the kind is a stand-in only by kind.
  const { productId: _id, ...rest } = c;
  void _id;
  return meetsConstraints(rest as SearchCase, p);
}

/** Load what the matcher needs: the products and each product's kind slug. */
export async function loadTruth() {
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("no catalogue index (pnpm index:build)");
  const src = await resolveKnowledgeFile();
  if (src.from === "none") throw new Error(`no knowledge map: ${src.reason}`);
  const data = loadKnowledgeFile(src.file);
  // As the server does: fresh, whole produce without allergen data counts by its nature (core/catalog/nature.ts).
  const kindOf = new Map(data.kinds.map((k) => [k.key, k]));
  const prof = new Map(data.profiles.map((p) => [p.id, p]));
  registerNatureProfiles((id) => {
    const p = prof.get(id);
    const k = p && kindOf.get(p.kind);
    return p && k ? { family: k.family, form: p.form, state: p.state, kindLabel: k.label } : undefined;
  });
  const slugOfKind = new Map(data.kinds.map((k) => [k.key, k.slug]));
  const slugById = new Map<string, string>();
  for (const pr of data.profiles) {
    const s = slugOfKind.get(pr.kind);
    if (s) slugById.set(pr.id, s);
  }
  return { products: loaded.index.products, slugs: new Set(data.kinds.map((k) => k.slug)), kindSlugOf: (id: string) => slugById.get(id) };
}

async function main() {
  const quiet = process.argv.includes("--quiet");
  const { products, slugs, kindSlugOf } = await loadTruth();
  const failures: string[] = [];
  const ids = new Set<string>();
  for (const c of SEARCH_CASES) {
    if (ids.has(c.id)) failures.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    for (const s of [...c.right, ...(c.standins ?? [])]) if (!slugs.has(s)) failures.push(`${c.id}: unknown kind slug ${s}`);
    const right = products.filter((p) => isRight(c, p, kindSlugOf)).length;
    const standins = products.filter((p) => isStandin(c, p, kindSlugOf)).length;
    const special = c.tags.includes("not_sold") || c.tags.includes("standin_only");
    if (!special && right === 0) failures.push(`${c.id}: no right product`);
    if (c.tags.includes("standin_only") && (right > 0 || standins === 0)) failures.push(`${c.id}: stand-in only, but ${right} right and ${standins} stand-ins`);
    if (c.tags.includes("not_sold") && (c.right.length || right > 0)) failures.push(`${c.id}: not sold, but right products listed`);
    if (c.tags.includes("standin_only") && !c.standins?.length) failures.push(`${c.id}: stand-in only without stand-ins`);
    if (!quiet) console.log(`${c.id.padEnd(16)} ${c.lang.padEnd(5)} ${c.kind.padEnd(8)} right ${String(right).padStart(4)}  stand-ins ${String(standins).padStart(4)}${c.holdout ? "  holdout" : ""}`);
  }
  const holdout = SEARCH_CASES.filter((c) => c.holdout).length;
  if (holdout !== HOLDOUT_COUNT) failures.push(`holdout count ${holdout}, expected ${HOLDOUT_COUNT}`);
  const count = (f: (c: SearchCase) => string) => Object.entries(SEARCH_CASES.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`\n${SEARCH_CASES.length} cases (${count((c) => c.lang)}; ${count((c) => c.kind)}), holdout ${holdout}, ${failures.length} failure(s)`);
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exit(1);
}

if (process.argv[1]?.endsWith("check-cases.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
