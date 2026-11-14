import { z } from "zod";
import { DockError, parse } from "@/core/errors";
import type { IntakeView } from "@/core/intake";
import { describeNeed, formatAmount, NeedSchema, type NeedInput } from "@/core/need";
import type { PublicOrder } from "@/core/orders";
import { answer, asProblem, choose, getOrder, getStep, kitchenAgent, openNeed, place, readNeed, respond, type HeardWords, type KitchenAgent, type Via } from "../flow";
import { orderForModel, spokenDate, stepForModel, type ForModel } from "../say";
import { amountInWords, LANGUAGE_NAME, languageOf, numbersHeard, readBackReason, yesOrNo } from "../speech";
import { calls, type Call } from "./calls";

/**
 * POST /ui-api/voice/{kitchen}/tool: one function call from the voice agent (or one typed step when the
 * microphone or the connection is not available), run against Dock's intake as the kitchen's agent.
 *
 * The voice model proposes; this code checks. A decision the caller must make (a read-back, a check, a
 * question, an option, placing the order) runs only with the caller's own words from a new turn attached,
 * and a yes/no decision only when those words say yes. The words are stored in the ledger with it.
 */

export const ToolBody = z.object({
  callId: z.string().min(1).max(60),
  name: z.enum(["submit_request", "confirm_read_back", "respond_to_check", "answer_question", "choose_option", "place_order", "check_order"]),
  args: z.record(z.string(), z.unknown()).default({}),
  /** What the caller said in their latest turn(s), as transcribed, or what they typed. */
  heard: z.object({ text: z.string().max(2000), turn: z.number().int().nonnegative() }).optional(),
  via: z.enum(["speech", "typed"]).default("speech"),
  /** A tap on the screen: the person chose directly, no words to relay (the console's own buttons). */
  tapped: z.boolean().default(false),
});
export type ToolBody = z.input<typeof ToolBody>;

export type Pending = { need: NeedInput; summary: string; reason: string; say: string };

export type ToolReply = {
  forModel: ForModel;
  screen: { step?: IntakeView; order?: PublicOrder; pending?: Pending; problem?: { code: string; message: string }; heard?: string };
};

const refuse = (say: string, code: string): ToolReply => ({ forModel: { ok: false, state: "refused", say, refused: code }, screen: { problem: { code, message: say } } });

const DECISIONS = new Set(["confirm_read_back", "respond_to_check", "answer_question", "choose_option", "place_order"]);
const NEEDS_YES = new Set(["confirm_read_back", "place_order"]);

function str(args: Record<string, unknown>, k: string): string {
  const v = args[k];
  if (typeof v !== "string" || !v.trim()) throw new DockError(400, "tool_args", `${k} is required.`);
  return v.trim().slice(0, 200);
}

/** `req`: the call screen's request; the visitor's session on it makes their spoken or tapped answers theirs (flow.ts). */
export async function runTool(kitchen: string, input: unknown, req?: Request): Promise<ToolReply> {
  const reply = await runToolInner(kitchen, input, req);
  // The caller's language, from their own words: the agent says AimoPilot's English sentence in it.
  const body = input as { callId?: string; heard?: { text?: string } };
  const call = body.callId ? calls().get(body.callId) : undefined;
  const spoken = body.heard?.text ? languageOf(body.heard.text) : undefined;
  if (call && spoken && (body.heard?.text ?? "").trim().split(/\s+/).length >= 2) call.desk.lang = spoken;
  const lang = call?.desk.lang;
  if (lang && lang !== "en") reply.forModel = { ...reply.forModel, speakIn: LANGUAGE_NAME[lang], say: reply.forModel.say, note: `The caller speaks ${LANGUAGE_NAME[lang]}: say this in ${LANGUAGE_NAME[lang]}, not in English.` };
  return reply;
}

async function runToolInner(kitchen: string, input: unknown, req?: Request): Promise<ToolReply> {
  const body = parse(ToolBody, input);
  const registry = calls();
  const call = registry.use(body.callId, kitchen, body.via);
  const a = await kitchenAgent(kitchen, req);
  const via: Via = body.via;
  const heard: HeardWords | undefined = body.heard && body.heard.text.trim() ? { text: body.heard.text.trim(), turn: body.heard.turn } : undefined;

  // The caller's own words, from a turn not already used for a decision.
  if (DECISIONS.has(body.name) && !body.tapped) {
    if (!heard) return refuse("Not done: Dock did not hear the caller answer. Ask the caller and wait for their answer.", "no_words");
    if (heard.turn <= call.desk.lastTurnUsed) return refuse("Not done: the caller has not answered since the last decision. Ask the caller and wait for their answer.", "words_already_used");
    const yn = yesOrNo(heard.text);
    const confirming = NEEDS_YES.has(body.name) || (body.name === "respond_to_check" && body.args.choice === "confirm");
    if (confirming && yn !== "yes") return refuse(`Not done: the caller said "${heard.text.slice(0, 120)}", which is not a clear yes. Ask again.`, "not_a_yes");
    call.desk.lastTurnUsed = heard.turn;
  }

  try {
    switch (body.name) {
      case "submit_request":
        return await submit(a, call, String(body.args.request ?? ""), heard, via);
      case "confirm_read_back": {
        const p = call.desk.pending;
        if (!p) return refuse("There is no read-back waiting. If the caller wants something, call submit_request.", "nothing_pending");
        call.desk.pending = undefined;
        const opened = await open(a, call, p.need, p.words, via, `The caller confirmed the read-back${p.reason ? ` (${p.reason})` : ""}.`, p.model);
        // The read-back already asked about this very amount and the caller said yes: the same check is not asked twice.
        const s = opened.screen.step;
        const c = s?.state === "needs_confirmation" ? s.concerns[0] : undefined;
        const q = (p.need as { quantity?: { amount: number; unit: string } }).quantity;
        if (s && c && c.confirmable && p.reason && AMOUNT_CONCERNS.has(c.code) && q && c.key.endsWith(`:${q.amount}:${q.unit}`)) {
          return fromStep(call, await respond(a, s.requestId, c.key, "confirm", "voice", via, heard), heard);
        }
        return opened;
      }
      case "respond_to_check":
        return fromStep(call, await respond(a, current(call), str(body.args, "key"), str(body.args, "choice"), "voice", via, heard), heard);
      case "answer_question":
        return fromStep(call, await answer(a, current(call), str(body.args, "questionId"), str(body.args, "optionId"), "voice", via, heard), heard);
      case "choose_option":
        return fromStep(call, await choose(a, current(call), str(body.args, "optionId"), "voice", via, heard), heard);
      case "place_order": {
        const order = await place(a, current(call), "voice", heard);
        call.desk.orderId = order.orderId;
        return { forModel: orderForModel(order), screen: { order, step: await getStep(a, current(call)), heard: heard?.text } };
      }
      case "check_order": {
        if (call.desk.orderId) {
          const order = await getOrder(a, call.desk.orderId);
          return { forModel: orderForModel(order), screen: { order } };
        }
        if (call.desk.pending) return { forModel: { ok: true, state: "read_back", say: call.desk.pending.say }, screen: { pending: pendingView(call) } };
        if (!call.desk.requestId) return { forModel: { ok: true, state: "idle", say: "There is no request yet." }, screen: {} };
        return fromStep(call, await getStep(a, call.desk.requestId));
      }
    }
  } catch (err) {
    const p = asProblem(err);
    return { forModel: { ok: false, state: "error", say: `AimoPilot could not do that: ${p.message}`, code: p.code }, screen: { problem: p } };
  }
}

function current(call: Call): string {
  if (!call.desk.requestId) throw new DockError(409, "no_request", "There is no request on this call yet.");
  return call.desk.requestId;
}

function pendingView(call: Call): Pending | undefined {
  const p = call.desk.pending;
  if (!p) return undefined;
  const parsed = NeedSchema.safeParse(p.need);
  const q = parsed.success ? parsed.data.quantity : undefined;
  return { need: p.need, summary: parsed.success ? describeNeed(parsed.data) : "", reason: p.reason, say: p.say };
}

/**
 * The one sentence every spoken request is read back with before anything is looked up or priced: amount (in
 * digits and words, so the model says it right in any language), unit, product and day, and the reason when the
 * amount looks unusual or the two hearings disagree.
 */
export function readBackSay(item: string, q: { amount: number; unit: NonNullable<NeedInput["quantity"]>["unit"] }, reason: string | undefined, deliverBy?: string) {
  const day = deliverBy ? `, for ${spokenDate(deliverBy)}` : "";
  return `${formatAmount(q.amount, q.unit)} (${amountInWords(q.amount, q.unit)}) of ${item}${day}${reason ? `. I am checking because ${reason}` : ""}.`;
}

/** Concerns the read-back has already put to the caller: the amount itself was unusual, and they said yes to it. */
const AMOUNT_CONCERNS = new Set(["quantity_tenfold", "quantity_unusual", "large_first_order"]);

function fromStep(call: Call, step: IntakeView, heard?: HeardWords): ToolReply {
  call.desk.requestId = step.requestId;
  return { forModel: stepForModel(step), screen: { step, heard: heard?.text } };
}

async function submit(a: KitchenAgent, call: Call, request: string, heard: HeardWords | undefined, via: Via): Promise<ToolReply> {
  // The words shown on screen are the words acted on: the transcript, or what was typed. The model's own
  // rendering of the request is only a fallback, and a disagreement on numbers triggers a read-back.
  // On a call, the request must be the caller's own words from this turn: the model may not submit a request
  // nobody said (it has tried, with its own greeting as the "request").
  if (via === "speech" && (!heard || heard.turn <= call.desk.lastTurnUsed)) return refuse("Not done: Dock did not hear the caller ask for anything. Ask the caller what they need and wait.", "no_words");
  const words = (heard?.text || request).trim().slice(0, 2000);
  if (!words) return refuse("Not done: Dock has no words to read. Ask the caller what they need.", "no_words");
  if (heard) call.desk.lastTurnUsed = Math.max(call.desk.lastTurnUsed, heard.turn);
  calls().countInterpret(call);
  let read;
  try {
    read = await readNeed(a, words);
  } catch (err) {
    const p = asProblem(err);
    if (p.code === "need_incomplete") {
      const missing = ((p.details?.missing as string[]) ?? []).map((m) => (m === "item" ? "what to buy" : "how much, with the unit"));
      return { forModel: { ok: false, state: "incomplete", say: `AimoPilot understood part of it but needs ${missing.join(" and ")}.`, ask: `Ask the caller for ${missing.join(" and ")}.` }, screen: { problem: p, heard: words } };
    }
    if (p.code === "not_a_purchase_request") return { forModel: { ok: false, state: "not_a_request", say: "That did not sound like something to buy.", ask: "Ask what the kitchen needs." }, screen: { problem: p, heard: words } };
    return { forModel: { ok: false, state: "error", say: `AimoPilot could not read the request: ${p.message}` }, screen: { problem: p, heard: words } };
  }
  const need = NeedSchema.parse(read.need);
  const memory = await a.rt.dock.intake.kitchen(a.session);
  const usual = memory.families.map((f) => ({ family: f.family, amount: f.usual.amount, unit: f.usual.unit }));
  const reason = readBackReason(need, { usual, heardNumbers: via === "speech" && heard ? numbersHeard(heard.text) : undefined, spokenNumbers: via === "speech" && heard && request ? numbersHeard(request) : undefined });
  // Speech is always read back (a number heard in a loud room is never acted on unconfirmed); typing only when unusual.
  if ((reason || via === "speech") && need.quantity) {
    const say = readBackSay(need.item.text, need.quantity, reason, need.deliverBy);
    call.desk.pending = { need: read.need, words, reason: reason ?? "", model: read.model, say };
    call.desk.requestId = undefined;
    call.desk.orderId = undefined;
    return {
      forModel: { ok: true, state: "read_back", say, ask: "Is that right? (Wait for the caller. If they correct it, call submit_request again with their words.)", amount: formatAmount(need.quantity.amount, need.quantity.unit), item: need.item.text, ...(need.deliverBy ? { deliverBy: need.deliverBy } : {}) },
      screen: { pending: { need: read.need, summary: describeNeed(need), reason: reason ?? "", say }, heard: words },
    };
  }
  return open(a, call, read.need, words, via, undefined, read.model);
}

async function open(a: KitchenAgent, call: Call, need: NeedInput, words: string, via: Via, note: string | undefined, model: string): Promise<ToolReply> {
  call.desk.orderId = undefined;
  const step = await openNeed(a, need, "voice", via, {
    words,
    summary: `The request came in through the voice door (${via === "typed" ? "typed, the microphone or the connection was not available" : "spoken"}): "${words.slice(0, 200)}".${note ? ` ${note}` : ""}`,
    data: { callId: call.callId, mode: call.mode, interpretModel: model, ...(note ? { readBack: note } : {}) },
  });
  return fromStep(call, step, { text: words, turn: call.desk.lastTurnUsed });
}
