import { DockError } from "@/core/errors";
import { localNow } from "@/core/kitchen";
import { calendar } from "../../agent/interpret";
import { currentApprover } from "../../approver-session";
import { kitchenAgent, type KitchenAgent } from "../flow";
import { voiceSystem, type CallContext } from "../prompts";
import { spokenDate } from "../say";
import { reserveLlmCall } from "../../limits";
import { calls, voiceLimits, type Call } from "./calls";
import { LIVE_WS_URL, liveSetup, mintLiveToken, voiceModel, type CallMode } from "./live";

/**
 * Starting a call: reserve the kitchen's line, build what the agent knows (the kitchen's name, its standing
 * rules and usual orders, read from the kitchen repository), lock it into a one-use token, and give the browser
 * the token, the facts the agent starts with (for the grounding check) and the catalogue's brand names.
 *
 * Who may call which kitchen: a visitor kitchen (sbx_...) only from the phone that joined it (its approver
 * session cookie), so a photographed QR code opens a fresh kitchen for whoever scans it, never someone else's
 * line. The two demo kitchens can be called from the console preview, under the same caps.
 */

export type CallStart = {
  callId: string;
  mode: CallMode | "typed";
  kitchen: { slug: string; name: string; agentName: string };
  expiresAt: string;
  maxSeconds: number;
  live?: { wsUrl: string; token: string; model: string; startBy: string };
  /** What the agent was told at the start: already facts for the grounding check. */
  context: { standingRules: string[]; usualOrders: string[]; today: string };
  brands: string[];
  /** A typed call was started because voice is not available, with the reason. */
  fallback?: { code: string; message: string };
};

export async function startCall(req: Request, slug: string, input: { mode?: string; carryFrom?: string }): Promise<CallStart> {
  const a = await kitchenAgent(slug);
  if (a.info.kind === "visitor") {
    const me = await currentApprover(req, a.rt);
    if (me?.sandbox?.sandboxId !== slug) throw new DockError(403, "call_not_yours", "Only the phone that joined this kitchen can call its agent. Scan the call QR code to get a kitchen of your own.");
  }
  const mode: CallMode | "typed" = input.mode === "typed" ? "typed" : input.mode === "hands_free" ? "hands_free" : "push_to_talk";
  const limits = voiceLimits();
  const registry = calls();
  const ctx = await callContext(a, mode === "push_to_talk", Math.round(limits.callSeconds / 60));
  const brands = await brandsOf(a);
  const base = { kitchen: { slug, name: a.info.name, agentName: a.info.agentName }, context: { standingRules: ctx.standingRules, usualOrders: ctx.usualOrders, today: ctx.today }, brands };

  if (mode === "typed") {
    const call = registry.open(slug, "typed", limits, input.carryFrom);
    return { ...base, callId: call.callId, mode, expiresAt: new Date(call.expiresAt).toISOString(), maxSeconds: Math.round((call.expiresAt - call.startedAt) / 1000) };
  }
  reserveLlmCall(); // the server's daily model-call and spend caps (limits.ts); the spend is added at hang-up
  const call = registry.open(slug, mode, limits, input.carryFrom);
  try {
    const model = voiceModel();
    const token = await mintLiveToken(liveSetup({ model, system: voiceSystem(ctx), mode }), { seconds: limits.callSeconds });
    return { ...base, callId: call.callId, mode, expiresAt: token.expiresAt, maxSeconds: limits.callSeconds, live: { wsUrl: LIVE_WS_URL, token: token.token, model, startBy: token.startBy } };
  } catch (err) {
    registry.end(call.callId, slug, "token_failed");
    throw err;
  }
}

/** Typed fallback for a call that could not start or was lost: same desk, no line held. */
export async function typedFallback(slug: string, call: Call) {
  return calls().open(slug, "typed", voiceLimits(), call.callId);
}

async function callContext(a: KitchenAgent, pushToTalk: boolean, maxMinutes: number): Promise<CallContext> {
  const now = new Date();
  const memory = await a.rt.dock.intake.kitchen(a.session);
  const today = localNow(now).date;
  return {
    kitchenName: a.info.name,
    agentName: a.info.agentName,
    caller: a.info.by,
    today: `Today is ${spokenDate(today)} ${today.slice(0, 4)} (${today}, Europe/Helsinki).`,
    calendar: calendar(now),
    standingRules: memory.stated.map((s) => `${s.text}.`.replace(/\.\.$/, ".")),
    usualOrders: memory.families.map((f) => `${f.family}: ${f.usual.text}, ${f.orders} orders so far, the last one on ${spokenDate(f.lastOrder.placedAt.slice(0, 10))}.`),
    pushToTalk,
    maxMinutes,
  };
}

async function brandsOf(a: KitchenAgent): Promise<string[]> {
  const cats = a.session.mandate.allowedCategories.slice(0, 8);
  const lists = await Promise.all((cats.length ? cats : [undefined]).map((category) => a.rt.catalog.searchProducts({ ...(category ? { category } : {}), limit: 100 })));
  return [...new Set(lists.flat().map((p) => p.brand.trim()).filter((b) => b.length >= 3))].slice(0, 200);
}
