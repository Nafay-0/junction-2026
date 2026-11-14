import { DockError } from "@/core/errors";
import { opsRead } from "@/server/ops/handler";
import { AIVEN_BUYER } from "@/server/aiven/showcase/buyer";
import { getRun } from "@/server/aiven/showcase/launcher";
import { streamConfigured, tail, type StreamMessage } from "@/server/aiven/showcase/stream";

/**
 * GET /ops-api/platform/agent/{runId}: one run as it goes. `messages`: the agent's tool calls and Dock's answers as
 * Aiven's API reports them (redacted). `gate`: what the gate did meanwhile, live from the Kafka topic, filtered to
 * this agent since the run started; this is how staff watch it arrive while Aiven is still thinking. The run's own
 * `error` (why a recording plays, or why a run failed) is sent as `problem`: a top-level `error` is how every API
 * answer says it failed, and the page's fetch would read this 200 as one and never show the run.
 */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/platform/agent/[runId]">) {
  const { runId } = await ctx.params;
  return opsRead(req, async () => {
    const run = getRun(runId);
    if (!run) throw new DockError(404, "run_not_found", "No such run on this server (runs are kept in memory, the last 30).");
    let gate: StreamMessage[] = [];
    if (!run.recorded && streamConfigured()) {
      const since = Date.parse(run.startedAt) - 2_000;
      const until = run.endedAt ? Date.parse(run.endedAt) + 15_000 : Infinity;
      gate = (await tail().catch(() => ({ messages: [] as StreamMessage[] }))).messages.filter((m) => m.event.agentId === AIVEN_BUYER.agentId && Date.parse(m.timestamp) >= since && Date.parse(m.timestamp) <= until);
    }
    const { error, ...rest } = run;
    return Response.json({ ...rest, ...(error ? { problem: error } : {}), gate });
  });
}
