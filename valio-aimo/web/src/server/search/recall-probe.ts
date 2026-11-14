import type { IndexedProduct } from "@/core/catalog/partner";
import type { Candidate, SearchIndex, Understood } from "./recall";
import type { ListsSource } from "./recall-router";

/**
 * "Time both search backends": the same queries through memory recall and through OpenSearch recall, inside the
 * server that would serve them, without changing which one is in force. Each query is embedded once and the vector
 * reused for both; no judge. Three warm-up calls each first, then the order alternates per query. OpenSearch is
 * given time to answer (so its real time is measured) and counted as timed out when it took longer than the
 * router's deadline.
 */

/** About 30 requests from the evaluation set (eval/search/cases.ts), every sixth: English, Finnish, Swedish, mixed. */
export const PROBE_QUERIES = [
  "lactose-free milk",
  "jasmine rice",
  "smoked salmon slices",
  "lactose-free semi-skimmed milk in a 10 litre box, not the 1 l cartons",
  "spagetti",
  "hampurilaissämpylät",
  "nakkeja",
  "Elovena kaurajuoma barista",
  "rapsolja",
  "what we need for the beetroot salad",
  "cream for carbonara",
  "coconut milk for the curry",
  "eggs for omelettes for 80 people",
  "tilliä lohikeittoon",
  "perunoita muusiin",
  "dill till laxen",
  "something for the dishwasher",
  "something to thicken the sauce",
  "plant-based mince for tacos",
  "bread without gluten",
  "stock for a fish soup",
  "kangaroo fillet",
  "kaurajuomaa kahviin",
  "hiivaa pullataikinaan",
  "kasvisjauheliha tacoihin",
  "kalkkunan jauhelihaa",
  "sopsäckar",
  "engångshandskar",
  "strutsfilé",
  "gul lök till skolköket, nötfritt",
] as const;

export type ProbeDeps = {
  index: SearchIndex;
  remote: ListsSource;
  embed: (text: string) => Promise<{ vector: Float32Array; ms: number }>;
  recallSize: number;
  deadlineMs: number;
  /** The judge's typical time here (median of recent searches), for the implied end-to-end time. */
  judgeMs: { value: number; from: string };
  now?: () => number;
};

export type BackendTimes = { p50: number; p90: number; max: number; candidates: { p50: number; min: number }; timedOut: number; failed: number };
export type ProbeResult = {
  at: string;
  queries: number;
  deadlineMs: number;
  memory: BackendTimes;
  opensearch: BackendTimes;
  /** Mean share of memory's candidates that OpenSearch's list also has. */
  overlap: number;
  embed: { p50: number; p90: number };
  /** Embedding + recall + the judge's typical time, per backend. */
  endToEnd: { memory: { p50: number; p90: number }; opensearch: { p50: number; p90: number }; judgeMs: number; judgeFrom: string };
  reading: string;
};

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] * 10) / 10;
};

const times = (ms: number[], sizes: number[], timedOut: number, failed: number): BackendTimes => ({
  p50: pct(ms, 0.5),
  p90: pct(ms, 0.9),
  max: ms.length ? Math.round(Math.max(...ms) * 10) / 10 : 0,
  candidates: { p50: pct(sizes, 0.5), min: sizes.length ? Math.min(...sizes) : 0 },
  timedOut,
  failed,
});

export async function probeRecall(deps: ProbeDeps, queries: readonly string[] = PROBE_QUERIES): Promise<ProbeResult> {
  const now = deps.now ?? (() => performance.now());
  const ix = deps.index;
  const prep = async (text: string) => {
    const u: Understood = ix.understand(text);
    const filter: (p: IndexedProduct) => boolean = ix.hardFilter(u);
    const e = await deps.embed(text);
    return { u, opts: { size: deps.recallSize, filter, queryVector: e.vector }, embedMs: e.ms };
  };
  const memory = (q: Awaited<ReturnType<typeof prep>>): { ms: number; c: Candidate[] } => {
    const t0 = now();
    const c = ix.recall(q.u, q.opts);
    return { ms: now() - t0, c };
  };
  const remote = async (q: Awaited<ReturnType<typeof prep>>): Promise<{ ms: number; c: Candidate[] }> => {
    const t0 = now();
    const lists = await deps.remote.lists(q.u, ix.recallPlan(q.u, q.opts), { queryVector: q.opts.queryVector });
    const c = ix.recall(q.u, q.opts, lists);
    return { ms: now() - t0, c };
  };
  // Warm-up: the connection, the HNSW graph, the JIT. Not counted.
  const warm = await prep(queries[0]);
  for (let i = 0; i < 3; i++) {
    memory(warm);
    await remote(warm).catch(() => undefined);
  }
  const mem: number[] = [];
  const os: number[] = [];
  const memSizes: number[] = [];
  const osSizes: number[] = [];
  const embeds: number[] = [];
  const overlaps: number[] = [];
  const e2eMem: number[] = [];
  const e2eOs: number[] = [];
  let timedOut = 0;
  let failed = 0;
  for (let i = 0; i < queries.length; i++) {
    const q = await prep(queries[i]);
    embeds.push(q.embedMs);
    let m: { ms: number; c: Candidate[] } | undefined;
    let o: { ms: number; c: Candidate[] } | undefined;
    const runOs = async () => {
      try {
        o = await remote(q);
      } catch {
        failed++;
      }
    };
    if (i % 2 === 0) {
      m = memory(q);
      await runOs();
    } else {
      await runOs();
      m = memory(q);
    }
    mem.push(m.ms);
    memSizes.push(m.c.length);
    e2eMem.push(q.embedMs + m.ms + deps.judgeMs.value);
    if (o) {
      os.push(o.ms);
      osSizes.push(o.c.length);
      if (o.ms > deps.deadlineMs) timedOut++;
      e2eOs.push(q.embedMs + o.ms + deps.judgeMs.value);
      const a = new Set(m.c.map((x) => x.id));
      overlaps.push(a.size ? o.c.filter((x) => a.has(x.id)).length / a.size : 1);
    }
  }
  const memory_ = times(mem, memSizes, 0, 0);
  const os_ = times(os, osSizes, timedOut, failed);
  const diff = Math.round(os_.p50 - memory_.p50);
  const reading = !os.length
    ? `OpenSearch recall did not answer any of the ${queries.length} queries here.`
    : `OpenSearch recall is ${Math.abs(diff)} ms ${diff >= 0 ? "slower" : "faster"} at p50 here (${os_.p50} against ${memory_.p50} ms; p90 ${os_.p90} against ${memory_.p90} ms)${timedOut ? `, ${timedOut} of ${os.length} over the ${deps.deadlineMs} ms deadline` : ""}${failed ? `, ${failed} failed` : ""}.`;
  return {
    at: new Date().toISOString(),
    queries: queries.length,
    deadlineMs: deps.deadlineMs,
    memory: memory_,
    opensearch: os_,
    overlap: overlaps.length ? Math.round((overlaps.reduce((a, b) => a + b, 0) / overlaps.length) * 1000) / 1000 : 0,
    embed: { p50: pct(embeds, 0.5), p90: pct(embeds, 0.9) },
    endToEnd: { memory: { p50: pct(e2eMem, 0.5), p90: pct(e2eMem, 0.9) }, opensearch: { p50: pct(e2eOs, 0.5), p90: pct(e2eOs, 0.9) }, judgeMs: deps.judgeMs.value, judgeFrom: deps.judgeMs.from },
    reading,
  };
}
