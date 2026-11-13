/**
 * Evaluate the knowledge map.
 *
 *   pnpm knowledge:eval                       the built map (.data/valio/knowledge-map.json.gz)
 *   pnpm knowledge:eval --map <file>          another map (a pilot)
 *
 * 1. The partner's own substitutions (the `substitutions` field of 196 products) are held out: they are never used
 *    for ranking. For each such product we ask the map for alternatives in its primary use and check where the
 *    partner's substitute lands: top 1 / top 3 of the substitutes, a pack alternative, refused by the hard facts
 *    (and which fact), dropped under the confidence threshold, or not related for that use.
 * 2. Hand-written hard cases (cream types, lactose-free vs low-lactose, plant drinks, melting vs slicing cheese,
 *    gluten-free flour, fresh vs frozen, free-text roles): anchors are chosen by rule from the data, expectations are
 *    checked on every served relation.
 * 3. Coverage: the share of products for which the map deliberately returns no substitute, tiers, and a sample of
 *    relations the threshold dropped.
 *
 * Prints ids and counts only. The detailed report, which names products, goes to .data/valio/knowledge-eval.json
 * (git-ignored: it is partner text).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IndexedProduct } from "@/core/catalog/partner";
import { hardCheck } from "@/server/knowledge/facts";
import { KnowledgeMap, SERVE_THRESHOLD, type AlternativesResult } from "@/server/knowledge/map";
import { defaultKnowledgePath, loadKnowledgeFile } from "@/server/knowledge/store";
import type { Use } from "@/server/knowledge/vocab";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { loadLocalEnv } from "./lib/env";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "n/a");

type Outcome = "top1" | "top3" | "served_lower" | "other_pack_of_served" | "pack_alternative" | "hard_fact" | "below_threshold" | "blocked_property" | "not_related" | "not_profiled";

function partnerEval(map: KnowledgeMap, products: IndexedProduct[]) {
  const rows: { product: string; substitute: string; use: Use | null; outcome: Outcome; detail: string; ourTop: string[]; servedCount: number }[] = [];
  const perProduct: { product: string; anyTop1: boolean; anyTop3: boolean; served: boolean; empty: boolean }[] = [];
  for (const o of products) {
    const subs = o.substitutes.filter((s) => s !== o.id && map.fact(s));
    if (!subs.length) continue;
    const res = map.alternatives(o.id, { debug: true, max: 10, debugLimit: 100_000 });
    if (!res) continue;
    const top = res.substitutes.map((s) => s.productId);
    const flags = { anyTop1: false, anyTop3: false, served: false };
    for (const s of subs) {
      let outcome: Outcome;
      let detail = "";
      const idx = res.substitutes.findIndex((x) => x.productId === s);
      const inPacks = res.substitutes.findIndex((x) => x.otherPacks.includes(s));
      if (!map.profile(o.id)) outcome = "not_profiled";
      else if (idx === 0) outcome = "top1";
      else if (idx > 0 && idx < 3) outcome = "top3";
      else if (idx >= 3) outcome = "served_lower";
      else if (inPacks >= 0) outcome = inPacks < 3 ? "other_pack_of_served" : "served_lower";
      else if (res.packAlternatives.some((x) => x.productId === s)) outcome = "pack_alternative";
      else {
        const check = hardCheck(o, map.fact(s)!);
        const d = res.dropped?.find((x) => x.productId === s);
        if (!check.ok) (outcome = "hard_fact"), (detail = `${check.code}: ${check.reason}`);
        else if (d && d.confidence !== null) (outcome = "below_threshold"), (detail = d.why);
        else if (d) (outcome = "blocked_property"), (detail = d.why);
        else {
          outcome = "not_related";
          const a = map.profile(o.id);
          const b = map.profile(s);
          detail = b ? `kinds ${a?.kind} vs ${b.kind}; candidate uses ${b.uses.join(",")}` : "substitute has no profile";
        }
      }
      if (outcome === "top1" || outcome === "other_pack_of_served") flags.anyTop1 ||= outcome === "top1" || inPacks === 0;
      if (["top1", "top3", "other_pack_of_served"].includes(outcome)) flags.anyTop3 = true;
      if (["top1", "top3", "served_lower", "other_pack_of_served", "pack_alternative"].includes(outcome)) flags.served = true;
      rows.push({ product: o.id, substitute: s, use: res.use, outcome, detail, ourTop: top.slice(0, 3), servedCount: res.substitutes.length });
    }
    perProduct.push({ product: o.id, ...flags, empty: res.substitutes.length === 0 });
  }
  return { rows, perProduct };
}

// ---------- hard cases ----------

type Case = {
  name: string;
  /** Pick the anchor product: kind label pattern, required claims, optional extra test on the facts. */
  anchor: { kind: RegExp; claims?: string[]; notClaims?: string[]; frozen?: boolean; extra?: (p: IndexedProduct) => boolean };
  use?: Use;
  expect: string;
  check: (r: AlternativesResult, map: KnowledgeMap) => string[]; // problems
};

const claimsOf = (map: KnowledgeMap, id: string) => map.fact(id)?.claims ?? [];
const familyOf = (map: KnowledgeMap, id: string) => map.profile(id)?.family;
const served = (r: AlternativesResult) => [...r.substitutes, ...r.packAlternatives];

const CASES: Case[] = [
  {
    name: "lactose-free whipping cream, for whipping",
    anchor: { kind: /whipping cream/, claims: ["lactose_free"] },
    use: "whipping",
    expect: "every alternative whips (or is flagged unconfirmed) and is lactose-free by its data; no cooking cream",
    check: (r, m) =>
      served(r).flatMap((a) => [
        ...(m.profile(a.productId)?.whips === false ? [`${a.productId} does not whip`] : []),
        ...(!claimsOf(m, a.productId).includes("lactose_free") ? [`${a.productId} not lactose-free`] : []),
        ...(/cooking/.test(a.kindLabel) && !/whip/.test(a.kindLabel) ? [`${a.productId} is ${a.kindLabel}`] : []),
      ]),
  },
  {
    name: "cooking cream, for sauce",
    anchor: { kind: /cooking cream/, notClaims: ["lactose_free"] },
    use: "sauce",
    expect: "alternatives hold up when boiled; coffee cream that splits is not best",
    check: (r, m) => r.substitutes.filter((a) => m.profile(a.productId)?.heatStable === false && a.tier === "best").map((a) => `${a.productId} splits but ranked best`),
  },
  {
    name: "lactose-free milk, for drinking",
    anchor: { kind: /milk/, claims: ["lactose_free"], extra: (p) => p.categoryCode === "10400" },
    use: "drinking",
    expect: "every alternative is lactose-free by data; low-lactose-only products are refused",
    check: (r, m) => served(r).filter((a) => !claimsOf(m, a.productId).includes("lactose_free")).map((a) => `${a.productId} not lactose-free`),
  },
  {
    name: "low-lactose (not lactose-free) dairy product",
    anchor: { kind: /./, claims: ["low_lactose"], notClaims: ["lactose_free"], extra: (p) => ["10400", "10401", "10412", "10600", "10602"].includes(p.categoryCode) },
    expect: "lactose-free alternatives are allowed (stricter claim), alternatives without low-lactose are refused",
    check: (r, m) => served(r).filter((a) => !claimsOf(m, a.productId).includes("low_lactose")).map((a) => `${a.productId} not low-lactose`),
  },
  {
    name: "oat drink, for coffee",
    anchor: { kind: /oat/, extra: (p) => p.categoryCode === "10402" },
    use: "coffee",
    expect: "alternatives are plant drinks (or milk only if the oat drink declares milk); no new allergen",
    check: (r, m) => served(r).filter((a) => familyOf(m, a.productId) === "milk" && !m.fact(r.product.id)!.allergens.contains.includes("milk")).map((a) => `${a.productId} is dairy milk`),
  },
  {
    name: "shredded melting cheese, for pizza",
    anchor: { kind: /mozzarella|pizza/, extra: (p) => p.categoryCode === "10603" },
    use: "pizza",
    expect: "every alternative melts; hard grating cheese is not served for pizza",
    check: (r, m) => served(r).filter((a) => m.profile(a.productId)?.melts === false).map((a) => `${a.productId} does not melt`),
  },
  {
    name: "sliced cheese, for sandwiches",
    anchor: { kind: /slice/, extra: (p) => p.categoryCode === "10602" },
    use: "sandwich",
    expect: "the top substitute is also sliced",
    check: (r, m) => (r.substitutes[0] && m.profile(r.substitutes[0].productId)?.form !== "sliced" ? [`top ${r.substitutes[0].productId} is ${m.profile(r.substitutes[0].productId)?.form}`] : []),
  },
  {
    name: "gluten-free flour, for baking",
    anchor: { kind: /flour|mix/, claims: ["gluten_free"], extra: (p) => ["21300", "21310", "21320"].includes(p.categoryCode) },
    use: "baking",
    expect: "every alternative is gluten-free by data; no wheat flour",
    check: (r, m) => served(r).filter((a) => !claimsOf(m, a.productId).includes("gluten_free")).map((a) => `${a.productId} not gluten-free`),
  },
  {
    name: "fresh vegetable",
    anchor: { kind: /./, frozen: false, extra: (p) => ["17442", "17443", "17404"].includes(p.categoryCode) },
    expect: "a frozen alternative is never best and always carries the frozen condition",
    check: (r) => served(r).filter((a) => a.conditions.some((c) => c.code === "frozen") && a.tier === "best").map((a) => `${a.productId} frozen but best`),
  },
  {
    name: "frozen vegetable",
    anchor: { kind: /./, frozen: true, extra: (p) => p.categoryCode === "41731" },
    expect: "fresh alternatives carry the not-frozen condition",
    check: (r, m) => served(r).filter((a) => m.fact(a.productId)?.temperature.class !== "frozen" && !a.conditions.some((c) => c.code === "not_frozen")).map((a) => `${a.productId} fresh, no condition`),
  },
];

const ROLE_CASES: { q: string; claims?: string[]; expect: string; check: (r: ReturnType<KnowledgeMap["forRole"]>, m: KnowledgeMap) => string[] }[] = [
  { q: "cream for carbonara", expect: "cooking or whipping cream that holds up when boiled", check: (r, m) => r.products.filter((p) => m.profile(p.productId)?.heatStable === false).map((p) => `${p.productId} splits`).concat(r.products.length ? [] : ["nothing"]) },
  { q: "cream for whipping", claims: ["lactose_free"], expect: "lactose-free creams that whip", check: (r, m) => r.products.filter((p) => m.profile(p.productId)?.whips !== true || !claimsOf(m, p.productId).includes("lactose_free")).map((p) => `${p.productId} bad`).concat(r.products.length ? [] : ["nothing"]) },
  { q: "cheese for pizza", expect: "cheeses that melt", check: (r, m) => r.products.filter((p) => m.profile(p.productId)?.melts === false).map((p) => `${p.productId} no melt`).concat(r.products.length ? [] : ["nothing"]) },
  { q: "cheese for sandwich", expect: "sliceable or sliced cheese", check: (r) => (r.products.length ? [] : ["nothing"]) },
  { q: "flour for bread", claims: ["gluten_free"], expect: "gluten-free flours only", check: (r, m) => r.products.filter((p) => !claimsOf(m, p.productId).includes("gluten_free")).map((p) => `${p.productId} has gluten`).concat(r.products.length ? [] : ["nothing"]) },
  { q: "oat drink for coffee", expect: "plant drinks for coffee", check: (r, m) => r.products.filter((p) => m.profile(p.productId)?.family !== "plant_drink").map((p) => `${p.productId} not plant drink`).concat(r.products.length ? [] : ["nothing"]) },
  { q: "milk for porridge", claims: ["lactose_free"], expect: "lactose-free milks", check: (r, m) => r.products.filter((p) => !claimsOf(m, p.productId).includes("lactose_free")).map((p) => `${p.productId} not LF`).concat(r.products.length ? [] : ["nothing"]) },
];

function runCases(map: KnowledgeMap, products: IndexedProduct[]) {
  const out: { case: string; anchors: number; withSubs: number; top1ok: number; top3ok: number; top3n: number; problems: string[]; expect: string; sample: unknown[] }[] = [];
  for (const c of CASES) {
    const anchors = products
      .filter((p) => {
        const pr = map.profile(p.id);
        if (!pr || !c.anchor.kind.test(pr.kindLabel)) return false;
        if (c.anchor.claims?.some((x) => !p.claims.includes(x))) return false;
        if (c.anchor.notClaims?.some((x) => p.claims.includes(x))) return false;
        if (c.anchor.frozen !== undefined && (p.temperature.class === "frozen") !== c.anchor.frozen) return false;
        return c.anchor.extra ? c.anchor.extra(p) : true;
      });
    const step = Math.max(1, Math.floor(anchors.length / 15));
    const picked = anchors.filter((_, i) => i % step === 0).slice(0, 15);
    const problems: string[] = [];
    let withSubs = 0;
    let top1ok = 0;
    let top3ok = 0;
    let top3n = 0;
    const sample: unknown[] = [];
    for (const a of picked) {
      const r = map.alternatives(a.id, { use: c.use })!;
      if (r.substitutes.length) withSubs++;
      problems.push(...c.check(r, map).map((p) => `${a.id}: ${p}`));
      // Precision: judge each of the top substitutes on its own against the case's expectation.
      r.substitutes.slice(0, 3).forEach((s, i) => {
        const ok = c.check({ ...r, substitutes: [s], packAlternatives: [] }, map).length === 0;
        if (i === 0 && ok) top1ok++;
        top3n++;
        if (ok) top3ok++;
      });
      const nm = (id: string) => map.fact(id)?.names.en ?? map.fact(id)?.names.fi;
      sample.push({ anchor: a.id, anchorName: nm(a.id), use: r.use, subs: r.substitutes.slice(0, 3).map((s) => [s.productId, nm(s.productId), s.tier, s.confidence, s.reason]), packs: r.packAlternatives.length, none: r.none });
    }
    out.push({ case: c.name, anchors: picked.length, withSubs, top1ok, top3ok, top3n, problems, expect: c.expect, sample });
  }
  const roles: { q: string; uses: Use[]; kinds: string[]; products: number; problems: string[]; expect: string; top: unknown[] }[] = [];
  for (const rc of ROLE_CASES) {
    const r = map.forRole(rc.q, { constraints: { requiredClaims: rc.claims } });
    roles.push({ q: rc.q, uses: r.uses, kinds: r.kinds.map((k) => k.label), products: r.products.length, problems: rc.check(r, map), expect: rc.expect, top: r.products.slice(0, 4).map((p) => [p.productId, p.kindLabel, p.score]) });
  }
  return { cases: out, roles };
}

function main() {
  loadLocalEnv();
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index: run `pnpm index:build`.");
  const file = path.resolve(arg("map") ?? defaultKnowledgePath());
  const data = loadKnowledgeFile(file);
  const products = loaded.index.products;
  const map = new KnowledgeMap(products, data);
  console.log(`Map ${path.basename(file)}: ${map.size} profiled products, ${data.kinds.length} kinds, model ${data.stats.model}; serve threshold ${SERVE_THRESHOLD}`);

  // 1. partner substitutions
  const { rows, perProduct } = partnerEval(map, products);
  const counts = new Map<Outcome, number>();
  for (const r of rows) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const evaluable = perProduct.filter((p) => map.profile(p.product));
  const answered = evaluable.filter((p) => !p.empty);
  console.log(`\nPartner substitutions: ${rows.length} pairs over ${perProduct.length} products (${evaluable.length} profiled)`);
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)}  ${pctOf(v, rows.length)}`);
  console.log(`  products with a partner substitute at our top 1: ${pctOf(evaluable.filter((p) => p.anyTop1).length, evaluable.length)} of all, ${pctOf(answered.filter((p) => p.anyTop1).length, answered.length)} of those we answer (P@1)`);
  console.log(`  ... in our top 3:                               ${pctOf(evaluable.filter((p) => p.anyTop3).length, evaluable.length)} of all, ${pctOf(answered.filter((p) => p.anyTop3).length, answered.length)} of those we answer (P@3)`);
  console.log(`  ... served at all (substitute or pack):         ${pctOf(evaluable.filter((p) => p.served).length, evaluable.length)}`);
  console.log(`  partner products where we deliberately answer nothing: ${pctOf(evaluable.filter((p) => p.empty).length, evaluable.length)}`);

  // 2. hard cases
  const { cases, roles } = runCases(map, products);
  console.log(`\nHard cases (anchors chosen by rule; problems = expectation violated):`);
  for (const c of cases)
    console.log(
      `  ${c.problems.length ? "FAIL" : "ok  "} ${c.case}: ${c.anchors} anchors, ${c.withSubs} with substitutes, P@1 ${pctOf(c.top1ok, c.withSubs)}, P@3 ${pctOf(c.top3ok, c.top3n)}${c.problems.length ? `; ${c.problems.length} problems (${c.problems.slice(0, 2).join("; ")})` : ""}`,
    );
  const t = cases.reduce((a, c) => ({ w: a.w + c.withSubs, p1: a.p1 + c.top1ok, p3: a.p3 + c.top3ok, n3: a.n3 + c.top3n }), { w: 0, p1: 0, p3: 0, n3: 0 });
  console.log(`  all hard cases: P@1 ${pctOf(t.p1, t.w)}, P@3 ${pctOf(t.p3, t.n3)} (judged by data claims and the profile flags the case names)`);
  for (const r of roles) console.log(`  ${r.problems.length ? "FAIL" : "ok  "} role "${r.q}": uses ${r.uses.join(",")}; ${r.products} products; ${r.problems.length ? r.problems.slice(0, 3).join("; ") : "ok"}`);

  // 3. coverage over the whole map
  let empty = 0;
  let total = 0;
  const tiers = { best: 0, better: 0, good: 0 };
  let packs = 0;
  const droppedSample: unknown[] = [];
  const byFamily = new Map<string, { n: number; empty: number }>();
  for (const p of products) {
    const pr = map.profile(p.id);
    if (!pr) continue;
    total++;
    const r = map.alternatives(p.id, { debug: total % 97 === 0 })!;
    const f = byFamily.get(pr.family) ?? { n: 0, empty: 0 };
    f.n++;
    if (!r.substitutes.length) (empty++, f.empty++);
    byFamily.set(pr.family, f);
    for (const s of r.substitutes) tiers[s.tier]++;
    packs += r.packAlternatives.length;
    if (r.dropped && droppedSample.length < 60) {
      const d = r.dropped.find((x) => x.confidence !== null);
      if (d) droppedSample.push({ product: p.id, use: r.use, dropped: d.productId, confidence: d.confidence, why: d.why });
    }
  }
  console.log(`\nCoverage: ${total} profiled products; no substitute in the primary use for ${pctOf(empty, total)}; substitutes served ${tiers.best + tiers.better + tiers.good} (best ${tiers.best}, better ${tiers.better}, good ${tiers.good}); pack alternatives ${packs}`);
  const weak = [...byFamily.entries()].filter(([, v]) => v.n >= 30).sort((a, b) => b[1].empty / b[1].n - a[1].empty / a[1].n).slice(0, 8);
  console.log(`  families with the most empty answers: ${weak.map(([k, v]) => `${k} ${pctOf(v.empty, v.n)} of ${v.n}`).join(", ")}`);

  const out = path.join(process.cwd(), ".data", "valio", "knowledge-eval.json");
  mkdirSync(path.dirname(out), { recursive: true });
  const named = (id: string) => ({ id, name: map.fact(id)?.names.en ?? map.fact(id)?.names.fi, kind: map.profile(id)?.kindLabel, claims: map.fact(id)?.claims.filter((c) => !c.startsWith("fat_")) });
  writeFileSync(
    out,
    JSON.stringify(
      {
        map: path.basename(file),
        threshold: SERVE_THRESHOLD,
        partner: rows.map((r) => ({ ...r, productInfo: named(r.product), substituteInfo: named(r.substitute), ourTopInfo: r.ourTop.map(named) })),
        cases,
        roles,
        droppedSample: droppedSample.map((d) => ({ ...(d as object), productInfo: named((d as { product: string }).product), droppedInfo: named((d as { dropped: string }).dropped) })),
      },
      null,
      1,
    ),
  );
  console.log(`\nDetailed report (names partner products; git-ignored): ${path.relative(process.cwd(), out)}`);
}

main();
