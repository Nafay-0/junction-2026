import { NeedSchema, type StructuredNeed } from "@/core/need";
import type { PublicOrder } from "@/core/orders";
import { consoleKitchen } from "@/server/authz";
import { orderForModel } from "@/server/channels/say";
import { calls } from "@/server/channels/voice/calls";
import type { ToolBody, ToolReply } from "@/server/channels/voice/tools";
import { getRuntime } from "@/server/runtime";
import { cardId, gateCard, orderCard, priceCard, understoodCard } from "./cards";
import { doorLine, doorTurn } from "./engine";
import { afterStep, record } from "./pipeline";
import type { NoticeCard } from "./types";

/**
 * The voice call as a door of the kitchen's one conversation. The call keeps its own realtime model, its recogniser
 * primed with the kitchen's words and its spoken read-back (server/channels/voice/); every step it takes is also a
 * turn of the kitchen's thread: the caller's heard words are the buyer turn, the read-back is the "understood" card
 * with the read-back sentence as the agent's line, and the intake's answer is the same cards the typed store shows.
 *
 * And the engine's autonomy rule applies to speech too: when the intake's options come back for a routine request
 * (inside the mandate, no check raised, the kitchen's usual product ranked first), the order is placed alone here
 * and the voice model is told what was placed, instead of reading options out and asking again.
 *
 * Mirroring never breaks a call: any failure here returns the door's own reply unchanged.
 */

const MIRRORED = new Set(["submit_request", "confirm_read_back", "respond_to_check", "answer_question", "choose_option", "place_order"]);

export async function mirrorVoiceTool(kitchen: string, body: Pick<ToolBody, "callId" | "name" | "heard" | "via" | "tapped">, reply: ToolReply, req?: Request): Promise<ToolReply> {
  if (!MIRRORED.has(body.name) || process.env.DOCK_THREAD_VOICE === "off") return reply;
  try {
    const rt = await getRuntime();
    const k = req ? await consoleKitchen(req, rt, kitchen) : undefined;
    const words = body.heard?.text?.trim() || undefined;
    return await doorTurn(k ?? kitchen, { door: "voice", via: body.tapped ? "tap" : body.via === "typed" ? "typed" : "speech", text: words, label: body.tapped ? body.name.replace(/_/g, " ") : undefined }, async (run) => {
      const s = reply.screen;
      if (s.problem) {
        const n: NoticeCard = { type: "notice", cardId: cardId("notice", run.turnId), kind: s.problem.code === "need_incomplete" ? "incomplete" : s.problem.code === "not_a_purchase_request" ? "not_purchase" : "refused", message: reply.forModel.say || s.problem.message };
        run.store.card(run.thread, run.turnId, n);
        return reply;
      }
      if (s.pending) {
        // The read-back: what was heard, before anything is looked up or priced; its sentence is the agent's line.
        const need = NeedSchema.safeParse(s.pending.need);
        if (need.success) run.store.card(run.thread, run.turnId, understoodCard({ ref: run.turnId, words: s.heard ?? words ?? "", need: need.data as StructuredNeed }));
        run.store.mark(run.thread, run.turnId, "understood", Date.now() - run.t0);
        run.facts.push(s.pending, { words });
        await doorLine(run, s.pending.say);
        return reply;
      }
      if (s.order) {
        run.orders.set(s.order.orderId, s.order);
        run.facts.push(s.order);
        run.store.card(run.thread, run.turnId, gateCard(s.order));
        run.store.card(run.thread, run.turnId, orderCard(s.order));
        return reply;
      }
      const step = s.step;
      if (!step) return reply;
      run.requests.add(step.requestId);
      if (body.name === "submit_request" || body.name === "confirm_read_back") {
        run.store.card(run.thread, run.turnId, { ...understoodCard({ ref: step.requestId, words: s.heard ?? words ?? step.need.text ?? "", need: step.need }), requestId: step.requestId, memoryUsed: step.memoryUsed.map((m) => m.text), memory: step.memoryUsed, ...(step.noticed?.length ? { notes: step.noticed.map((n) => ({ code: n.code, params: n.params })) } : {}) });
        run.store.mark(run.thread, run.turnId, "understood", Date.now() - run.t0);
      }
      if (step.state === "quoted") {
        // A choice made by voice: the price is fixed; placing it waits for the caller's yes (place_order).
        const p = priceCard(step);
        if (p) run.store.card(run.thread, run.turnId, p);
        return reply;
      }
      const out = await afterStep(run, step, words ?? "");
      if (!out.placed) return reply;
      // Placed alone by the engine's rule: the voice model says what was placed instead of reading options out.
      const order: PublicOrder = await rt.dock.getOrder(run.session, out.placed.orderId);
      const call = calls().get(body.callId);
      if (call) {
        call.desk.requestId = step.requestId;
        call.desk.orderId = order.orderId;
      }
      record(run, "voice_placed_alone", `The spoken request was routine: the engine placed ${order.orderId} alone, and the voice agent was told what was placed.`, { orderId: order.orderId, status: order.status }, step.requestId);
      const said = orderForModel(order);
      return { forModel: { ...said, say: `${said.say} (Placed by the agent alone: a routine order inside the kitchen's mandate, the product it usually buys.)` }, screen: { ...s, order, step: await rt.dock.intake.get(run.session, step.requestId) } };
    });
  } catch {
    return reply;
  }
}
