/* eslint-disable @typescript-eslint/no-explicit-any -- QA harness: reads cached JSON readings. */
/**
 * Compare interpreter readings of the same corpus by two (or more) models: invariant problems by kind, refusals,
 * and latency (median, p90) per reading.
 *
 *   pnpm tsx qa/corpus/compare.ts qa/corpus/interpretations-haiku.json qa/corpus/interpretations-opus.json
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkReading } from "../probes/corpus";

const corpus = JSON.parse(readFileSync(path.join(process.cwd(), "qa", "corpus", "requests.json"), "utf8")).cases as any[];
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const rows: Record<string, any> = {};
const per: Record<string, Record<string, string[]>> = {};
for (const file of process.argv.slice(2)) {
  const cache = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  const model = Object.values(cache).find((r: any) => r.model)?.model ?? path.basename(file);
  const kinds: Record<string, number> = {};
  const ms: number[] = [];
  per[model] = {};
  let ok = 0;
  let refused = 0;
  for (const c of corpus) {
    const r = cache[c.id];
    if (!r) continue;
    if (r.status === 200) ok++;
    else refused++;
    if (typeof r.ms === "number") ms.push(r.ms);
    const probs = checkReading(c, r);
    per[model][c.id] = probs;
    for (const p of probs) kinds[p.split(":")[0]] = (kinds[p.split(":")[0]] ?? 0) + 1;
  }
  rows[model] = { needs: ok, refused, ...kinds, medianMs: q(ms, 0.5), p90Ms: q(ms, 0.9) };
}
console.table(rows);
const [a, b] = Object.keys(per);
if (a && b) {
  const only = (x: string, y: string) => Object.keys(per[x]).filter((id) => per[x][id].some((p) => !p.startsWith("date") && !p.startsWith("amount")) && !per[y][id]?.some((p) => !p.startsWith("date") && !p.startsWith("amount")));
  for (const [x, y] of [[a, b], [b, a]]) {
    const ids = only(x, y);
    console.log(`\nSafety-relevant problems only ${x} has (${ids.length}):`);
    for (const id of ids) console.log(`  ${id}: ${per[x][id].join("; ").slice(0, 160)}`);
  }
}
