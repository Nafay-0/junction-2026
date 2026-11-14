import { NeedSchema, type NeedInput, type StructuredNeed } from "@/core/need";
import type { PublicOrder } from "@/core/orders";
import { consoleKitchen } from "@/server/authz";
import { orderForModel, spokenDate, stepForModel, type ForModel } from "@/server/channels/say";
import type { HeardWords } from "@/server/channels/flow";
import { calls, type Call } from "@/server/channels/voice/calls";
import type { ToolBody, ToolReply } from "@/server/channels/voice/tools";
import { getRuntime } from "@/server/runtime";
import { cardId, gateCard, orderCard, priceCard, understoodCard } from "./cards";
import { doorLine, doorTurn } from "./engine";
import { afterStep, combineItems, openNeed, record, runAction, type ItemOutcome } from "./pipeline";
import { placeSheet } from "./sheet";
import type { BuyerTurn } from "./types";
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
        // Several items read back together: one understood card each.
        (s.pending.parts ?? [s.pending.need]).forEach((n, i) => {
          const need = NeedSchema.safeParse(n);
          if (need.success) run.store.card(run.thread, run.turnId, understoodCard({ ref: i ? `${run.turnId}:${i}` : run.turnId, words: s.heard ?? words ?? "", need: need.data as StructuredNeed }));
        });
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

// ---------- the confirmed read-back, through the engine ----------

type Pending = NonNullable<Call["desk"]["pending"]>;
const AMOUNT_CONCERNS = new Set(["quantity_tenfold", "quantity_unusual", "large_first_order"]);

const WHY: Record<string, string> = {
  rules: "the kitchen's rules do not allow it",
  day: "it cannot be delivered on the day asked",
  stock: "it is out of stock",
  other: "nothing in the assortment fits it",
};

/**
 * The caller said yes to the read-back: the reading they confirmed goes to the engine exactly as it was read back
 * (openNeed, never read again), so the spoken path follows the engine's own rules: a named day ("for Thursday",
 * "torstaiksi") is the delivery day and "by Monday" a latest day; a kind it cannot offer is said first, before any
 * option; several items are one order sheet; a routine request is placed alone. The thread gets the buyer's "yes"
 * and the cards; the voice model gets one sentence about them.
 */
export async function confirmThroughEngine(kitchen: string, call: Call, p: Pending, heard: HeardWords | undefined, via: BuyerTurn["via"], req?: Request): Promise<ToolReply> {
  const rt = await getRuntime();
  const k = req ? await consoleKitchen(req, rt, kitchen) : undefined;
  return doorTurn(k ?? kitchen, { door: "voice", via, ...(heard ? { text: heard.text } : { label: "Yes, that's right" }) }, async (run) => {
    record(run, "read_back_confirmed", `The caller confirmed the read-back${p.reason ? ` (${p.reason})` : ""}: "${p.say.slice(0, 200)}"`, { words: p.words, heard: heard?.text });
    call.desk.kindSaid = p.kind?.asked;
    const parts = p.parts?.length ? p.parts : [{ need: p.need, words: p.words }];
    run.multi = parts.length > 1;
    const outcomes: ItemOutcome[] = (await Promise.all(parts.map((x, i) => openNeed(run, x.need as NeedInput, parts.length > 1 ? x.words : p.words, { ref: `${run.turnId}:${i}` })))).flat();
    // The door's ledger convention (channels/flow.ts): each request this door opened says so, with the words.
    for (const o of outcomes)
      if (o.requestId)
        rt.dock.ledger.append({ type: "intake", actor: "door:voice", requestId: o.requestId, summary: `The request came in through the voice door (spoken, read back and confirmed): "${p.words.slice(0, 200)}".`, data: { step: "door", door: "voice", via: via === "tap" ? "speech" : via, words: p.words.slice(0, 2000), callId: call.callId, mode: call.mode, readBack: p.say.slice(0, 300) } });
    // The read-back already asked about this very amount and the caller said yes: the same check is not asked twice.
    if (!run.multi && outcomes[0]?.state === "needs_confirmation" && outcomes[0].requestId && p.reason) {
      const s = await rt.dock.intake.get(run.session, outcomes[0].requestId);
      const c = s.concerns[0];
      const q = (p.need as { quantity?: { amount: number; unit: string } }).quantity;
      if (c?.confirmable && AMOUNT_CONCERNS.has(c.code) && q && c.key.endsWith(`:${q.amount}:${q.unit}`)) outcomes.splice(0, 1, ...(await runAction(run, { type: "concern", requestId: s.requestId, key: c.key, choice: "confirm" }, heard?.text)));
    }
    const all = run.multi ? await combineItems(run, p.words, outcomes) : outcomes;
    return spokenReply(run, call, all, heard);
  }).then((r) => ({ ...r, threaded: true }));
}

/** "Yes, order it" with an order sheet on the desk: the engine places the sheet (one order, one gate decision). */
export async function placeSheetThroughEngine(kitchen: string, call: Call, heard: HeardWords | undefined, via: BuyerTurn["via"], req?: Request): Promise<ToolReply> {
  const rt = await getRuntime();
  const k = req ? await consoleKitchen(req, rt, kitchen) : undefined;
  const sheet = call.desk.sheet!;
  return doorTurn(k ?? kitchen, { door: "voice", via, ...(heard ? { text: heard.text } : { label: "Order it" }) }, async (run) => {
    const order = await placeSheet(run, sheet.sheetId, sheet.version);
    call.desk.sheet = undefined;
    call.desk.requestId = order.requestId;
    call.desk.orderId = order.orderId;
    return { forModel: orderForModel(order), screen: { order, heard: heard?.text } } as ToolReply;
  }).then((r) => ({ ...r, threaded: true }));
}

/** One sentence for the voice model about what the engine did, from the same records as the cards; and the desk. */
async function spokenReply(run: Parameters<typeof afterStep>[0], call: Call, outcomes: ItemOutcome[], heard: HeardWords | undefined): Promise<ToolReply> {
  const rt = run.rt;
  const sheet = [...outcomes].reverse().find((o) => o.sheet);
  if (sheet?.sheet) {
    const card = run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "sheet" && (c as { sheetId?: string }).sheetId === sheet.sheet!.sheetId) as { version?: number } | undefined;
    call.desk.sheet = { sheetId: sheet.sheet.sheetId, version: card?.version ?? 1 };
    call.desk.requestId = sheet.requestId;
    call.desk.orderId = undefined;
    const lines = sheet.sheet.lines.map((l) => `${l.packs} x ${l.name}`).join(", ");
    const total = `€${(sheet.sheet.totalCents / 100).toFixed(2)}`;
    const forModel: ForModel = { ok: true, state: "order_sheet", say: `All ${sheet.sheet.lines.length} items are on one order, on the screen: ${total}, delivered ${spokenDate(sheet.sheet.deliveryDate)}.`, ask: "Ask whether to order it. If the caller says yes, call place_order.", total, lines };
    run.facts.push(forModel);
    return { forModel, screen: { heard: heard?.text, problem: { code: "sheet", message: `${forModel.say} ${lines}.` } } };
  }
  // Several items that did not all become one order sheet: one short clause per item, then the first that waits.
  const items = outcomes.filter((x) => !x.sheet);
  if (run.multi && items.length > 1) {
    const clause = (x: ItemOutcome) =>
      x.placed ? `placed (${x.placed.status === "committed" ? "ordered" : "waiting for sign-off"})` : x.notice ? x.notice.message.split(/(?<=[.:])\s/)[0].replace(/[.:]$/, "") : x.state === "options_ready" ? "options are on the screen" : x.state === "needs_confirmation" ? "a check is on the screen" : x.state === "needs_input" ? "a question is on the screen" : "on the screen";
    const open = items.find((x) => x.requestId && !x.placed && !x.notice);
    if (open?.requestId) {
      call.desk.requestId = open.requestId;
      call.desk.orderId = undefined;
    }
    const say = items.map((x) => `${x.words.replace(/\s+(for|by|on)\s.*$/i, "")}: ${clause(x)}`).join(". ") + ".";
    const forModel: ForModel = { ok: true, state: "several_items", say, ask: open ? "Ask the caller about the first item that waits, as the screen shows it." : undefined, items: items.map((x) => ({ words: x.words, state: x.placed ? "placed" : (x.notice?.kind ?? x.state) })) };
    run.facts.push(forModel);
    return { forModel, screen: { heard: heard?.text, ...(open?.requestId ? { step: await rt.dock.intake.get(run.session, open.requestId) } : {}), problem: { code: "several_items", message: say } } };
  }
  const o = outcomes[0];
  if (!o) return { forModel: { ok: false, state: "error", say: "AimoPilot could not do that." }, screen: {} };
  if (o.notice) {
    const forModel: ForModel = { ok: false, state: o.notice.kind, say: o.notice.message, ask: "Ask whether the caller wants to change the request." };
    return { forModel, screen: { problem: { code: o.notice.kind, message: o.notice.message }, heard: heard?.text } };
  }
  if (o.placed) {
    const order = await rt.dock.getOrder(run.session, o.placed.orderId);
    call.desk.requestId = order.requestId;
    call.desk.orderId = order.orderId;
    const said = orderForModel(order);
    const alone = run.store.cards(run.thread).some((x) => x.card.type === "order" && (x.card as { orderId?: string; authorised?: { by?: string } }).orderId === order.orderId && (x.card as { authorised?: { by?: string } }).authorised?.by === "agent");
    return { forModel: alone ? { ...said, say: `${said.say} (Placed by the agent alone: a routine order inside the kitchen's mandate, the product it usually buys.)` } : said, screen: { order, ...(o.requestId ? { step: await rt.dock.intake.get(run.session, o.requestId) } : {}), heard: heard?.text } };
  }
  if (!o.requestId) return { forModel: { ok: false, state: "error", say: "AimoPilot could not do that." }, screen: {} };
  const step = await rt.dock.intake.get(run.session, o.requestId);
  call.desk.requestId = step.requestId;
  call.desk.orderId = undefined;
  let forModel = stepForModel(step);
  // A kind it cannot offer is said first, before any option (the options card's insteadOf, as the thread shows it).
  const opts = run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "options" && c.requestId === step.requestId);
  const instead = opts?.type === "options" ? opts.insteadOf : undefined;
  // Already said in the read-back, before the caller's yes: only "instead" now.
  if (instead && call.desk.kindSaid) forModel = { ...forModel, say: `Instead: ${forModel.say}`, insteadOf: instead.asked };
  else if (instead) forModel = { ...forModel, say: `${instead.asked} cannot be offered: ${WHY[instead.why] ?? WHY.other}${instead.why === "day" && instead.day ? ` (${spokenDate(instead.day)})` : ""}. Instead: ${forModel.say}`, insteadOf: instead.asked };
  call.desk.kindSaid = undefined;
  // The day asked and the day an option arrives, when they differ (an earlier day only when that day cannot be had).
  if (opts?.type === "options" && opts.askedDay && step.state === "options_ready") {
    const first = step.options[0];
    if (first && first.deliveryDate !== opts.askedDay) forModel = { ...forModel, say: `${forModel.say} That arrives ${spokenDate(first.deliveryDate)}, not ${spokenDate(opts.askedDay)} as asked.` };
  }
  return { forModel, screen: { step, heard: heard?.text } };
}
