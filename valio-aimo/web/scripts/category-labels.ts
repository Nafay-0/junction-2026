/**
 * pnpm categories:build: short human labels for the partner's numeric product categories.
 *
 * The partner publishes 349 category codes and no names. This derives a label once per category from the most
 * frequent ordinary English words in its products' names (no brands, vendors, numbers, units or country codes),
 * and writes only the code, the label, the product count and the usual storage temperature to
 * src/server/catalog-categories.json. No product text is copied beyond single common words.
 *
 * Needs the local index (pnpm index:build). Re-run when the partner's data changes.
 */
import { writeFileSync } from "node:fs";
import { CATEGORY_NAMES } from "./category-names";
import path from "node:path";
import { CATEGORY_SLUGS } from "../src/core/catalog/partner";
import { loadCatalogIndex } from "../src/server/valio/index-store";

const STOP = new Set(
  (
    "a an and or of the with in for to on by from at as x pcs pc kpl st ki kg g gr l ml dl cl ltr lt pack pak box bag case tin can jar bottle bot ras prk krt " +
    "frozen chilled fresh new mini maxi big small large extra premium classic original natural plain whole half sliced pieces piece portion portions " +
    "approx about ca n uht esl eko organic luomu gluten free lactose lactosefree fat low light finnish finland suomi hyva suomalainen product products " +
    "ground green soft all purpose fold folded ply round fried homepackage home package aimo msc arc tete dunicel harki bbq red white black yellow blue brown dark milk sweet hot cold dry dried smoked salted sugar " +
    "victorinox dunisoft evolin opa chup iltalehti dunicel tet edding mmx rll bpa boxong non vol edition connect pick catcher matche fiber waxed paperboard bio led pillar oat " +
    "food foods mix mixed assorted various variety style type grade class cut cuts raw cooked ready brand foodservice catering professional pro cl mm cm"
  ).split(" "),
);
const COUNTRY = /^[a-z]{2}$/;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !COUNTRY.test(t));
const singular = (t: string) => (t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.endsWith("oes") ? t.slice(0, -2) : t.endsWith("ses") || t.endsWith("ss") ? t : t.endsWith("s") ? t.slice(0, -1) : t);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const loaded = loadCatalogIndex();
if (!loaded) throw new Error("No catalogue index: run pnpm index:build first.");
const byCat = new Map<string, typeof loaded.index.products>();
for (const p of loaded.index.products) byCat.set(p.categoryCode, [...(byCat.get(p.categoryCode) ?? []), p]);

const out: Record<string, { label: string; count: number; temperature: string | null }> = {};
for (const [code, ps] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const brandWords = new Set(ps.flatMap((p) => [...tokens(p.brand ?? ""), ...tokens(p.vendor ?? "")]));
  const df = new Map<string, number>();
  for (const p of ps) for (const t of new Set(tokens(p.names.en ?? p.names.fi ?? "").map(singular))) if (!brandWords.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const ranked = [...df.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let top = ranked.filter(([, n], i) => n / ps.length >= (i === 0 ? 0.12 : 0.2)).slice(0, 2).map(([t]) => cap(t));
  if (top.length === 0) top = ranked.slice(0, 1).map(([t]) => cap(t));
  const named = CATEGORY_SLUGS[code];
  const label = named ? cap(named.replaceAll("_", " ")) : CATEGORY_NAMES[code] ? CATEGORY_NAMES[code] : top.length ? top.join(", ").replace(/, ([^,]+)$/, " and $1") : `Group ${code}`;
  const temps = new Map<string, number>();
  for (const p of ps) if (p.temperature.class) temps.set(p.temperature.class, (temps.get(p.temperature.class) ?? 0) + 1);
  const temperature = [...temps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  out[code] = { label, count: ps.length, temperature };
}
/** Departments by the first two digits of the code. Named here, by hand, from what the groups under them hold. */
const DEPARTMENTS: Record<string, string> = {
  "10": "Dairy and cheese",
  "11": "Fresh bakery",
  "17": "Deli, ready meals and produce",
  "18": "Meat and fish",
  "20": "Kitchen equipment",
  "21": "Dry goods",
  "22": "Seasonings, coffee and drinks",
  "30": "Household",
  "32": "Household",
  "41": "Frozen",
  "52": "Confectionery",
  "63": "Cleaning and hygiene",
  "64": "Disposables and table setting",
  "67": "Seasonal",
  "77": "Gases",
  "84": "Alcoholic drinks",
  "85": "Low and non-alcoholic drinks",
  "90": "Office and packaging",
};
const file = path.join(process.cwd(), "src", "server", "catalog-categories.json");
writeFileSync(file, `${JSON.stringify({ generated: "pnpm categories:build", departments: DEPARTMENTS, categories: out }, null, 1)}\n`);
console.log(`${Object.keys(out).length} categories -> ${file}`);
