import type { FindRequest } from "@/core/catalog/finder";
import type { Detailed } from "./finder";

/**
 * One telemetry event per smart search (kind `search.done`), through the same action stream as the gate's events
 * (Kafka, or PostgreSQL directly, into telemetry.events). Counts, codes and milliseconds only: never the buyer's
 * words, a product's name or an address. `attrs.facts` is what the read-only view exposes (infra/copilot.sql).
 */
export type SearchFacts = {
  /** What kind of request: words (the search box, the thread), need (the request reader's item), recall (no judge wanted), within (an id list), code (a product code said outright). */
  request: "words" | "need" | "recall" | "within" | "code";
  /** Which recall backend gave the lists, and whether it was the fallback. */
  backend: string;
  fallback: boolean;
  path: "judge" | "ranked" | "lexical";
  candidates: number;
  exact: number;
  variant: number;
  standin: number;
  other: number;
  embed_ms: number | null;
  recall_ms: number | null;
  judge_ms: number | null;
  total_ms: number;
  cost_usd: number;
  not_sold: boolean;
  only_standins: boolean;
  unsure: boolean;
  /** The judge did not answer (late, refused, over the cap); null when it was not asked. */
  judge_missed: boolean | null;
};

export function searchFacts(req: Pick<FindRequest, "ids" | "noJudge" | "need">, r: Pick<Detailed, "path" | "reason" | "stats" | "candidates" | "notSold" | "onlyStandins" | "unsure">): SearchFacts {
  const count = { exact: 0, variant: 0, standin: 0, other: 0 };
  for (const c of r.candidates) if (c.verdict) count[c.verdict.label] += 1;
  const request: SearchFacts["request"] = r.reason === "a product code said outright" ? "code" : req.ids ? "within" : req.noJudge ? "recall" : req.need ? "need" : "words";
  const judgeAsked = r.path === "judge" || !!r.reason?.startsWith("judge ");
  return {
    request,
    backend: r.stats.recallBackend ?? "memory",
    fallback: !!r.stats.recallFallback,
    path: r.path,
    candidates: r.stats.candidates,
    ...count,
    embed_ms: r.stats.embedMs ?? null,
    recall_ms: r.stats.recallMs ?? null,
    judge_ms: r.stats.judgeMs ?? null,
    total_ms: r.stats.ms,
    cost_usd: r.stats.costUsd ?? 0,
    not_sold: r.notSold,
    only_standins: r.onlyStandins,
    unsure: r.unsure,
    judge_missed: judgeAsked ? r.path !== "judge" : null,
  };
}

/** Into the action stream, attributed to the conversation's agent when the search ran inside a turn. Never throws. */
export function emitSearchEvent(req: FindRequest, r: Detailed): void {
  const facts = searchFacts(req, r);
  void (async () => {
    const [{ currentTurn }, { getRuntime }, { actionEvent }] = await Promise.all([import("@/server/thread/context"), import("@/server/runtime"), import("@/server/aiven/actions")]);
    const turn = currentTurn();
    const rt = await getRuntime();
    rt.aiven.actions.emit(
      actionEvent({
        kind: "search.done",
        ...(turn ? { agentId: turn.agentId, orgId: turn.orgId } : {}),
        rule: facts.backend,
        value: facts.total_ms,
        ok: !facts.fallback && facts.judge_missed !== true,
        summary: `Search (${facts.request}): ${facts.candidates} candidates from ${facts.backend}${facts.fallback ? " (fallback)" : ""}, ${facts.path}, ${facts.total_ms} ms.`,
        attrs: { facts, ...(turn ? { turnId: turn.turnId, threadId: turn.threadId } : {}) },
      }),
    );
  })().catch(() => undefined);
}
