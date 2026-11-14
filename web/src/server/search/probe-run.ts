import { DockError } from "@/core/errors";
import { actionEvent } from "@/server/aiven/actions";
import { recentEvents } from "@/server/aiven/recent-events";
import type { Runtime } from "@/server/runtime";
import { probeRecall, type ProbeResult } from "./recall-probe";
import { recallProbeParts, smartSearchFor } from "./service";

/**
 * The "Time both search backends" run behind /ops-api/platform/recall-probe: one at a time, at most one a minute on
 * this server, its result kept for the Platform page and written as one telemetry event (search.probe).
 */
export type ProbeRun = { result: ProbeResult; setting: string; by: string };

const g = globalThis as typeof globalThis & { __dockProbe?: { last?: ProbeRun; lastAt?: number; running?: boolean } };
const state = () => (g.__dockProbe ??= {});

/** The judge's median time over this server's recent searches; the evaluation's figure when there are none. */
function judgeTypical(): { value: number; from: string } {
  const ms = recentEvents()
    .filter((e) => e.kind === "search.done")
    .map((e) => (e.attrs as { facts?: { judge_ms?: number | null } } | undefined)?.facts?.judge_ms)
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  if (ms.length >= 5) return { value: ms[Math.floor(ms.length / 2)], from: `median of the last ${ms.length} judged searches here` };
  return { value: 350, from: "the evaluation's judge median (14 Nov); fewer than 5 judged searches here yet" };
}

export function lastProbe(): ProbeRun | undefined {
  return state().last;
}

export async function runProbe(rt: Runtime, by: string): Promise<ProbeRun> {
  const s = state();
  if (s.running) throw new DockError(409, "probe_running", "A timing run is already going on this server.");
  if (s.lastAt && Date.now() - s.lastAt < 60_000) throw new DockError(429, "rate_limited", `One timing run a minute; try again in ${Math.ceil((60_000 - (Date.now() - s.lastAt)) / 1000)} s.`);
  if (rt.catalogSource.kind === "valio") await smartSearchFor(rt.catalog).catch(() => null);
  const parts = recallProbeParts();
  if (!parts.ok) throw new DockError(409, "probe_unavailable", parts.reason);
  s.running = true;
  s.lastAt = Date.now();
  try {
    const result = await probeRecall({
      index: parts.index,
      remote: parts.remote,
      embed: async (text) => {
        const t0 = performance.now();
        const e = await parts.embed(text, 3_000);
        return { vector: e.vector, ms: Math.round(performance.now() - t0) };
      },
      recallSize: parts.recallSize,
      deadlineMs: parts.timeoutMs,
      judgeMs: judgeTypical(),
    });
    const setting = `DOCK_SEARCH_RECALL_BACKEND=${process.env.DOCK_SEARCH_RECALL_BACKEND?.trim() || "memory (default)"}: ${parts.order.join(" first, then ")}`;
    s.last = { result, setting, by };
    rt.aiven.actions.emit(
      actionEvent({
        kind: "search.probe",
        value: Math.round(result.opensearch.p50 - result.memory.p50),
        ok: result.opensearch.failed === 0,
        rule: parts.order[0],
        summary: result.reading,
        attrs: { facts: { queries: result.queries, memory_p50: result.memory.p50, memory_p90: result.memory.p90, opensearch_p50: result.opensearch.p50, opensearch_p90: result.opensearch.p90, timed_out: result.opensearch.timedOut, failed: result.opensearch.failed, overlap: result.overlap, deadline_ms: result.deadlineMs } },
      }),
    );
    return s.last;
  } finally {
    s.running = false;
  }
}
