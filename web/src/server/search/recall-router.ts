import type { IndexedProduct } from "@/core/catalog/partner";
import type { Candidate, ExternalLists, RecallPlan, SearchIndex, Signals, Understood } from "./recall";

/**
 * Where smart search's recall is answered: in this process's memory (the inverted index and the vectors loaded at
 * boot), or on OpenSearch (one `_msearch`: keyword lists and nearest vectors, server/aiven/search/opensearch-recall.ts).
 * Either way the code and kinds sources, the hard filter, the fusion and the quotas are the same code (recall.ts),
 * so the answer has the same shape whichever backend gave the lists.
 *
 * One setting picks the order, the other backend is the fallback:
 *
 *   DOCK_SEARCH_RECALL_BACKEND=memory       (default) memory first; OpenSearch answers when the vectors are not
 *                                           loaded yet or failed to load (the first searches after a deploy are
 *                                           already semantic), or memory recall fails. Without OPENSEARCH_URL, memory only
 *   DOCK_SEARCH_RECALL_BACKEND=opensearch   OpenSearch first, memory recall when it is slow, failing or its breaker is open
 *   DOCK_SEARCH_RECALL_TIMEOUT_MS           OpenSearch's deadline (default 400); late, the other backend answers
 *   DOCK_SEARCH_RECALL_INDEX                the index or alias (default dock-recall)
 *
 * The breaker: 3 OpenSearch failures in a row skip it for 30 s. The last resort, both failing: memory recall
 * without vectors, so a search still answers.
 */

export type RecallBackendName = "memory" | "opensearch";

export type RecallOpts = { size: number; signals?: Signals; filter: (p: IndexedProduct) => boolean; queryVector?: Float32Array; category?: string; ids?: string[] };

/** What the router needs from the OpenSearch side (OpenSearchRecall has it). */
export type ListsSource = { lists(u: Pick<Understood, "claims" | "forbiddenAllergens">, plan: RecallPlan, opts: { queryVector?: Float32Array; category?: string; ids?: string[] }): Promise<ExternalLists> };

export type RecallAnswer = { candidates: Candidate[]; backend: RecallBackendName | "memory-no-vectors"; ms: number; fallback?: string };

export type RecallRouterStats = {
  order: RecallBackendName[];
  answered: Record<RecallBackendName | "memory-no-vectors", number>;
  fallbacks: number;
  consecutiveFailures: number;
  breakerOpenUntil: number | null;
  lastError?: string;
  lastFallbackAt?: string;
  timeoutMs: number;
};

class Late extends Error {
  constructor(ms: number) {
    super(`no answer within ${ms} ms`);
    this.name = "Late";
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Late(ms)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const errText = (err: unknown) => {
  if (err instanceof Late) return err.message;
  const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
  const msg = err instanceof Error ? err.message : String(err);
  return `${status ? `HTTP ${status} ` : ""}${msg}`.replace(/\/\/[^@\s/]+@/g, "//***@").slice(0, 160);
};

export class RecallRouter {
  readonly order: RecallBackendName[];
  private readonly timeoutMs: number;
  private readonly threshold: number;
  private readonly breakerMs: number;
  private readonly now: () => number;
  private readonly answered: RecallRouterStats["answered"] = { memory: 0, opensearch: 0, "memory-no-vectors": 0 };
  private fallbacks = 0;
  private failures = 0;
  private openUntil = 0;
  private lastError?: string;
  private lastFallbackAt?: number;

  constructor(
    private readonly index: SearchIndex,
    private readonly remote: ListsSource | undefined,
    opts: { primary?: RecallBackendName; timeoutMs?: number; breakerThreshold?: number; breakerMs?: number; now?: () => number; onAnswer?: (a: RecallAnswer) => void } = {},
  ) {
    const primary = opts.primary ?? "memory";
    this.order = remote ? (primary === "opensearch" ? ["opensearch", "memory"] : ["memory", "opensearch"]) : ["memory"];
    this.timeoutMs = opts.timeoutMs ?? 400;
    this.threshold = opts.breakerThreshold ?? 3;
    this.breakerMs = opts.breakerMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.onAnswer = opts.onAnswer;
  }

  private readonly onAnswer?: (a: RecallAnswer) => void;

  /** Semantic recall is possible: the vectors are in memory, or OpenSearch could answer. */
  canSearchVectors(): boolean {
    return !!this.index.vectors || !!this.remote;
  }

  private async tryBackend(name: RecallBackendName, u: Understood, opts: RecallOpts): Promise<Candidate[]> {
    if (name === "memory") {
      // Memory recall without the vectors would be a different (keyword-only) answer: let OpenSearch answer instead.
      if (opts.queryVector && !this.index.vectors && this.remote) throw new Error("vectors not loaded in memory");
      const { queryVector, ...rest } = opts;
      return this.index.recall(u, this.index.vectors && queryVector ? opts : rest);
    }
    if (this.now() < this.openUntil) throw new Error("breaker open");
    try {
      const plan = this.index.recallPlan(u, opts);
      const lists = await withDeadline(this.remote!.lists(u, plan, { ...(opts.queryVector ? { queryVector: opts.queryVector } : {}), ...(opts.category ? { category: opts.category } : {}), ...(opts.ids ? { ids: opts.ids } : {}) }), this.timeoutMs);
      this.failures = 0;
      return this.index.recall(u, opts, lists);
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openUntil = this.now() + this.breakerMs;
      throw err;
    }
  }

  async recall(u: Understood, opts: RecallOpts): Promise<RecallAnswer> {
    const t0 = this.now();
    const reasons: string[] = [];
    for (const name of this.order) {
      try {
        const candidates = await this.tryBackend(name, u, opts);
        return this.done({ candidates, backend: name, ms: this.now() - t0, ...(reasons.length ? { fallback: reasons.join("; ") } : {}) });
      } catch (err) {
        const why = `${name}: ${errText(err)}`;
        reasons.push(why);
        this.lastError = why;
      }
    }
    const { queryVector: _drop, ...rest } = opts;
    void _drop;
    return this.done({ candidates: this.index.recall(u, rest), backend: "memory-no-vectors", ms: this.now() - t0, fallback: reasons.join("; ") });
  }

  private done(a: RecallAnswer): RecallAnswer {
    this.answered[a.backend] += 1;
    if (a.fallback) {
      this.fallbacks += 1;
      this.lastFallbackAt = this.now();
    }
    this.onAnswer?.(a);
    return a;
  }

  stats(): RecallRouterStats {
    return {
      order: [...this.order],
      answered: { ...this.answered },
      fallbacks: this.fallbacks,
      consecutiveFailures: this.failures,
      breakerOpenUntil: this.openUntil > this.now() ? this.openUntil : null,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastFallbackAt ? { lastFallbackAt: new Date(this.lastFallbackAt).toISOString() } : {}),
      timeoutMs: this.timeoutMs,
    };
  }
}
