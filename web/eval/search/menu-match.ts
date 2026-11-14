/**
 * The menu planner's ingredient matching, before and after smart search, on the planner's own cases: the recorded
 * drafts (eval/recorded, no drafting model call), the real catalogue, no live price call.
 *
 *   pnpm tsx eval/search/menu-match.ts            every recorded case
 *   pnpm tsx eval/search/menu-match.ts --case salmon-soup
 *
 * Before: today's path, term-by-term keyword search (findCandidates without smart search), then the model's name
 * check (pick.ts, Claude Opus 5.5 at low effort), all ingredients of the menu in parallel, as service.ts runs it.
 * After: one smart search per ingredient (recall + the Decisions judge), all in parallel; no name check.
 * Quality: Claude Opus 5.5 grades, blind and in one call per menu, whether each line's first product is the ingredient
 * for its role. Prints ids, counts, times and cost only.
 */
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Product } from "@/core/catalog";
import { createModel } from "@/server/agent/models";
import { costOf, priceOf, tokensFromUsage } from "@/server/agent/pricing";
import { sanitiseDraft, type DraftIngredient } from "@/server/agent/menu/draft";
import { RECORDINGS } from "@/server/agent/menu/eval/recorded";
import { findCandidates, menuCatalogOf, type CandidateSet } from "@/server/agent/menu/match";
import { pickProducts } from "@/server/agent/menu/pick";
import { menuKitchen } from "@/server/agent/menu/runtime";
import { loadLocalEnv } from "../../scripts/lib/env";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadLocalEnv();
  const { smartSearchFor } = await import("@/server/search/service");
  let spent = 0;
  const totals = { before: { ms: [] as number[], ok: 0, n: 0, usd: 0 }, after: { ms: [] as number[], ok: 0, n: 0, usd: 0 } };
  for (const rec of RECORDINGS.filter((r) => !arg("case") || r.id === arg("case"))) {
    const { rt, kitchen } = await menuKitchen(rec.kitchen);
    if (!kitchen || rt.catalogSource.kind !== "valio") throw new Error("needs the partner catalogue (VALIO_API_KEY and the index)");
    await smartSearchFor(rt.catalog); // built before timing, as the server builds it at boot
    const draft = sanitiseDraft(rec.raw);
    const ings = new Map<string, DraftIngredient & { dish: string }>();
    for (const d of draft.dishes) for (const i of d.ingredients) if (!i.pantry && !ings.has(i.key)) ings.set(i.key, { ...i, dish: d.name });
    const list = [...ings.values()];
    if (!list.length) continue;
    const allowed = new Set(kitchen.mandate.allowedCategories);
    const ok = (p: Product) => allowed.has(p.category);
    const full = menuCatalogOf(rt.catalog);
    const plain = { ...full, find: undefined };

    // Before: keyword search per term, then the model's name check, everything in parallel. --after-only skips it
    // (and its Opus calls), to measure a change to smart search without paying for the old path again.
    const afterOnly = process.argv.includes("--after-only");
    let t0 = performance.now();
    const beforeSets: CandidateSet[] = afterOnly ? list.map(() => ({ candidates: [], rejected: [], searched: [] })) : await Promise.all(list.map((i) => findCandidates(plain, i, kitchen.diet, ok, 8)));
    let pickUsd = 0;
    if (!afterOnly) await Promise.all(
      list.map(async (ing, k) => {
        const set = beforeSets[k];
        if (!set.candidates.length) return;
        try {
          const r = await pickProducts([{ lineId: ing.key, ingredient: ing.name, role: `${ing.role} in ${ing.dish}`, form: ing.form, candidates: set.candidates.map((c) => ({ id: c.product.id, name: [c.product.names?.en, c.product.names?.fi].filter(Boolean).join(" / ") || c.product.name })) }]);
          pickUsd += r.costUsd ?? 0;
          const fits = r.pick.lines[0]?.fits ?? [];
          set.candidates = fits.map((id) => set.candidates.find((c) => c.product.id === id)!).filter(Boolean);
        } catch {
          // as service.ts: the code's ranking stands
        }
      }),
    );
    const beforeMs = performance.now() - t0;
    // After: one smart search per ingredient, in parallel.
    t0 = performance.now();
    const afterSets = await Promise.all(list.map((i) => findCandidates(full, i, kitchen.diet, ok, 8)));
    const afterMs = performance.now() - t0;
    const judged = afterSets.filter((s) => s.judged).length;

    // Blind grading by Opus: each line's first product, both methods mixed, one call.
    const items: { key: string; method: "before" | "after"; text: string }[] = [];
    list.forEach((ing, k) => {
      for (const [method, set] of (afterOnly ? [["after", afterSets[k]]] : [["before", beforeSets[k]], ["after", afterSets[k]]]) as [("before" | "after"), CandidateSet][]) {
        const p = set.candidates[0]?.product;
        items.push({ key: ing.key, method, text: `${ing.name} (${ing.form}; ${ing.role} in ${ing.dish}) -> ${p ? [p.names?.en, p.names?.fi].filter(Boolean).join(" / ") || p.name : "NOTHING FOUND"}` });
      }
    });
    const order = items.map((_, i) => i).sort((a, b) => ((a * 7919) % items.length) - ((b * 7919) % items.length) || a - b);
    const { model } = createModel("anthropic:claude-opus-5-5");
    const schema = z.object({ grades: z.array(z.object({ n: z.number().int(), ok: z.boolean() })) });
    const g = await generateText({
      model,
      output: Output.object({ schema }),
      prompt: `A professional kitchen buys each ingredient below from a wholesaler. For each numbered line, say whether the product after the arrow is that ingredient, in a form a cook would use for the stated role (ok: true), or not (ok: false). "NOTHING FOUND" is not ok.\n\n${order.map((i, n) => `${n + 1}. ${items[i].text}`).join("\n")}`,
      providerOptions: { anthropic: { effort: "low" } },
    });
    const gradeUsd = costOf(tokensFromUsage(g.usage), priceOf("anthropic:claude-opus-5-5")) ?? 0;
    spent += gradeUsd + pickUsd;
    const grades = (g.output as z.infer<typeof schema>).grades;
    const okBy = { before: 0, after: 0 };
    for (const x of grades) {
      const it = items[order[x.n - 1]];
      if (it && x.ok) okBy[it.method]++;
    }
    if (process.argv.includes("--verbose")) for (const x of grades) console.log(`   ${x.ok ? "ok " : "BAD"} ${items[order[x.n - 1]]?.method} ${items[order[x.n - 1]]?.text}`);
    const afterUsd = afterSets.length * 0.0006; // judge plus embedding per ingredient, from the search evaluation
    console.log(`${rec.id.padEnd(22)} ${String(list.length).padStart(2)} lines | before ${(beforeMs / 1000).toFixed(1)} s, right ${okBy.before}/${list.length}, name check $${pickUsd.toFixed(3)} | after ${(afterMs / 1000).toFixed(1)} s, right ${okBy.after}/${list.length}, judged ${judged}/${list.length}, about $${afterUsd.toFixed(3)}`);
    totals.before.ms.push(beforeMs);
    totals.after.ms.push(afterMs);
    totals.before.ok += okBy.before;
    totals.after.ok += okBy.after;
    totals.before.n += list.length;
    totals.after.n += list.length;
    totals.before.usd += pickUsd;
    totals.after.usd += afterUsd;
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] / 1000;
  console.log(`\nbefore: right ${totals.before.ok}/${totals.before.n}, median ${med(totals.before.ms).toFixed(1)} s per menu, $${totals.before.usd.toFixed(3)}`);
  console.log(`after:  right ${totals.after.ok}/${totals.after.n}, median ${med(totals.after.ms).toFixed(1)} s per menu, about $${totals.after.usd.toFixed(3)}`);
  console.log(`grading and name checks spent $${spent.toFixed(3)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
