import { z } from "zod";
import { DockError, parse } from "@/core/errors";
import { consoleKitchen } from "@/server/authz";
import { kitchenAgent } from "@/server/channels/flow";
import { getRuntime } from "@/server/runtime";
import { heardTurn, nextSpoken, standing } from "@/server/thread/voice-bridge";
import { calls } from "@/server/channels/voice/calls";
import { createRealtimeCall } from "@/server/channels/voice/realtime";
import { handle, readJson } from "@/server/http";
import type { Violation } from "@/core/grounding";
import { recordGrounding } from "@/server/grounding";

/**
 * POST /ui-api/voice/{kitchen}/call/{callId}
 *   { op: "beat", usage?, grounding? }   the call screen is still there (every 10 s); frees the line when it stops
 *   { op: "end", reason }               hang up
 *   { op: "dropped", said, kinds }      the grounding check cut off something the agent said; written to the ledger
 *   { op: "heard", text, turn, ... }    the buyer said something (the live transcript): into the kitchen's conversation as
 *                                       a voice turn (thread/voice-bridge.ts heardTurn); answers what to say first
 *   { op: "next", agentTurnId }         what to say next about that turn: a milestone, the reply, a sign-off decided
 *                                       (waits up to 20 s for something new)
 *   { op: "standing" }                  where things stand, said after a reconnect
 *   { op: "rtc", sdp }                  OpenAI over WebRTC: the browser's offer, answered through this server, which
 *                                       keeps the call id and hangs the session up at the call's time limit
 */
const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("beat"),
    usage: z.object({ audioInSeconds: z.number().min(0), audioOutSeconds: z.number().min(0), promptTokens: z.number().min(0), responseTokens: z.number().min(0), costUsd: z.number().min(0).max(50).optional() }).optional(),
    grounding: z.object({ checked: z.number().int().min(0), dropped: z.number().int().min(0) }).optional(),
  }),
  z.object({ op: z.literal("end"), reason: z.string().max(80).default("hung up") }),
  z.object({ op: z.literal("dropped"), said: z.string().max(300), kinds: z.array(z.string().max(20)).max(10) }),
  z.object({ op: z.literal("heard"), text: z.string().max(2000), turn: z.number().int().positive(), modelWords: z.string().max(2000).optional(), overlap: z.boolean().optional(), duringAgent: z.boolean().optional(), lang: z.enum(["en", "fi", "sv"]).optional() }),
  z.object({ op: z.literal("next"), agentTurnId: z.string().min(1).max(80), waitMs: z.number().int().min(0).max(20_000).default(15_000) }),
  z.object({ op: z.literal("standing") }),
  z.object({ op: z.literal("rtc"), sdp: z.string().min(10).max(20_000) }),
]);

export async function POST(req: Request, ctx: RouteContext<"/ui-api/voice/[kitchen]/call/[callId]">) {
  return handle(async ({ dock }) => {
    const { kitchen, callId } = await ctx.params;
    const body = parse(Body, await readJson(req));
    const registry = calls();
    if (body.op === "end") {
      const c = registry.end(callId, kitchen, body.reason);
      return Response.json({ ended: !!c });
    }
    if (body.op === "rtc") {
      await kitchenAgent(kitchen, req); // the same access rule as starting the call
      const answer = await registry.connectRtc(callId, kitchen, body.sdp, (session, sdp) => createRealtimeCall(session as Parameters<typeof createRealtimeCall>[0], sdp));
      return Response.json({ sdp: answer }, { headers: { "cache-control": "no-store" } });
    }
    if (body.op === "heard" || body.op === "next" || body.op === "standing") {
      // The same access rule and the same person as the store's own thread route (portalRoute): the words are theirs.
      const k = await consoleKitchen(req, await getRuntime(), kitchen);
      if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
      const c = body.op === "heard" ? registry.use(callId, kitchen, "speech") : registry.heartbeat(callId, kitchen);
      const out = body.op === "heard" ? await heardTurn(k, c, body) : body.op === "next" ? await nextSpoken(k, c, body.agentTurnId, body.waitMs) : { say: await standing(k, c) };
      return Response.json(out, { headers: { "cache-control": "no-store" } });
    }
    const c = registry.heartbeat(callId, kitchen, body.op === "beat" ? { usage: body.usage, grounding: body.grounding } : undefined);
    if (body.op === "dropped") {
      c.grounding.dropped += 1;
      recordGrounding("voice", body.said.split(", ").map((said, i) => ({ kind: (body.kinds[i] ?? body.kinds[0] ?? "number") as Violation["kind"], said })), `call ${callId}`, false);
      dock.ledger.append({
        type: "agent",
        actor: "door:voice",
        summary: `The voice door cut off the voice model: it said ${body.said.slice(0, 120)}, which nothing the agent gave it in this call contained (${body.kinds.join(", ")}). It was told to take it back.`,
        data: { event: "grounding_check", step: "grounding_check", door: "voice", said: body.said, kinds: body.kinds, callId },
      });
    }
    return Response.json({ ok: true, expiresAt: new Date(c.expiresAt).toISOString() }, { headers: { "cache-control": "no-store" } });
  });
}
