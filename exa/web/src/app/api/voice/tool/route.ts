import { asSchema } from "ai";
import { RunMeter } from "@/lib/agent/meter";
import { getModel } from "@/lib/agent/models";
import { languageModel, workerModelFor } from "@/lib/agent/providers";
import { createTools } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";
import { requireUser } from "@/lib/auth/server";
import { clientKindOf } from "@/lib/client-kind";
import { conversationOrigin, validConversationId } from "@/lib/db/conversations";
import { readOnlyReason } from "@/lib/db/origin";
import { recordUsage } from "@/lib/db/usage";
import { LIVE_MODEL, type VoiceToolEvent } from "@/lib/voice/models";
import { runsOnServer, spokenToolResult } from "@/lib/voice/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ToolRequest = {
  name?: string;
  input?: unknown;
  toolCallId?: string;
  conversationId?: string;
  modelId?: string;
  country?: string;
  timeZone?: string;
  coords?: { lat: number; lng: number; label?: string; country?: string };
};

/**
 * Run one of the agent's tools for a voice call. In a typed conversation the server runs the
 * tools inside the agent's own loop; in a call the agent is Gemini's live model, talking to the
 * interface directly, so the interface brings each tool call here. Same tools, same results: the
 * widget's payload goes back for the screen, and the text the model reads goes back for the call.
 *
 * Answers as lines of JSON: what there is so far while the tool works, then the result.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as ToolRequest;
  const client = clientKindOf(req);
  const name = typeof body.name === "string" ? body.name : "";
  const toolCallId = typeof body.toolCallId === "string" && body.toolCallId ? body.toolCallId.slice(0, 120) : crypto.randomUUID();

  const conversationId = validConversationId(body.conversationId) ? body.conversationId : undefined;
  if (conversationId) {
    const origin = await conversationOrigin(user.id, conversationId);
    if (origin && origin !== client) return Response.json({ error: readOnlyReason(origin) }, { status: 409 });
  }

  const info = getModel(body.modelId);
  const meter = new RunMeter();
  let model;
  let worker;
  try {
    model = languageModel(info);
    worker = workerModelFor(info);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "The model is not configured." }, { status: 500 });
  }
  const timeZone = safeTimeZone(body.timeZone);
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const coords = body.coords && Number.isFinite(body.coords.lat) && Number.isFinite(body.coords.lng) ? { lat: body.coords.lat, lng: body.coords.lng, label: typeof body.coords.label === "string" ? body.coords.label.slice(0, 80) : undefined } : undefined;
  const countryCode = body.coords?.country ?? body.country ?? "";
  const ctx: ToolContext = { meter, model: info, worker, country: /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : undefined, today, coords, client };
  const tools = createTools(ctx, model);
  if (!runsOnServer(tools, name)) return Response.json({ error: "There is no such tool to run here." }, { status: 400 });

  const tool = tools[name] as unknown as { inputSchema: Parameters<typeof asSchema>[0]; execute: (input: unknown, options: { toolCallId: string; messages: []; abortSignal: AbortSignal }) => unknown; toModelOutput?: (options: never) => unknown };
  const checked = await asSchema(tool.inputSchema).validate?.(body.input ?? {});
  if (checked && !checked.success) return Response.json({ error: `The tool was asked in a way it does not understand: ${checked.error.message.slice(0, 300)}` }, { status: 400 });
  const input = checked?.success ? checked.value : (body.input ?? {});

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const say = (event: VoiceToolEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const running = tool.execute(input, { toolCallId, messages: [], abortSignal: req.signal });
        let output: unknown;
        if (running && typeof running === "object" && Symbol.asyncIterator in running) {
          // A tool that reports as it goes: every value but the last is progress, the last is the result.
          let seen = false;
          for await (const value of running as AsyncIterable<unknown>) {
            if (seen) say({ type: "progress", output });
            output = value;
            seen = true;
          }
        } else output = await running;
        const { exaCostUsd, workerCostUsd, exaCalls } = meter.snapshot();
        say({ type: "result", output, text: await spokenToolResult(name, tool, toolCallId, input, output), spent: { exaCostUsd, workerCostUsd, exaCalls } });
      } catch (err) {
        say({ type: "error", error: err instanceof Error && err.name !== "AbortError" ? err.message.slice(0, 300) : "The tool was stopped." });
      } finally {
        // What the tool itself spent (Exa, sub-agents) is counted against the account. The call's own tokens are reported when it ends.
        void recordUsage({ userId: user.id, conversationId, client, stats: { modelId: LIVE_MODEL.id, modelLabel: LIVE_MODEL.label, startedAt, durationMs: Date.now() - startedAt, steps: 1, ...meter.snapshot() } });
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

function safeTimeZone(tz: string | undefined): string {
  if (!tz) return "Europe/Helsinki";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Helsinki";
  }
}
