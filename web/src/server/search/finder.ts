import type { FindRequest, FindResult, FoundProduct, MatchLabel, ProductFinder } from "@/core/catalog/finder";
import type { IndexedProduct } from "@/core/catalog/partner";
import { toDockProduct } from "@/core/catalog/product";
import { judgeLine } from "./docs";
import { EMBED_USD_PER_M, GeminiError } from "./gemini";
import type { RelevanceJudge, Verdict } from "./judge";
import { ALL_SIGNALS, type Candidate, type SearchIndex, type Signals, type Understood } from "./recall";

/**
 * Smart search: wide recall by cheap means, the hard rules in code first, then one relevance judgement over the
 * survivors, with a deadline. The one function every caller uses (see service.ts): the intake's candidate search,
 * the thread's product results, the menu's ingredient matching, the catalogue's search box.
 *
 *   1. read the words (recall.ts understand): terms, claims (never fewer than asked, near-misses read as the claim),
 *      allergens, uses, product codes, a brand, a pack size
 *   2. the hard filter (claims, allergens, family, an id list) from product data, applied inside every recall source
 *   3. recall: lexical + typo + per-word + kinds + vectors + codes, fused (recall.ts)
 *   4. judge: one Decisions request; exact first, variants, then stand-ins (labelled), "not the kind" left out.
 *      Late, refused or over quota: the fused ranking stands and the result says so
 *   5. order: label, then the brand and pack size asked (code), then the judge's score, then the fused rank
 */

export type SmartConfig = {
  signals: Signals;
  judge: boolean;
  /** Candidates gathered for the judge (default 100). */
  recallSize: number;
  judgeTimeoutMs: number;
  embedTimeoutMs: number;
  /** Below this the judge's top answer is "unsure" (ask, or show a wider set). */
  unsureBelow: number;
};

export const DEFAULT_CONFIG: SmartConfig = { signals: ALL_SIGNALS, judge: true, recallSize: 100, judgeTimeoutMs: 800, embedTimeoutMs: 700, unsureBelow: 0.55 };

export type Embedder = (text: string, timeoutMs: number) => Promise<{ vector: Float32Array; tokens: number; cached: boolean }>;

/** One external call made by a search, for the daily caps and telemetry. */
export type SearchCall = { kind: "judge" | "embed"; model: string; ms: number; ok: boolean; tokens: number; costUsd: number; reason?: string };

export type SmartDeps = {
  index: SearchIndex;
  judge?: RelevanceJudge;
  embed?: Embedder;
  config?: Partial<SmartConfig>;
  /** Asked before each paid call; false skips it (switched off, over today's cap). */
  admit?: (kind: SearchCall["kind"]) => boolean;
  observe?: (call: SearchCall) => void;
  now?: () => number;
};

export type Detailed = FindResult & {
  /** Every candidate the judge saw (or would have), in fused order, with its verdict. For the evaluation and the trace. */
  candidates: { id: string; sources: string[]; verdict?: Verdict }[];
  understood: Understood;
};

/** Words around a product code that do not name a product ("product 464201", "do you still have 472997"). */
const CODE_WORDS = new Set("product products tuote tuotteen tuotetta tuotenumero produkt produkten artikel artikkeli code koodi nr no number numero still have you do onko viela teilla har ni kvar".split(" "));

const LABEL_RANK: Record<MatchLabel, number> = { exact: 3, variant: 2, standin: 1, other: 0 };
/** An "other" verdict at least this sure is left out of the results. */
const DROP_OTHER_AT = 0.6;

export class SmartSearch implements ProductFinder {
  readonly index: SearchIndex;
  private readonly deps: SmartDeps;
  readonly config: SmartConfig;
  private readonly cache = new Map<string, { at: number; p: Promise<Detailed> }>();

  constructor(deps: SmartDeps) {
    this.deps = deps;
    this.index = deps.index;
    this.config = { ...DEFAULT_CONFIG, ...(deps.config ?? {}), signals: { ...ALL_SIGNALS, ...(deps.config?.signals ?? {}) } };
  }

  find(req: FindRequest): Promise<FindResult> {
    return this.findDetailed(req);
  }

  /** Same answer for the same request within two minutes (the thread starts a search before the reader answers). */
  findDetailed(req: FindRequest, override?: Partial<SmartConfig>): Promise<Detailed> {
    const cfg: SmartConfig = { ...this.config, ...(override ?? {}), signals: { ...this.config.signals, ...(override?.signals ?? {}) } };
    if (req.noJudge) cfg.judge = false;
    if (req.noVectors) cfg.signals = { ...cfg.signals, vectors: false };
    const k = JSON.stringify([req.text, req.need?.itemText, req.requiredClaims, req.forbiddenAllergens, req.category, req.ids?.length ? req.ids.slice().sort().join(",") : "", req.limit, cfg]);
    const now = (this.deps.now ?? Date.now)();
    const hit = this.cache.get(k);
    if (hit && now - hit.at < 120_000) return hit.p;
    const p = this.run(req, cfg);
    this.cache.set(k, { at: now, p });
    p.catch(() => this.cache.delete(k));
    if (this.cache.size > 300) for (const key of [...this.cache.keys()].slice(0, 100)) this.cache.delete(key);
    return p;
  }

  private async run(req: FindRequest, cfg: SmartConfig): Promise<Detailed> {
    const t0 = performance.now();
    const ix = this.index;
    const u = ix.understand(req.text, { claims: req.requiredClaims, forbiddenAllergens: req.forbiddenAllergens, itemText: req.need?.itemText });
    const category = req.category ?? req.need?.category;
    const filter = ix.hardFilter(u, { ...(category ? { category } : {}), ...(req.ids ? { ids: req.ids } : {}) });
    const notes = [...u.notes];
    let tokens = 0;
    let costUsd = 0;
    let embedMs: number | undefined;

    // Semantic recall needs the query's embedding: one small call (cached per text), with its own deadline.
    let queryVector: Float32Array | undefined;
    // A product code said outright with hardly another word is a lookup: no embedding, no judge.
    const lookup = u.codes.length > 0 && u.terms.filter((t) => !CODE_WORDS.has(t)).length === 0;
    const wantVector = cfg.signals.vectors !== false && !!ix.vectors && !!this.deps.embed && !lookup && (this.deps.admit?.("embed") ?? true);
    if (wantVector) {
      const e0 = performance.now();
      try {
        const e = await this.deps.embed!(req.need?.itemText && req.need.itemText !== req.text ? `${req.text} (${req.need.itemText})` : req.text, cfg.embedTimeoutMs);
        queryVector = e.vector;
        embedMs = Math.round(performance.now() - e0);
        if (!e.cached) {
          const c = (e.tokens * EMBED_USD_PER_M) / 1e6;
          tokens += e.tokens;
          costUsd += c;
          this.deps.observe?.({ kind: "embed", model: "gemini-embedding-2", ms: embedMs, ok: true, tokens: e.tokens, costUsd: c });
        }
      } catch (err) {
        embedMs = Math.round(performance.now() - e0);
        this.deps.observe?.({ kind: "embed", model: "gemini-embedding-2", ms: embedMs, ok: false, tokens: 0, costUsd: 0, reason: reasonOf(err) });
      }
    }

    const candidates: Candidate[] = ix.recall(u, { size: cfg.recallSize, signals: cfg.signals, filter, ...(queryVector ? { queryVector } : {}), ...(category ? { category } : {}), ...(req.ids ? { ids: req.ids } : {}) });
    const products = new Map(candidates.map((c) => [c.id, ix.byId.get(c.id)!]));

    // The judge, with a deadline. Any failure leaves the fused ranking, and the result says which path answered.
    let verdicts: Map<string, Verdict> | undefined;
    let path: FindResult["path"] = "ranked";
    let reason: string | undefined;
    let judgeMs: number | undefined;
    if (lookup) reason = "a product code said outright";
    else if (!cfg.judge || !this.deps.judge) reason = "judge off";
    else if (!candidates.length) reason = "no candidates";
    else if (!(this.deps.admit?.("judge") ?? true)) reason = "judge over today's cap or switched off";
    else {
      const j0 = performance.now();
      try {
        const out = await this.deps.judge.judge(
          {
            text: req.text,
            ...(req.need?.itemText ? { itemText: req.need.itemText } : {}),
            enforced: [...u.claims.map((c) => c.replace(/_/g, "-")), ...u.forbiddenAllergens.map((a) => `no ${a}`)],
            candidates: candidates.map((c) => ({ id: c.id, line: judgeLine(products.get(c.id)!, ix.map) })),
          },
          cfg.judgeTimeoutMs,
        );
        verdicts = out.verdicts;
        judgeMs = out.ms;
        tokens += out.tokens;
        costUsd += out.costUsd;
        path = "judge";
        this.deps.observe?.({ kind: "judge", model: out.model, ms: out.ms, ok: true, tokens: out.tokens, costUsd: out.costUsd });
      } catch (err) {
        judgeMs = Math.round(performance.now() - j0);
        reason = `judge ${reasonOf(err)}`;
        this.deps.observe?.({ kind: "judge", model: this.deps.judge.name, ms: judgeMs, ok: false, tokens: 0, costUsd: 0, reason });
      }
    }

    // Order: matches (exact or variant), stand-ins, the rest. Among matches, the judge's score plus what the words asked
    // for that code can check (the brand, the pack size): a match in the brand and size asked comes first.
    const rank = new Map(candidates.map((c, i) => [c.id, i]));
    const said = new Set(u.codes);
    const fits = (p: IndexedProduct) => (said.has(p.id) ? 8 : 0) + (u.brand && ix.brandMatches(p, u.brand) ? 2 : 0) + (u.pack && ix.packMatches(p, u.pack) ? 1 : 0);
    let ordered: Candidate[];
    if (verdicts) {
      const v = verdicts;
      ordered = candidates
        .filter((c) => {
          const x = v.get(c.id);
          return !x || x.label !== "other" || x.confidence < DROP_OTHER_AT;
        })
        .sort((a, b) => {
          const va = v.get(a.id);
          const vb = v.get(b.id);
          const la = va ? LABEL_RANK[va.label] : 0;
          const lb = vb ? LABEL_RANK[vb.label] : 0;
          if (said.has(a.id) !== said.has(b.id)) return said.has(a.id) ? -1 : 1;
          const tier = (l: number) => (l >= 2 ? 2 : l);
          if (tier(la) !== tier(lb)) return tier(lb) - tier(la);
          const sa = (va?.score ?? 0) + 0.5 * fits(products.get(a.id)!);
          const sb = (vb?.score ?? 0) + 0.5 * fits(products.get(b.id)!);
          return sb - sa || lb - la || rank.get(a.id)! - rank.get(b.id)!;
        });
    } else {
      const boosted = candidates.map((c) => ({ c, s: c.score * (1 + 0.6 * fits(products.get(c.id)!)) }));
      ordered = boosted.sort((a, b) => b.s - a.s || rank.get(a.c.id)! - rank.get(b.c.id)!).map((x) => x.c);
    }

    const labels = verdicts ? ordered.map((c) => verdicts!.get(c.id)?.label) : [];
    const anyMatch = labels.some((l) => l === "exact" || l === "variant");
    const anyStandin = labels.some((l) => l === "standin");
    const notSold = !!verdicts && !anyMatch && !anyStandin;
    const onlyStandins = !!verdicts && !anyMatch && anyStandin;
    const top = verdicts && ordered[0] ? verdicts.get(ordered[0].id) : undefined;
    const unsure = !!top && (top.confidence < cfg.unsureBelow || top.label === "other");
    if (u.brand && !ordered.some((c) => ix.brandMatches(products.get(c.id)!, u.brand!))) notes.push(`nothing from ${u.brand} fits; other brands shown`);
    if (u.pack && !ordered.some((c) => ix.packMatches(products.get(c.id)!, u.pack!))) notes.push(`no ${u.pack.amount} ${u.pack.unit} pack fits; other sizes shown`);
    const shown = notSold ? [] : ordered.filter((c) => !verdicts || verdicts.get(c.id)?.label !== "other");
    const limit = Math.max(1, Math.min(req.limit ?? 24, 100));
    const hits: FoundProduct[] = shown.slice(0, limit).map((c) => {
      const v = said.has(c.id) ? { label: "exact" as const, confidence: 1 } : verdicts?.get(c.id);
      return { product: toDockProduct(products.get(c.id)!), ...(v ? { label: v.label, confidence: v.confidence } : {}), sources: c.sources };
    });
    return {
      hits,
      path,
      ...(reason ? { reason } : {}),
      notes,
      applied: { claims: u.claims, forbiddenAllergens: u.forbiddenAllergens, ...(u.brand ? { brand: u.brand } : {}), ...(u.pack ? { pack: u.pack } : {}) },
      onlyStandins,
      notSold,
      unsure,
      stats: { candidates: candidates.length, ms: Math.round(performance.now() - t0), ...(judgeMs !== undefined ? { judgeMs } : {}), ...(embedMs !== undefined ? { embedMs } : {}), tokens, costUsd: Math.round(costUsd * 1e6) / 1e6 },
      candidates: candidates.map((c) => ({ id: c.id, sources: c.sources, ...(verdicts?.get(c.id) ? { verdict: verdicts.get(c.id)! } : {}) })),
      understood: u,
    };
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof GeminiError) return err.code === "timeout" ? `late (${err.message})` : err.code === "quota" ? "over quota" : err.code === "refused" ? "refused" : err.message.slice(0, 120);
  return err instanceof Error ? err.message.slice(0, 120) : "failed";
}
