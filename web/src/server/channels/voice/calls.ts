import { randomBytes } from "node:crypto";
import { DockError } from "@/core/errors";
import type { NeedInput } from "@/core/need";
import { recordGroundingChecks } from "../../grounding";
import { recordLlmSpend } from "../../limits";
import { LIVE_PRICE, type CallMode } from "./live";
import { REALTIME_PRICE } from "./realtime";

/** What a call cost at list prices, from the screen's usage report; at least one minute of each way when unknown. */
export function callCostUsd(c: Pick<Call, "usage" | "startedAt" | "endedAt" | "expiresAt" | "model">): number {
  const u = c.usage;
  const openai = c.model ? REALTIME_PRICE[c.model] : undefined;
  if (!u) return openai ? (600 * openai.audioIn + 1200 * openai.audioOut) / 1e6 : LIVE_PRICE.audioInPerMin + LIVE_PRICE.audioOutPerMin;
  // OpenAI: the screen adds up each response's own usage at list prices (costUsd); never below the audio's own cost.
  if (openai) return Math.max(u.costUsd ?? 0, (u.audioInSeconds * 10 * openai.audioIn + u.audioOutSeconds * 20 * openai.audioOut) / 1e6);
  return Math.max(u.costUsd ?? 0, (u.promptTokens * LIVE_PRICE.textInPerM + u.responseTokens * 12) / 1e6 + (u.audioInSeconds / 60) * LIVE_PRICE.audioInPerMin);
}

/**
 * Calls to a kitchen's purchasing agent, held in this server's memory.
 *
 * Bounds, so that nobody with the page open can run up spend:
 *   - one live call per kitchen at a time (a second caller is told the line is busy)
 *   - a call lasts at most DOCK_VOICE_CALL_SECONDS (default 300); Google refuses the token after that
 *   - DOCK_VOICE_CALLS_PER_KITCHEN_HOUR (default 6) and DOCK_VOICE_CALLS_PER_HOUR (default 20, all kitchens)
 *   - DOCK_VOICE_CALLS_PER_KITCHEN_DAY (default 15) and DOCK_VOICE_CALLS_PER_DAY (default 120, all kitchens):
 *     a photographed call QR code only ever opens a new visitor kitchen, and these caps bound the total
 *   - per call, at most 40 tool calls and 8 readings of free text by the interpret model
 *   - a call the page stops reporting on (tab closed, laptop asleep) frees the line after 30 s
 * Cost: a typical ordering call is a few cents (web/docs/doors.md); the worst case, five minutes of back-and-forth
 * with the context re-read every turn, is about $0.35. Every call's estimated spend is added to the server's daily
 * model cap (DOCK_LLM_DAILY_USD in limits.ts), which refuses new calls once it is used up.
 * DOCK_VOICE=off turns the voice door off (the typed fallback keeps working).
 *
 * A typed call (microphone unavailable, connection lost) uses the same desk and the same flow without a voice
 * session: it holds no line and costs only the interpret model.
 */

export type Desk = {
  requestId?: string;
  /** A need read from speech, waiting for the caller to confirm the read-back. */
  pending?: { need: NeedInput; words: string; reason: string; model: string; say: string };
  orderId?: string;
  /** Turn number of the caller's words last used for a decision: the same words never answer twice. */
  lastTurnUsed: number;
  /** The language the caller last spoke in (from their words), so the agent answers in it. */
  lang?: "en" | "fi" | "sv";
};

export type Call = {
  callId: string;
  kitchen: string;
  mode: CallMode | "typed";
  startedAt: number;
  expiresAt: number;
  lastSeen: number;
  endedAt?: number;
  endReason?: string;
  toolCalls: number;
  interprets: number;
  usage?: { audioInSeconds: number; audioOutSeconds: number; promptTokens: number; responseTokens: number; costUsd?: number };
  /** The voice model this call runs on (set when its session is minted). */
  model?: string;
  grounding: { checked: number; dropped: number };
  desk: Desk;
};

export const CALL_LIMITS = { toolCalls: 40, interprets: 8, staleMs: 30_000, typedMs: 30 * 60_000 };

function num(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function voiceLimits(env: Record<string, string | undefined> = process.env) {
  return {
    enabled: (env.DOCK_VOICE ?? "on").toLowerCase() !== "off",
    callSeconds: Math.min(900, num(env, "DOCK_VOICE_CALL_SECONDS", 300)),
    perKitchenHour: num(env, "DOCK_VOICE_CALLS_PER_KITCHEN_HOUR", 6),
    perHour: num(env, "DOCK_VOICE_CALLS_PER_HOUR", 20),
    perKitchenDay: num(env, "DOCK_VOICE_CALLS_PER_KITCHEN_DAY", 15),
    perDay: num(env, "DOCK_VOICE_CALLS_PER_DAY", 120),
  };
}

export class CallRegistry {
  private calls = new Map<string, Call>();
  /** Calls started per UTC day, per kitchen and in total ("*"): survives the two-hour prune. */
  private days = new Map<string, number>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(c: Call): boolean {
    const t = this.now();
    return c.mode !== "typed" && c.endedAt === undefined && t < c.expiresAt && t - c.lastSeen < CALL_LIMITS.staleMs;
  }

  /** Reserve a line. Throws 409 when the kitchen is already on a call, 429 when the hourly limits are used up. */
  open(kitchen: string, mode: CallMode | "typed", limits: ReturnType<typeof voiceLimits>, carryFrom?: string): Call {
    const t = this.now();
    this.prune();
    if (mode !== "typed") {
      if (!limits.enabled) throw new DockError(503, "voice_off", "Voice calls are switched off on this server. Type the request instead.");
      const busy = [...this.calls.values()].find((c) => c.kitchen === kitchen && this.live(c));
      if (busy) throw new DockError(409, "line_busy", "This kitchen's agent is already on a call. Hang up the other call first, or wait for it to end.", undefined, { retryAfterSeconds: Math.ceil(Math.min(busy.expiresAt - t, CALL_LIMITS.staleMs - (t - busy.lastSeen)) / 1000) });
      const hour = [...this.calls.values()].filter((c) => c.mode !== "typed" && t - c.startedAt < 3_600_000);
      if (hour.filter((c) => c.kitchen === kitchen).length >= limits.perKitchenHour) throw new DockError(429, "call_limit", `This kitchen has used its ${limits.perKitchenHour} calls for this hour. Type the request instead.`);
      if (hour.length >= limits.perHour) throw new DockError(429, "call_limit", `The voice line has taken ${limits.perHour} calls this hour, its limit. Type the request instead.`);
      const day = new Date(t).toISOString().slice(0, 10);
      if ((this.days.get(`${day}:${kitchen}`) ?? 0) >= limits.perKitchenDay) throw new DockError(429, "call_limit", `This kitchen has used its ${limits.perKitchenDay} calls for today. Type the request instead.`);
      if ((this.days.get(`${day}:*`) ?? 0) >= limits.perDay) throw new DockError(429, "call_limit", `The voice line has taken ${limits.perDay} calls today, its limit. Type the request instead.`);
      this.days.set(`${day}:${kitchen}`, (this.days.get(`${day}:${kitchen}`) ?? 0) + 1);
      this.days.set(`${day}:*`, (this.days.get(`${day}:*`) ?? 0) + 1);
    }
    const prev = carryFrom ? this.calls.get(carryFrom) : undefined;
    // A call carried on (hung up and continued by typing, called back, reconnected) keeps its desk as it was,
    // including a read-back still waiting for the caller's yes.
    const desk: Desk = prev && prev.kitchen === kitchen ? { ...structuredClone(prev.desk), lastTurnUsed: 0 } : { lastTurnUsed: 0 };
    const call: Call = {
      callId: `call_${randomBytes(9).toString("base64url")}`,
      kitchen,
      mode,
      startedAt: t,
      expiresAt: t + (mode === "typed" ? CALL_LIMITS.typedMs : limits.callSeconds * 1000),
      lastSeen: t,
      toolCalls: 0,
      interprets: 0,
      grounding: { checked: 0, dropped: 0 },
      desk,
    };
    this.calls.set(call.callId, call);
    return call;
  }

  /** The call a tool request belongs to; a voice call must still be live, a typed one within its half hour. */
  use(callId: string, kitchen: string, via: "speech" | "typed"): Call {
    const c = this.calls.get(callId);
    if (!c || c.kitchen !== kitchen) throw new DockError(404, "call_not_found", "No such call for this kitchen. Start a new call.");
    const t = this.now();
    if (via === "speech" && !this.live(c)) throw new DockError(410, "call_over", "This call has ended. Start a new call, or type the request.");
    if (t - c.startedAt > CALL_LIMITS.typedMs + (c.expiresAt - c.startedAt)) throw new DockError(410, "call_over", "This call is too old. Start a new one.");
    if (c.toolCalls >= CALL_LIMITS.toolCalls) throw new DockError(429, "call_tool_limit", `This call has made ${CALL_LIMITS.toolCalls} requests to AimoPilot, its limit. Start a new call.`);
    c.toolCalls += 1;
    c.lastSeen = t;
    return c;
  }

  countInterpret(c: Call) {
    if (c.interprets >= CALL_LIMITS.interprets) throw new DockError(429, "call_interpret_limit", `This call has asked AimoPilot to read ${CALL_LIMITS.interprets} requests, its limit. Start a new call.`);
    c.interprets += 1;
  }

  heartbeat(callId: string, kitchen: string, report?: { usage?: Call["usage"]; grounding?: Call["grounding"] }): Call {
    const c = this.calls.get(callId);
    if (!c || c.kitchen !== kitchen) throw new DockError(404, "call_not_found", "No such call for this kitchen.");
    c.lastSeen = this.now();
    if (report?.usage) c.usage = report.usage;
    if (report?.grounding) {
      recordGroundingChecks("voice", report.grounding.checked - c.grounding.checked); // the operations portal's count (server/grounding.ts)
      c.grounding = report.grounding;
    }
    return c;
  }

  end(callId: string, kitchen: string, reason: string): Call | undefined {
    const c = this.calls.get(callId);
    if (!c || c.kitchen !== kitchen) return undefined;
    if (c.endedAt === undefined && c.mode !== "typed") recordLlmSpend(callCostUsd(c));
    c.endedAt ??= this.now();
    c.endReason ??= reason.slice(0, 80);
    return c;
  }

  get(callId: string): Call | undefined {
    return this.calls.get(callId);
  }

  private prune() {
    const t = this.now();
    // A call whose page went away without hanging up still cost what it used: end it and count its spend.
    for (const c of this.calls.values()) if (c.mode !== "typed" && c.endedAt === undefined && (t >= c.expiresAt || t - c.lastSeen >= CALL_LIMITS.staleMs)) this.end(c.callId, c.kitchen, "stale");
    for (const [id, c] of this.calls) if (t - c.startedAt > 2 * 3_600_000) {
      this.calls.delete(id);
      if (c.endedAt !== undefined && c.mode !== "typed") this.spent.set(new Date(c.startedAt).toISOString().slice(0, 10), (this.spent.get(new Date(c.startedAt).toISOString().slice(0, 10)) ?? 0) + callCostUsd(c));
    }
  }

  /** Voice spend kept for calls already pruned from memory, per UTC day. */
  private spent = new Map<string, number>();

  /** For the presenter: today's voice calls, the lines open now, and what voice has cost today at list prices. */
  usage(limits: ReturnType<typeof voiceLimits>) {
    this.prune();
    const t = this.now();
    const day = new Date(t).toISOString().slice(0, 10);
    const today = [...this.calls.values()].filter((c) => c.mode !== "typed" && new Date(c.startedAt).toISOString().slice(0, 10) === day);
    const byModel: Record<string, { calls: number; usd: number }> = {};
    for (const c of today) {
      const m = (byModel[c.model ?? "unknown"] ??= { calls: 0, usd: 0 });
      m.calls += 1;
      m.usd += c.endedAt !== undefined || c.usage ? callCostUsd(c) : 0;
    }
    const usd = (this.spent.get(day) ?? 0) + Object.values(byModel).reduce((s, m) => s + m.usd, 0);
    return {
      day,
      callsToday: this.days.get(`${day}:*`) ?? 0,
      liveNow: today.filter((c) => this.live(c)).length,
      usdToday: Math.round(usd * 1000) / 1000,
      byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { calls: v.calls, usd: Math.round(v.usd * 1000) / 1000 }])),
      limits: { perKitchenHour: limits.perKitchenHour, perHour: limits.perHour, perKitchenDay: limits.perKitchenDay, perDay: limits.perDay, callSeconds: limits.callSeconds },
    };
  }
}

const g = globalThis as typeof globalThis & { __dockCalls?: CallRegistry };
export function calls(): CallRegistry {
  g.__dockCalls ??= new CallRegistry();
  return g.__dockCalls;
}
