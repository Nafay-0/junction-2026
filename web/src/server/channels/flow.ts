import { DockError } from "@/core/errors";
import { RELAYED, type HumanVia, type IntakeView } from "@/core/intake";
import type { NeedInput } from "@/core/need";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { interpretRequest } from "../agent/interpret";
import { consoleKitchen } from "../authz";
import type { ConsolePerson } from "../console-context";
import { resolveKitchen, type ConsoleKitchenInfo } from "../console-kitchens";
import { getRuntime, type Runtime } from "../runtime";

/**
 * The one flow every door feeds. A door (voice, photo) turns what a person said or wrote into a structured
 * need, then calls these functions, which call Dock's intake and order flow exactly as the typed console does,
 * as the kitchen's own agent with its signed mandate. Nothing here decides: the intake asks, the gate decides,
 * a named person signs off.
 *
 * Every request is tagged in the ledger with the door it came through (an `intake` entry with
 * `data.step = "door"`), and every answer a person gave by voice is stored with the words that were heard
 * (`data.step = "heard"`), right before the confirmation, answer or choice it led to.
 *
 * Ledger convention for doors, readable by the wholesaler's operations view:
 *   data.door   "voice" | "photo"           which door the request came through
 *   data.via    "speech" | "typed" | "image" | "pdf" | "text"   how it arrived at that door
 */

export type Door = "voice" | "photo";
export type Via = "speech" | "typed" | "image" | "pdf" | "text";

/** `person`: the visitor signed in on this phone, for their own kitchen (server/authz.ts). Their answers are theirs. */
export type KitchenAgent = { rt: Runtime; info: ConsoleKitchenInfo; session: AgentSession; person?: ConsolePerson };

/**
 * The kitchen's purchasing agent, as the console's server side holds it: the browser never sees the mandate. With the
 * request, the console rule applies (a visitor's kitchen only from their own phone) and the signed-in person is known.
 */
export async function kitchenAgent(slug: string, req?: Request): Promise<KitchenAgent> {
  const rt = await getRuntime();
  const viaConsole = req ? await consoleKitchen(req, rt, slug) : undefined;
  const k = viaConsole ?? (req ? undefined : await resolveKitchen(slug));
  if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
  return { rt, info: k.info, session, person: viaConsole?.console.person };
}

/**
 * Whose answer this is. The caller's own words on a call from their signed-in phone (voice), or a tap on their own
 * screen (portal_session), are the person's. Otherwise (a built-in demo kitchen's open screen, no session) the
 * answer is relayed and recorded as such; the words heard are still kept in the ledger.
 */
function humanVia(a: KitchenAgent, door: Door, heard?: HeardWords): HumanVia {
  if (!a.person) return RELAYED;
  if (door === "voice" && heard) return { channel: "voice", person: a.person.name, words: heard.text.slice(0, 300) };
  return { channel: "portal_session", person: a.person.name };
}

export function byLine(info: ConsoleKitchenInfo, door: Door, via: Via): string {
  const how = door === "voice" ? (via === "typed" ? "typed at the voice door" : "by voice") : via === "text" ? "from pasted text" : via === "pdf" ? "from a PDF" : "from a photo";
  return `${info.by} (${how})`.slice(0, 120);
}

/** Free text to a structured need with the same reader the typed console uses. */
export async function readNeed(a: KitchenAgent, text: string): Promise<{ need: NeedInput; model: string; ms: number }> {
  const r = await interpretRequest({ text }, { catalog: a.rt.catalog, mandate: a.session.mandate });
  return { need: r.need as NeedInput, model: r.model, ms: r.ms };
}

export type HeardWords = { text: string; turn: number };

function recordHeard(a: KitchenAgent, requestId: string, door: Door, what: string, heard: HeardWords | undefined, data: Record<string, unknown>) {
  if (!heard) return;
  a.rt.dock.ledger.append({
    type: "intake",
    actor: `door:${door}`,
    requestId,
    summary: `Heard from the buyer before ${what}: "${heard.text.slice(0, 300)}"`,
    data: { step: "heard", door, heard: heard.text.slice(0, 1000), turn: heard.turn, ...data },
  });
}

export async function openNeed(
  a: KitchenAgent,
  need: NeedInput,
  door: Door,
  via: Via,
  detail: { words?: string; summary: string; data?: Record<string, unknown> },
): Promise<IntakeView> {
  const step = await a.rt.dock.intake.open(a.session, { need, by: byLine(a.info, door, via) });
  a.rt.dock.ledger.append({
    type: "intake",
    actor: `door:${door}`,
    requestId: step.requestId,
    summary: detail.summary,
    data: { step: "door", door, via, ...(detail.words ? { words: detail.words.slice(0, 2000) } : {}), ...(detail.data ?? {}) },
  });
  return step;
}

export function getStep(a: KitchenAgent, requestId: string): Promise<IntakeView> {
  return a.rt.dock.intake.get(a.session, requestId);
}

export async function respond(a: KitchenAgent, requestId: string, key: string, choice: string, door: Door, via: Via, heard?: HeardWords): Promise<IntakeView> {
  recordHeard(a, requestId, door, choice === "confirm" ? `confirming ${key}` : `correcting ${key} (${choice})`, heard, { key, choice });
  return a.rt.dock.intake.respondToConcerns(a.session, requestId, { by: byLine(a.info, door, via), responses: [{ key, choice }] }, humanVia(a, door, heard));
}

export async function answer(a: KitchenAgent, requestId: string, questionId: string, optionId: string, door: Door, via: Via, heard?: HeardWords): Promise<IntakeView> {
  recordHeard(a, requestId, door, `answering ${questionId} with ${optionId}`, heard, { questionId, optionId });
  return a.rt.dock.intake.answer(a.session, requestId, { by: byLine(a.info, door, via), answers: [{ questionId, optionId }] }, humanVia(a, door, heard));
}

export async function choose(a: KitchenAgent, requestId: string, optionId: string, door: Door, via: Via, heard?: HeardWords): Promise<IntakeView> {
  recordHeard(a, requestId, door, `choosing ${optionId}`, heard, { optionId });
  return a.rt.dock.intake.choose(a.session, requestId, { by: byLine(a.info, door, via), optionId }, humanVia(a, door, heard));
}

/** Send the quoted order to the gate. The gate decides; anything beyond the mandate waits for a person's passkey. */
export async function place(a: KitchenAgent, requestId: string, door: Door, heard?: HeardWords): Promise<PublicOrder> {
  const step = await getStep(a, requestId);
  if (step.state !== "quoted" || !step.quote) throw new DockError(409, "not_quoted", "There is no fixed-price quote to place yet: an option has to be chosen first.");
  recordHeard(a, requestId, door, "placing the order", heard, { quoteId: step.quote.quote.quoteId });
  const q = step.quote;
  return a.rt.dock.placeOrder(a.session, {
    requestId,
    quoteToken: q.quoteToken,
    lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })),
  });
}

export function getOrder(a: KitchenAgent, orderId: string): Promise<PublicOrder> {
  return a.rt.dock.getOrder(a.session, orderId);
}

/** A DockError as data for a screen or a voice model; anything else is rethrown. */
export function asProblem(err: unknown): { code: string; message: string; rule?: string; details?: Record<string, unknown> } {
  if (err instanceof DockError) return { code: err.code, message: err.message, rule: err.rule, details: err.details };
  throw err;
}
