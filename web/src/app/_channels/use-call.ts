"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import type { CallStart } from "@/server/channels/voice/start";
import type { Pending, ToolReply } from "@/server/channels/voice/tools";
import { useLang } from "../_i18n/provider";
import { CallAudio, MIC_TEXT, micProblem, type MicProblem } from "./audio";
import { CALL_HOOK_TEXT } from "./call-screen.text";
import { addFacts, checkSpeech, correctionFor, emptyFacts, type Facts } from "./grounding";
import { LiveSocket, type FunctionCall, type SocketEvents, type VoiceSocket } from "./live-socket";
import { RealtimeSocket } from "./realtime-socket";

/**
 * One call with a kitchen's purchasing agent, from the tap on "Call" to hang-up.
 *
 * The voice model runs in the provider's cloud (Gemini Live or OpenAI Realtime, chosen on the server); its tool
 * calls arrive here and are relayed to this app's server, which runs AimoPilot's intake and composes what the
 * agent may say. This hook attaches what the caller said (the transcript of their last turn) to each tool call,
 * keeps every tool result as the call's facts, and checks the agent's own transcript against them while it speaks.
 *
 * Failures, each with a way forward: the provider refusing the session (quota) moves the call to the other
 * provider; a connection lost mid-call reconnects up to twice with the same request on the desk; the microphone
 * refused or revoked, or nothing reconnecting, continues the same call by typing.
 */

export type Mode = "push_to_talk" | "hands_free";
export type Phase = "idle" | "ringing" | "connected" | "recovering" | "lost" | "ended" | "typed";
/** What the caller sees the call doing right now. */
export type Status = "listening" | "thinking" | "speaking" | "waiting" | "ready" | "paused";
export type Line = { id: number; who: "you" | "agent" | "dock"; text: string; dropped?: string[]; final: boolean };

export type CallView = {
  phase: Phase;
  mode: Mode;
  start?: CallStart;
  secondsLeft?: number;
  lines: Line[];
  talking: boolean;
  latched: boolean;
  agentSpeaking: boolean;
  /** Between the end of the caller's turn and the agent's answer. */
  thinking: boolean;
  /** The system suspended audio (a phone call, the page in the background): a tap resumes it. */
  paused: boolean;
  busy: boolean;
  step?: IntakeView;
  order?: PublicOrder;
  pending?: Pending;
  problem?: { code: string; message: string };
  notice?: string;
  endReason?: string;
  micProblem?: MicProblem;
  /** Estimated cost of this call so far in US dollars (list prices). */
  costUsd: number;
  grounding: { checked: number; dropped: number };
};

export function statusOf(v: CallView): Status {
  if (v.paused) return "paused";
  if (v.talking) return "listening";
  if (v.agentSpeaking) return "speaking";
  if (v.thinking || v.busy) return "thinking";
  if (v.order?.status === "pending_approval") return "waiting";
  return v.mode === "hands_free" ? "listening" : "ready";
}

type Post = <T>(path: string, body: unknown) => Promise<{ ok: boolean; status: number; data: T & { error?: { code: string; message: string } } }>;

const post: Post = async (path, body) => {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { code: "network", message: "No connection to AimoPilot. Check the network and try again." } } as never };
  }
};

const GEMINI_PRICE = { inPerMin: 0.005 };
/** A close before the session is ready whose reason names a quota: try the other provider. */
const QUOTA = /quota|exhaust|rate|limit|429|billing|insufficient/i;

export function useCall(kitchen: string, opts: { onStep?: (s: IntakeView) => void; onOrder?: (o: PublicOrder) => void } = {}) {
  const base = `/ui-api/voice/${encodeURIComponent(kitchen)}`;
  const [v, setV] = useState<CallView>({ phase: "idle", mode: "push_to_talk", lines: [], talking: false, latched: false, agentSpeaking: false, thinking: false, paused: false, busy: false, costUsd: 0, grounding: { checked: 0, dropped: 0 } });
  const set = useCallback((f: Partial<CallView> | ((x: CallView) => Partial<CallView>)) => setV((x) => ({ ...x, ...(typeof f === "function" ? f(x) : f) })), []);
  // Words shown on screen follow the caller's language; what goes to the voice model and the server stays English.
  const { lang } = useLang();
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const say = useCallback(() => CALL_HOOK_TEXT[langRef.current], []);
  const micText = useCallback((p: MicProblem) => (langRef.current === "en" ? MIC_TEXT[p] : (CALL_HOOK_TEXT[langRef.current].mic[p] ?? MIC_TEXT[p])), []);
  /** A failed request's message for the screen: the server's own words, or ours when there are none (or no network). */
  const shown = useCallback((err: { code: string; message: string } | undefined, fallback: string) => {
    if (err?.message == null) return fallback;
    if (err.code === "network" && langRef.current !== "en") return CALL_HOOK_TEXT[langRef.current].network;
    return err.message;
  }, []);

  const audio = useRef<CallAudio | null>(null);
  const sock = useRef<VoiceSocket | null>(null);
  const callId = useRef<string | null>(null);
  const facts = useRef<Facts>(emptyFacts());
  const brands = useRef<string[]>([]);
  const lineId = useRef(0);
  const turn = useRef(0);
  const heardOpen = useRef(false);
  const heard = useRef("");
  /** The provider's final transcript of the caller's current turn, when it sends one (OpenAI). */
  const heardFinal = useRef<string | undefined>(undefined);
  const lastHeardAt = useRef(0);
  const said = useRef({ id: -1, text: "", flagged: new Set<string>() });
  const tokens = useRef({ prompt: 0, response: 0, usd: 0 });
  const grounding = useRef({ checked: 0, dropped: 0 });
  const pressAt = useRef(0);
  const latched = useRef(false);
  const modeRef = useRef<Mode>("push_to_talk");
  const timers = useRef<number[]>([]);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
  const reconnects = useRef(0);
  const warned = useRef(false);
  const onStep = useRef(opts.onStep);
  const onOrder = useRef(opts.onOrder);
  useEffect(() => {
    onStep.current = opts.onStep;
    onOrder.current = opts.onOrder;
  });

  const addLine = useCallback(
    (who: Line["who"], text: string, final = true): number => {
      const id = ++lineId.current;
      set((x) => ({ lines: [...x.lines.slice(-60), { id, who, text, final }] }));
      return id;
    },
    [set],
  );
  const patchLine = useCallback((id: number, f: (l: Line) => Line) => set((x) => ({ lines: x.lines.map((l) => (l.id === id ? f(l) : l)) })), [set]);

  const screen = useCallback(
    (r: ToolReply) => {
      addFacts(facts.current, r.forModel);
      set((x) => ({
        step: r.screen.step ?? (r.screen.pending ? undefined : x.step),
        order: r.screen.order ?? (r.screen.step && r.screen.step.requestId !== x.step?.requestId ? undefined : x.order),
        pending: r.screen.pending ?? (r.screen.step ? undefined : x.pending),
        problem: r.screen.problem,
      }));
      if (r.screen.step) onStep.current?.(r.screen.step);
      if (r.screen.order) onOrder.current?.(r.screen.order);
    },
    [set],
  );

  // OpenAI: the socket adds up each response's usage at list prices. Gemini: every prompt token at the text rate
  // (the whole context is re-read each turn), audio input on top at its per-minute rate, response tokens at the
  // audio-out rate (the replies are audio). Errs high.
  const cost = useCallback(() => {
    const a = audio.current;
    if (tokens.current.usd > 0) return tokens.current.usd;
    return tokens.current.prompt * 0.75e-6 + tokens.current.response * 12e-6 + (a ? (a.seconds.in / 60) * GEMINI_PRICE.inPerMin : 0);
  }, []);

  /** Close the voice session; `keepAudio` keeps the microphone and speaker for a reconnect. */
  const cleanup = useCallback((keepAudio = false) => {
    for (const t of timers.current) window.clearInterval(t);
    timers.current = [];
    stopRing.current?.();
    stopRing.current = null;
    sock.current?.close();
    sock.current = null;
    if (keepAudio) return;
    audio.current?.close();
    audio.current = null;
    void wake.current?.release().catch(() => {});
    wake.current = null;
  }, []);

  const hangUp = useCallback(
    (reason = "hung up", phase: Phase = "ended") => {
      const id = callId.current;
      if (id) void post(`${base}/call/${id}`, { op: "end", reason });
      cleanup();
      set({ phase, talking: false, latched: false, agentSpeaking: false, thinking: false, paused: false, endReason: reason, costUsd: cost() });
    },
    [base, cleanup, cost, set],
  );

  // ---------- the agent's tool calls ----------

  const runTools = useCallback(
    async (fcs: FunctionCall[]) => {
      set({ busy: true, thinking: true });
      // The caller's last words may still be arriving as transcript: wait for the final transcript when the
      // provider sends one, otherwise until it has been quiet for 400 ms (at most 3 s either way).
      const s0 = sock.current;
      for (let i = 0; i < 30; i++) {
        const settled = s0?.finalTranscripts ? heardFinal.current !== undefined && Date.now() - lastHeardAt.current > 100 : Date.now() - lastHeardAt.current > 400;
        if (settled) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const responses: { id: string; name: string; response: unknown }[] = [];
      for (const fc of fcs) {
        const words = (heardFinal.current ?? heard.current).trim();
        const r = await post<ToolReply>(`${base}/tool`, { callId: callId.current, name: fc.name, args: fc.args ?? {}, heard: words ? { text: words, turn: turn.current } : undefined, via: "speech" });
        let reply: ToolReply;
        if (r.ok) reply = r.data;
        else {
          const message = r.data.error?.message ?? "AimoPilot could not be reached.";
          const onScreen = shown(r.data.error, say().unreachable);
          reply = { forModel: { ok: false, state: "error", say: `AimoPilot could not do that: ${message}` }, screen: { problem: { code: r.data.error?.code ?? "error", message: onScreen } } };
        }
        screen(reply);
        responses.push({ id: fc.id, name: fc.name, response: reply.forModel });
      }
      heardOpen.current = false;
      sock.current?.toolResponse(responses);
      set({ busy: false });
    },
    [base, screen, set, say, shown],
  );

  // ---------- grounding: the agent's words against the facts ----------

  const checkSaid = useCallback(
    (final: boolean) => {
      const s = said.current;
      if (!s.text.trim()) return;
      grounding.current.checked += final ? 1 : 0;
      const fresh = checkSpeech(s.text, facts.current, { brands: brands.current, final }).filter((x) => !s.flagged.has(`${x.kind}:${x.said}`));
      if (!fresh.length) return;
      for (const x of fresh) s.flagged.add(`${x.kind}:${x.said}`);
      audio.current?.stopPlayback();
      grounding.current.dropped += 1;
      patchLine(s.id, (l) => ({ ...l, dropped: [...(l.dropped ?? []), ...fresh.map((x) => x.said)] }));
      set({ grounding: { ...grounding.current } });
      sock.current?.text(correctionFor(fresh));
      if (callId.current) void post(`${base}/call/${callId.current}`, { op: "dropped", said: fresh.map((x) => x.said).join(", "), kinds: [...new Set(fresh.map((x) => x.kind))] });
    },
    [base, patchLine, set],
  );

  const startTyped = useCallback(
    async (mic: MicProblem | undefined, message: string, carryFrom?: string) => {
      const r = await post<CallStart>(`${base}/call`, { mode: "typed", carryFrom: carryFrom ?? callId.current ?? undefined });
      if (!r.ok) {
        set({ phase: "ended", micProblem: mic, endReason: `${message} ${r.data.error?.message ?? ""}`.trim() });
        return;
      }
      callId.current = r.data.callId;
      set({ phase: "typed", start: r.data, micProblem: mic, notice: message, talking: false, latched: false, thinking: false, paused: false });
    },
    [base, set],
  );

  // ---------- the voice session ----------

  /** The socket's events, wired to this call. `s` is read lazily: events only arrive after construction. */
  const events = useCallback(
    (start: CallStart, a: CallAudio, self: () => VoiceSocket | null, onLost: (info: { code: number; reason: string }) => void, greeting: string): SocketEvents => ({
      onReady: () => {
        stopRing.current?.();
        stopRing.current = null;
        set({ phase: "connected", notice: undefined });
        self()?.text(greeting);
        if (modeRef.current === "hands_free") a.setSending(true);
      },
      onAudio: (b64) => {
        set((x) => (x.thinking ? { thinking: false } : {}));
        a.play(b64);
      },
      onHeard: (t) => {
        lastHeardAt.current = Date.now();
        if (!heardOpen.current && modeRef.current === "hands_free") {
          turn.current += 1;
          heard.current = "";
          heardFinal.current = undefined;
        }
        heardOpen.current = true;
        heard.current = `${heard.current}${t}`;
        const text = heard.current.trim();
        set((x) => {
          const last = x.lines.at(-1);
          if (last && last.who === "you" && !last.final) return { lines: x.lines.map((l) => (l.id === last.id ? { ...l, text } : l)) };
          return { lines: [...x.lines.slice(-60), { id: ++lineId.current, who: "you", text, final: false }] };
        });
      },
      onHeardFinal: (t) => {
        lastHeardAt.current = Date.now();
        heardFinal.current = t;
        const text = t.trim();
        if (!text) return;
        set((x) => {
          const last = [...x.lines].reverse().find((l) => l.who === "you");
          if (last && !last.final) return { lines: x.lines.map((l) => (l.id === last.id ? { ...l, text } : l)) };
          return { lines: [...x.lines.slice(-60), { id: ++lineId.current, who: "you", text, final: false }] };
        });
      },
      onSaid: (t) => {
        heardOpen.current = false;
        if (said.current.id < 0) said.current = { id: addLine("agent", "", false), text: "", flagged: new Set() };
        said.current.text += t.replace(/<\/?[a-z_]{2,20}>/gi, ""); // control tokens the transcript sometimes carries ("<stop>")
        const text = said.current.text;
        patchLine(said.current.id, (l) => ({ ...l, text }));
        checkSaid(false);
      },
      onTurnComplete: () => {
        if (said.current.id >= 0) {
          checkSaid(true);
          patchLine(said.current.id, (l) => ({ ...l, final: true }));
        }
        said.current = { id: -1, text: "", flagged: new Set() };
        set((x) => ({ lines: x.lines.map((l) => (l.who === "you" ? { ...l, final: true } : l)), costUsd: cost(), thinking: x.busy }));
      },
      onInterrupted: () => a.stopPlayback(),
      onToolCall: (fcs) => void runTools(fcs),
      onCancelled: () => {},
      onUsage: (u) => {
        tokens.current = { prompt: tokens.current.prompt + u.promptTokens, response: tokens.current.response + u.responseTokens, usd: tokens.current.usd + (u.costUsd ?? 0) };
      },
      onGoAway: () => set({ notice: say().goAway }),
      onError: (code) => {
        if (/rate_limit/.test(code)) set({ notice: say().rateLimited });
      },
      onClose: ({ clean, code, reason }) => {
        if (clean || self() === null) return;
        onLost({ code, reason });
      },
    }),
    [set, addLine, patchLine, checkSaid, cost, runTools, say],
  );

  /** Open the voice session for a started call. Resolves once the socket is made (not yet ready). */
  const connect = useCallback(
    (start: CallStart, a: CallAudio, greeting: string, onLost: (info: { code: number; reason: string; ready: boolean }) => void) => {
      const live = start.live!;
      a.rate = live.inputRate;
      let s: VoiceSocket | null = null;
      let everReady = false;
      const ev = events(start, a, () => s, (info) => onLost({ ...info, ready: everReady }), greeting);
      const onReady = ev.onReady;
      ev.onReady = () => {
        everReady = true;
        reconnects.current = 0;
        onReady();
      };
      s = live.provider === "openai" ? new RealtimeSocket(live.wsUrl, live.token, live.model, ev) : new LiveSocket(live.wsUrl, live.token, live.model, ev);
      sock.current = s;
      const ends = Date.parse(start.expiresAt);
      timers.current.push(
        window.setInterval(() => {
          const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
          set({ secondsLeft: left, costUsd: cost() });
          if (left <= 30 && left > 0 && !warned.current) {
            warned.current = true;
            set({ notice: say().thirtySeconds });
          }
          if (left <= 0) hangUp("time limit");
        }, 1000),
        window.setInterval(() => {
          const id = callId.current;
          if (!id) return;
          const au = audio.current;
          void post(`${base}/call/${id}`, { op: "beat", usage: { audioInSeconds: au?.seconds.in ?? 0, audioOutSeconds: au?.seconds.out ?? 0, promptTokens: tokens.current.prompt, responseTokens: tokens.current.response, ...(tokens.current.usd ? { costUsd: tokens.current.usd } : {}) }, grounding: grounding.current }).then((res) => {
            if (res.status === 404 || res.status === 410) hangUp("ended by the server");
          });
        }, 10_000),
      );
      return s;
    },
    [base, events, set, cost, hangUp, say],
  );

  /** Start a call (or a reconnect: `again` keeps the microphone open and the desk's request). */
  const dial = useCallback(
    async (mode: Mode, carryFrom: string | undefined, a: CallAudio, why: { avoid?: string; reconnect?: boolean }) => {
      const r = await post<CallStart>(`${base}/call`, { mode, carryFrom, ...(why.avoid ? { avoid: why.avoid } : {}) });
      if (!r.ok || !r.data.live) {
        cleanup();
        await startTyped(undefined, shown(r.data.error, say().couldNotStart), carryFrom);
        return;
      }
      const start = r.data;
      callId.current = start.callId;
      brands.current = start.brands;
      addFacts(facts.current, start.context);
      set({ start, secondsLeft: start.maxSeconds });
      const greeting = why.reconnect
        ? `[call reconnected] The connection dropped and is back. The caller is ${start.kitchen.name}. Say in one short sentence that you are back, then call check_order and say where things stand.`
        : `[call connected] The caller is ${start.kitchen.name}.`;
      const s = connect(start, a, greeting, ({ code, reason, ready }) => {
        if (sock.current !== s) return;
        // The provider refused the session before it started (free-tier quota, outage): the other provider.
        if (!ready && QUOTA.test(reason) && !why.avoid) {
          cleanup(true);
          void post(`${base}/call/${start.callId}`, { op: "end", reason: `refused ${code}` });
          set({ notice: say().switching });
          void dial(mode, start.callId, a, { avoid: start.live!.provider, reconnect: why.reconnect });
          return;
        }
        void post(`${base}/call/${start.callId}`, { op: "end", reason: `lost ${code}` });
        const timeUp = code === 1008 || /expire|deadline/i.test(reason);
        if (!timeUp && reconnects.current < 2) {
          // Lost mid-call: reconnect with the same request on the desk.
          reconnects.current += 1;
          cleanup(true);
          set({ phase: "recovering", talking: false, latched: false, agentSpeaking: false, thinking: false, notice: say().recovering });
          window.setTimeout(() => void dial(mode, start.callId, a, { reconnect: true }), 800 * reconnects.current);
          return;
        }
        cleanup();
        set({ phase: "lost", talking: false, latched: false, agentSpeaking: false, thinking: false, endReason: timeUp ? say().timeLimit : say().lost });
      });
      // A provider that accepts the socket but does not start the session in 6 s (seen on Gemini's free tier under
      // load): try the other provider once. If nothing connects in 12 s (blocked WebSocket, captive portal), type.
      window.setTimeout(() => {
        if (sock.current === s && !s.ready && !why.avoid) {
          cleanup(true);
          void post(`${base}/call/${start.callId}`, { op: "end", reason: "slow start" });
          set({ notice: say().switching });
          void dial(mode, start.callId, a, { avoid: start.live!.provider, reconnect: why.reconnect });
        }
      }, 6_000);
      window.setTimeout(() => {
        if (sock.current === s && !s.ready) {
          cleanup();
          void post(`${base}/call/${start.callId}`, { op: "end", reason: "connect timeout" });
          void startTyped(undefined, say().noVoice, start.callId);
        }
      }, 12_000);
    },
    [base, cleanup, connect, set, shown, say, startTyped],
  );

  /** Must run inside the tap on "Call": iOS opens the microphone and plays audio only from a user gesture. */
  const call = useCallback(
    async (mode: Mode, carryFrom?: string) => {
      cleanup();
      modeRef.current = mode;
      facts.current = emptyFacts();
      turn.current = 0;
      heard.current = "";
      heardFinal.current = undefined;
      reconnects.current = 0;
      warned.current = false;
      tokens.current = { prompt: 0, response: 0, usd: 0 };
      grounding.current = { checked: 0, dropped: 0 };
      set({ phase: "ringing", mode, lines: [], notice: undefined, problem: undefined, micProblem: undefined, endReason: undefined, talking: false, latched: false, thinking: false, paused: false, grounding: { checked: 0, dropped: 0 } });
      let a: CallAudio;
      try {
        a = new CallAudio(
          (b64) => sock.current?.audio(b64),
          (speaking) => {
            set({ agentSpeaking: speaking });
            // Hands-free on a phone: half-duplex, so the speaker never feeds the agent its own voice.
            if (modeRef.current === "hands_free" && audio.current) {
              if (speaking) audio.current.setSending(false);
              else window.setTimeout(() => audio.current && !audio.current.speaking && audio.current.setSending(true), 300);
            }
          },
        );
        audio.current = a;
        stopRing.current = a.ring();
        await a.openMic();
      } catch (err) {
        cleanup();
        const p = micProblem(err);
        console.warn("microphone:", (err as Error)?.name, (err as Error)?.message);
        await startTyped(p, micText(p), carryFrom);
        return;
      }
      // The microphone taken away mid-call (permission revoked in settings, another app): the same call by typing.
      a.onMicEnded = () => {
        if (audio.current !== a) return;
        const id = callId.current ?? undefined;
        if (id) void post(`${base}/call/${id}`, { op: "end", reason: "microphone ended" });
        cleanup();
        void startTyped("failed", say().micEnded, id);
      };
      // A phone call or Siri suspends the page's audio; show it and resume on the next tap.
      a.onAudioState = (state) => set({ paused: state === "interrupted" || (state === "suspended" && document.visibilityState === "visible") });
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wake.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* no wake lock: the screen may dim; the call survives a short lock on most phones */
      }
      await dial(mode, carryFrom, a, {});
    },
    [base, cleanup, set, startTyped, micText, dial, say],
  );

  /** Type instead of speaking: the same tools, with the typed words as the caller's own. */
  const typed = useCallback(
    async (name: string, args: Record<string, unknown>, text: string) => {
      if (!callId.current) return;
      set({ busy: true });
      if (text) addLine("you", text);
      turn.current += 1;
      const r = await post<ToolReply>(`${base}/tool`, { callId: callId.current, name, args, heard: text ? { text, turn: turn.current } : undefined, via: "typed" });
      set({ busy: false });
      if (!r.ok) {
        set({ problem: { code: r.data.error?.code ?? "error", message: shown(r.data.error, say().couldNotDo) } });
        return;
      }
      screen(r.data);
      // On screen the cards carry the detail: the transcript gets AimoPilot's first sentence only.
      addLine("dock", r.data.forModel.say.split(/(?<=[.:])\s/)[0]);
    },
    [addLine, base, screen, set, say, shown],
  );

  /** A tap on a card during a call or a typed call: the same step, then the agent is told what happened. */
  const tap = useCallback(
    async (name: string, args: Record<string, unknown>, label: string) => {
      if (!callId.current) return;
      audio.current?.resume();
      set({ busy: true });
      addLine("you", say().tapped(label));
      const live = !!sock.current?.open;
      const r = await post<ToolReply>(`${base}/tool`, { callId: callId.current, name, args, via: live ? "speech" : "typed", tapped: true });
      set({ busy: false });
      if (!r.ok) {
        set({ problem: { code: r.data.error?.code ?? "error", message: shown(r.data.error, say().couldNotDo) } });
        return;
      }
      screen(r.data);
      if (live) sock.current!.text(`[AimoPilot update] The caller tapped "${label}" on the screen. AimoPilot's reply: ${JSON.stringify(r.data.forModel)}`);
      else addLine("dock", r.data.forModel.say);
    },
    [addLine, base, screen, set, say, shown],
  );

  // ---------- push-to-talk ----------

  const pressTalk = useCallback(() => {
    const a = audio.current;
    const s = sock.current;
    if (!a || !s?.ready) return;
    a.resume();
    set((x) => (x.paused ? { paused: false } : {}));
    if (latched.current) {
      // A second tap ends a tapped (latched) turn.
      latched.current = false;
      a.setSending(false);
      s.activityEnd();
      set({ talking: false, latched: false, thinking: true });
      return;
    }
    pressAt.current = Date.now();
    a.stopPlayback();
    turn.current += 1;
    heard.current = "";
    heardFinal.current = undefined;
    s.activityStart();
    a.setSending(true);
    set({ talking: true, thinking: false });
  }, [set]);

  const releaseTalk = useCallback(() => {
    const a = audio.current;
    const s = sock.current;
    if (!a || !s || !a.isSending || latched.current) return;
    if (Date.now() - pressAt.current < 350) {
      // A quick tap: keep listening until the next tap (hands busy, one tap to start, one to stop).
      latched.current = true;
      set({ latched: true });
      return;
    }
    a.setSending(false);
    s.activityEnd();
    set({ talking: false, thinking: true });
  }, [set]);

  /** A tap anywhere while the system has paused audio (after a phone call): resume it. */
  const resume = useCallback(() => {
    audio.current?.resume();
    set({ paused: false });
  }, [set]);

  // ---------- waiting for sign-off ----------

  const orderId = v.order?.orderId;
  const waiting = v.order?.status === "pending_approval";
  useEffect(() => {
    if (!orderId || !waiting) return;
    const t = window.setInterval(async () => {
      const id = callId.current;
      if (!id) return;
      const r = await post<{ order: PublicOrder | null; forModel?: ToolReply["forModel"] }>(`${base}/call/${id}`, { op: "order" });
      const o = r.ok ? r.data.order : null;
      if (!o || o.status === "pending_approval") return;
      set({ order: o });
      onOrder.current?.(o);
      if (r.data.forModel) {
        addFacts(facts.current, r.data.forModel);
        if (sock.current?.open) sock.current.text(`[AimoPilot update] ${r.data.forModel.say} Tell the caller in one sentence.`);
        else addLine("dock", r.data.forModel.say);
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [orderId, waiting, base, set, addLine]);

  // The screen locks or the tab goes to the background: stop a held turn; the call may be dropped by the phone.
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === "hidden") {
        if (audio.current?.isSending && modeRef.current === "push_to_talk") {
          audio.current.setSending(false);
          sock.current?.activityEnd();
          latched.current = false;
          set({ talking: false, latched: false });
        }
      } else {
        audio.current?.resume();
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (sock.current?.open && !wake.current) void nav.wakeLock?.request("screen").then((w) => (wake.current = w)).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [set]);

  useEffect(
    () => () => {
      const id = callId.current;
      if (id && sock.current) void navigator.sendBeacon?.(`${base}/call/${id}`, new Blob([JSON.stringify({ op: "end", reason: "page closed" })], { type: "application/json" }));
      cleanup();
    },
    [base, cleanup],
  );

  const typeInstead = useCallback(() => {
    const id = callId.current ?? undefined;
    if (sock.current && id) void post(`${base}/call/${id}`, { op: "end", reason: "typing instead" });
    cleanup();
    return startTyped(undefined, say().typing, id);
  }, [base, cleanup, startTyped, say]);

  return { view: v, status: statusOf(v), call, hangUp, typeInstead, pressTalk, releaseTalk, resume, typed, tap, callId: () => callId.current, level: () => audio.current?.level ?? 0 };
}
