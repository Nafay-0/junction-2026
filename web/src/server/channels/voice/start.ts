import { DockError } from "@/core/errors";
import { localNow } from "@/core/kitchen";
import { currentApprover } from "../../approver-session";
import { kitchenAgent, type KitchenAgent } from "../flow";
import { VOICE_VOCABULARY } from "../prompts";
import { voiceBrief } from "../../thread/voice-brief";
import { spokenDate } from "../say";
import { reserveLlmCall } from "../../limits";
import { calls, voiceLimits, type Call } from "./calls";
import { LIVE_WS_URL, fallbackModel, liveSetup, mintLiveToken, providerOf, voiceModel, type CallMode, type VoiceProvider } from "./live";
import { REALTIME_WS_URL, mintRealtimeSecret, realtimeSession } from "./realtime";

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
  mode: CallMode;
  kitchen: { slug: string; name: string; agentName: string };
  expiresAt: string;
  maxSeconds: number;
  live?: { provider: VoiceProvider; transport?: "websocket" | "webrtc"; wsUrl: string; token: string; model: string; startBy: string; inputRate: number };
  /** What the agent was told at the start: already facts for the grounding check. */
  context: { standingRules: string[]; usualOrders: string[]; today: string };
  brands: string[];
};

/**
 * `req` is the call screen's request; undefined only for in-process callers (the evaluation), which may call the
 * two demo kitchens. `avoid`: the screen's first provider refused the session (free-tier quota, outage), so the
 * call goes to the other one if it is configured.
 */
export async function startCall(req: Request | undefined, slug: string, input: { carryFrom?: string; avoid?: string; model?: string; lang?: string }): Promise<CallStart> {
  const a = await kitchenAgent(slug, req);
  if (a.info.kind === "visitor") {
    const me = req ? await currentApprover(req, a.rt) : undefined;
    if (me?.sandbox?.sandboxId !== slug) throw new DockError(403, "call_not_yours", "Only the phone that joined this kitchen can call its agent. Scan the call QR code to get a kitchen of your own.");
  }
  const mode: CallMode = "hands_free";
  const limits = voiceLimits();
  const registry = calls();
  const lang = input.lang === "fi" || input.lang === "sv" ? input.lang : "en";
  const ctx = await callContext(a);
  const brands = await brandsOf(a);
  const base = { kitchen: { slug, name: a.info.name, agentName: a.info.agentName }, context: { standingRules: ctx.standingRules, usualOrders: ctx.usualOrders, today: ctx.today }, brands };
  const system = voiceBrief({ kitchenName: a.info.name, agentName: a.info.agentName, lang, maxMinutes: Math.round(limits.callSeconds / 60) });
  reserveLlmCall(); // the server's daily model-call and spend caps (limits.ts); the spend is added at hang-up
  const call = registry.open(slug, mode, limits, input.carryFrom);
  if (!call.desk.lang) call.desk.lang = lang;
  const first = input.model && !req ? input.model : voiceModel();
  const second = fallbackModel();
  const order = input.avoid && providerOf(first) === input.avoid && second ? [second] : second ? [first, second] : [first];
  const vocabulary = [...new Set([...ctx.vocabulary, ...VOICE_VOCABULARY])];
  let lastErr: unknown;
  for (const model of order) {
    try {
      // A browser gets OpenAI over WebRTC set up through this server (bounded here); an in-process caller (the
      // evaluation, with no browser) uses a WebSocket with a short-lived secret.
      const live = req && providerOf(model) === "openai" ? rtcFor(call, model, system, mode, vocabulary) : await mintFor(model, system, mode, vocabulary, limits.callSeconds);
      call.model = model;
      return { ...base, callId: call.callId, mode, expiresAt: live.expiresAt, maxSeconds: limits.callSeconds, live: live.live };
    } catch (err) {
      lastErr = err;
    }
  }
  registry.end(call.callId, slug, "token_failed");
  throw lastErr;
}

function rtcFor(call: Call, model: string, system: string, mode: CallMode, vocabulary: string[]) {
  call.rtc = { session: realtimeSession({ model, system, mode, vocabulary }) };
  const now = Date.now();
  return { expiresAt: new Date(call.expiresAt).toISOString(), live: { provider: "openai" as const, transport: "webrtc" as const, wsUrl: "", token: "", model, startBy: new Date(now + 60_000).toISOString(), inputRate: 24000 } };
}

async function mintFor(model: string, system: string, mode: CallMode, vocabulary: string[], seconds: number) {
  if (providerOf(model) === "openai") {
    const t = await mintRealtimeSecret(realtimeSession({ model, system, mode, vocabulary }), { seconds });
    return { expiresAt: t.expiresAt, live: { provider: "openai" as const, wsUrl: REALTIME_WS_URL, token: t.token, model, startBy: t.startBy, inputRate: 24000 } };
  }
  const t = await mintLiveToken(liveSetup({ model, system, mode, vocabulary }), { seconds });
  return { expiresAt: t.expiresAt, live: { provider: "gemini" as const, wsUrl: LIVE_WS_URL, token: t.token, model, startBy: t.startBy, inputRate: 16000 } };
}

/** What the call starts with: the kitchen's words for the recogniser, and its rules and usual orders as facts for the grounding check. */
async function callContext(a: KitchenAgent): Promise<{ vocabulary: string[]; standingRules: string[]; usualOrders: string[]; today: string }> {
  const memory = await a.rt.dock.intake.kitchen(a.session);
  const today = localNow(new Date()).date;
  return {
    vocabulary: memory.families.map((f) => f.family.replace(/_/g, " ")).filter((w) => w.length >= 3),
    today: `Today is ${spokenDate(today)} ${today.slice(0, 4)} (${today}, Europe/Helsinki).`,
    standingRules: memory.stated.map((s) => `${s.text}.`.replace(/\.\.$/, ".")),
    usualOrders: memory.families.map((f) => `${f.family}: ${f.usual.text}, ${f.orders} orders so far, the last one on ${spokenDate(f.lastOrder.placedAt.slice(0, 10))}.`),
  };
}

async function brandsOf(a: KitchenAgent): Promise<string[]> {
  const cats = a.session.mandate.allowedCategories.slice(0, 8);
  const lists = await Promise.all((cats.length ? cats : [undefined]).map((category) => a.rt.catalog.searchProducts({ ...(category ? { category } : {}), limit: 100 })));
  return [...new Set(lists.flat().map((p) => p.brand.trim()).filter((b) => b.length >= 3))].slice(0, 200);
}
