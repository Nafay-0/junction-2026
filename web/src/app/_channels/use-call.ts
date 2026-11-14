"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallStart } from "@/server/channels/voice/start";
import type { Spoken } from "@/server/thread/voice-bridge";
import { useLang } from "../_i18n/provider";
import { CallAudio, micProblem, type MicProblem } from "./audio";
import { addFacts, checkSpeech, correctionFor, emptyFacts, type Facts } from "./grounding";
import { LiveSocket, type FunctionCall, type SocketEvents, type VoiceSocket } from "./live-socket";
import { RealtimeSocket } from "./realtime-socket";
import { VOICE_MODE_TEXT } from "./voice-mode.text";

/**
 * Talking to the kitchen's agent, hands-free, in the kitchen's own conversation (docs/doors.md). One mode only: tap
 * the microphone once, talk naturally, the agent talks back, talk over it to interrupt.
 *
 * The voice model (Gemini Live, or OpenAI Realtime as the fallback) runs in the provider's cloud and is only the ears
 * and the mouth: its one tool, relay, arrives here, and this hook sends the buyer's words AS HEARD (the live
 * transcript, never the model's rendering) to this app's server, which puts them into the same conversation as typed
 * words (thread/voice-bridge.ts). What comes back (a short true acknowledgement, milestones of long work, the reply,
 * a sign-off decided) is given to the voice model to say, word for word; the grounding check cuts it off if it says
 * a figure it was not given.
 *
 * Failures, each said plainly: microphone refused (once, with how to allow it); the line lost mid-call (reconnect once,
 * then the other provider, then "voice is not available": the typed conversation stays exactly where it was); the
 * screen locked or the page in the background; the time limit; the server's caps.
 */

export type Phase = "idle" | "starting" | "live" | "reconnecting" | "ended";
/** What the buyer sees the call doing right now. */
export type Status = "starting" | "listening" | "hearing" | "working" | "speaking" | "waiting" | "reconnecting" | "muted" | "paused";

export type CallView = {
  phase: Phase;
  muted: boolean;
  /** The buyer's words being heard now (not yet sent), and what the agent is saying now. */
  heard: string;
  saying: string;
  agentSpeaking: boolean;
  /** The engine is working on something the buyer said; `waitingFor`: a named person's OK. */
  working: boolean;
  waitingFor?: string;
  paused: boolean;
  notice?: string;
  endReason?: string;
  micProblem?: MicProblem;
  secondsLeft?: number;
  costUsd: number;
  provider?: string;
};

/** One utterance's timings, in ms from the end of the buyer's speech (the last transcript word heard). */
export type Timing = { turn: number; words: string; toolCall?: number; firstSound?: number; replySound?: number; replyDone?: number };

export function statusOf(v: CallView): Status {
  if (v.phase === "starting") return "starting";
  if (v.phase === "reconnecting") return "reconnecting";
  if (v.paused) return "paused";
  if (v.agentSpeaking) return "speaking";
  if (v.heard) return "hearing";
  if (v.working) return "working";
  if (v.waitingFor) return "waiting";
  if (v.muted) return "muted";
  return "listening";
}

type Post = <T>(path: string, body: unknown) => Promise<{ ok: boolean; status: number; data: T & { error?: { code: string; message: string } } }>;

const post: Post = async (path, body) => {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { code: "network", message: "" } } as never };
  }
};

/** A close before the session is ready whose reason names a quota: the other provider. */
const QUOTA = /quota|exhaust|rate|limit|429|billing|insufficient/i;

export function useCall(kitchen: string) {
  const base = `/ui-api/voice/${encodeURIComponent(kitchen)}`;
  const [v, setV] = useState<CallView>({ phase: "idle", muted: false, heard: "", saying: "", agentSpeaking: false, working: false, paused: false, costUsd: 0 });
  const set = useCallback((f: Partial<CallView> | ((x: CallView) => Partial<CallView>)) => setV((x) => ({ ...x, ...(typeof f === "function" ? f(x) : f) })), []);
  const { lang } = useLang();
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const tx = useCallback(() => VOICE_MODE_TEXT[langRef.current], []);

  const audio = useRef<CallAudio | null>(null);
  const sock = useRef<VoiceSocket | null>(null);
  const callId = useRef<string | null>(null);
  const facts = useRef<Facts>(emptyFacts());
  const brands = useRef<string[]>([]);
  /** The buyer's utterances: a number each, never reset during a conversation (the server refuses one used twice). */
  const turn = useRef(0);
  const heardOpen = useRef(false);
  const heard = useRef("");
  const heardFinal = useRef<string | undefined>(undefined);
  const lastHeardAt = useRef(0);
  /** The buyer began this utterance while the door's own question was still playing; while the agent spoke at all. */
  const overlap = useRef(false);
  const duringAgent = useRef(false);
  const said = useRef({ text: "", flagged: new Set<string>() });
  /** The last thing the door gave the voice model to say, and whether it asked a question. */
  const lastAsk = useRef(false);
  /** The voice model is in the middle of a turn of its own (speaking, or about to): nothing is given to it then. */
  const modelTurnOpen = useRef(false);
  const modelTurnAt = useRef(0);
  const queue = useRef<string[]>([]);
  const tokens = useRef({ prompt: 0, response: 0, usd: 0 });
  const grounding = useRef({ checked: 0, dropped: 0 });
  const timers = useRef<number[]>([]);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
  const mutedRef = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const ending = useRef<"goodbye" | null>(null);
  const following = useRef(new Set<string>());
  const timings = useRef<Timing[]>([]);
  const replyFor = useRef<{ turn: number; at: number } | null>(null);
  const speaking = useRef<(on: boolean) => void>(() => {});
  const dialRef = useRef<(carryFrom: string | undefined, a: CallAudio, why: { avoid?: string; reconnect?: boolean }) => Promise<void>>(async () => {});
  const warned = useRef(false);
  /** `flush` tries again later through a ref (it is declared with useCallback). */
  const flushRef = useRef<() => void>(() => {});

  const timing = useCallback((t: number, patch: Partial<Timing>) => {
    const x = timings.current.find((y) => y.turn === t);
    if (x) Object.assign(x, patch);
    (window as unknown as { __dockVoiceTimings?: Timing[] }).__dockVoiceTimings = timings.current;
  }, []);

  const cost = useCallback(() => {
    const a = audio.current;
    if (tokens.current.usd > 0) return tokens.current.usd;
    return tokens.current.prompt * 0.75e-6 + tokens.current.response * 12e-6 + (a ? (a.seconds.in / 60) * 0.005 : 0);
  }, []);

  /** Close the voice session; `keepAudio` keeps the microphone and speaker for a reconnect. */
  const cleanup = useCallback((keepAudio = false) => {
    for (const t of timers.current) window.clearInterval(t);
    timers.current = [];
    stopRing.current?.();
    stopRing.current = null;
    sock.current?.close();
    sock.current = null;
    queue.current = [];
    modelTurnOpen.current = false;
    if (keepAudio) return;
    audio.current?.close();
    audio.current = null;
    void wake.current?.release().catch(() => {});
    wake.current = null;
  }, []);

  /** End the call. `reason` is the plain sentence the buyer is shown (undefined: they hung up themselves). */
  const hangUp = useCallback(
    (reason?: string, log = "hung up") => {
      const id = callId.current;
      if (id) void post(`${base}/call/${id}`, { op: "end", reason: log });
      cleanup();
      following.current.clear();
      set({ phase: "ended", heard: "", saying: "", agentSpeaking: false, working: false, waitingFor: undefined, paused: false, endReason: reason, notice: undefined, costUsd: cost() });
    },
    [base, cleanup, cost, set],
  );

  // ---------- the mouth: what the door gives the voice model to say ----------

  /** Say this once the voice model is quiet (never over its own words), word for word. */
  const flush = useCallback(() => {
    const s = sock.current;
    if (!s?.open || !queue.current.length) return;
    // A turn that never completed (no audio, no turnComplete) does not hold the queue for longer than 8 s.
    if ((modelTurnOpen.current && Date.now() - modelTurnAt.current < 8_000) || audio.current?.speaking) {
      window.setTimeout(() => flushRef.current(), 400);
      return;
    }
    const next = queue.current.shift()!;
    modelTurnOpen.current = true;
    modelTurnAt.current = Date.now();
    s.text(`[AimoPilot] ${next}`);
  }, []);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  const utter = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      addFacts(facts.current, { say: text });
      lastAsk.current = /\?\s*$/.test(text.trim());
      queue.current.push(text);
      flush();
    },
    [flush],
  );

  // ---------- the ears: the buyer's words into the conversation ----------

  /** Follow one agent turn until its reply is said: milestones while it works, the reply, then a sign-off decided. */
  const follow = useCallback(
    async (agentTurnId: string, forTurn: number) => {
      if (following.current.has(agentTurnId)) return;
      following.current.add(agentTurnId);
      try {
        for (let i = 0; i < 40 && callId.current && following.current.has(agentTurnId); i++) {
          const r = await post<Spoken>(`${base}/call/${callId.current}`, { op: "next", agentTurnId, waitMs: 15_000 });
          if (!r.ok) {
            if (r.status === 404 || r.status === 410) return;
            await new Promise((res) => setTimeout(res, 1000));
            continue;
          }
          const s = r.data;
          if (s.facts) addFacts(facts.current, s.facts);
          if (s.say) {
            if (s.state !== "working") replyFor.current = { turn: forTurn, at: Date.now() };
            utter(s.say);
          }
          if (s.state === "waiting") {
            set({ working: false, ...(s.waitingFor ? { waitingFor: s.waitingFor } : {}) });
            continue;
          }
          if (s.state === "reply" || s.state === "ignored") {
            set({ working: false, waitingFor: undefined });
            return;
          }
        }
      } finally {
        following.current.delete(agentTurnId);
      }
    },
    [base, set, utter],
  );

  const onRelay = useCallback(
    async (fcs: FunctionCall[]) => {
      // The buyer's last words may still be arriving as transcript: wait for the final transcript when the provider
      // sends one, otherwise until it has been quiet for 300 ms (at most 2 s).
      const s0 = sock.current;
      for (let i = 0; i < 20; i++) {
        const settled = s0?.finalTranscripts ? heardFinal.current !== undefined && Date.now() - lastHeardAt.current > 100 : Date.now() - lastHeardAt.current > 300;
        if (settled) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const words = (heardFinal.current ?? heard.current).trim();
      const t = turn.current;
      const wasOverlap = overlap.current;
      const wasDuring = duringAgent.current;
      heardOpen.current = false;
      overlap.current = false;
      timing(t, { toolCall: Date.now() - lastHeardAt.current });
      set({ heard: "" });
      const responses: { id: string; name: string; response: unknown }[] = [];
      for (const fc of fcs) {
        if (fc.name !== "relay") {
          responses.push({ id: fc.id, name: fc.name, response: { say: "", note: "There is no such tool. Only relay exists." } });
          continue;
        }
        if (!words) {
          responses.push({ id: fc.id, name: fc.name, response: { say: tx().notCaught } });
          continue;
        }
        set({ working: true });
        const r = await post<Spoken>(`${base}/call/${callId.current}`, { op: "heard", text: words, turn: t, modelWords: typeof fc.args?.words === "string" ? fc.args.words.slice(0, 2000) : undefined, overlap: wasOverlap, duringAgent: wasDuring, lang: langRef.current });
        if (!r.ok) {
          set({ working: false });
          const msg = r.data.error?.message || tx().network;
          responses.push({ id: fc.id, name: fc.name, response: { say: msg } });
          if (r.status === 429 || r.status === 410) window.setTimeout(() => hangUp(msg, r.data.error?.code ?? "refused"), 4000);
          continue;
        }
        const sp = r.data;
        if (sp.facts) addFacts(facts.current, sp.facts);
        if (sp.say) addFacts(facts.current, { say: sp.say });
        lastAsk.current = /\?\s*$/.test(sp.say.trim());
        responses.push({ id: fc.id, name: fc.name, response: { say: sp.say } });
        if (sp.state === "reply" || sp.state === "asked" || sp.state === "stopped" || sp.state === "goodbye") replyFor.current = { turn: t, at: Date.now() };
        if (sp.state === "goodbye") ending.current = "goodbye";
        if ((sp.state === "working" || sp.state === "waiting") && sp.agentTurnId) void follow(sp.agentTurnId, t);
        else set({ working: false });
      }
      // The voice model will speak what it was given (nothing is given to it meanwhile); an empty answer it will not.
      modelTurnOpen.current = responses.some((x) => !!(x.response as { say?: string }).say);
      modelTurnAt.current = Date.now();
      sock.current?.toolResponse(responses);
    },
    [base, follow, hangUp, set, timing, tx],
  );

  // ---------- grounding: the voice model's words against what it was given ----------

  const checkSaid = useCallback(
    (final: boolean) => {
      const s = said.current;
      if (!s.text.trim()) return;
      grounding.current.checked += final ? 1 : 0;
      const fresh = checkSpeech(s.text, facts.current, { brands: brands.current, final }).filter((x) => !s.flagged.has(`${x.kind}:${x.said}`));
      if (!fresh.length) return;
      for (const x of fresh) s.flagged.add(`${x.kind}:${x.said}`);
      audio.current?.stopPlayback();
      sock.current?.stopSpeaking?.();
      grounding.current.dropped += 1;
      sock.current?.text(correctionFor(fresh));
      if (callId.current) void post(`${base}/call/${callId.current}`, { op: "dropped", said: fresh.map((x) => x.said).join(", "), kinds: [...new Set(fresh.map((x) => x.kind))] });
    },
    [base],
  );

  // ---------- the voice session ----------

  const events = useCallback(
    (a: CallAudio, self: () => VoiceSocket | null, onLost: (info: { code: number; reason: string }) => void, greeting: () => void): SocketEvents => ({
      onReady: () => {
        stopRing.current?.();
        stopRing.current = null;
        set({ phase: "live", notice: undefined });
        a.setSending(!mutedRef.current);
        self()?.setSending?.(!mutedRef.current);
        greeting();
      },
      onAudio: (b64) => {
        const r = replyFor.current;
        if (r) {
          timing(r.turn, { replySound: Date.now() - (lastHeardAt.current || r.at) });
          replyFor.current = null;
        }
        const last = timings.current.at(-1);
        if (last && last.firstSound === undefined) timing(last.turn, { firstSound: Date.now() - lastHeardAt.current });
        a.play(b64);
      },
      onHeard: (t) => {
        lastHeardAt.current = Date.now();
        if (!heardOpen.current) {
          // A new utterance: its own number; begun over the door's own question, it is marked so.
          turn.current += 1;
          heard.current = "";
          heardFinal.current = undefined;
          duringAgent.current = !!audio.current?.speaking;
          overlap.current = duringAgent.current && lastAsk.current;
          timings.current.push({ turn: turn.current, words: "" });
          if (timings.current.length > 50) timings.current.shift();
        }
        heardOpen.current = true;
        heard.current = `${heard.current}${t}`;
        timing(turn.current, { words: heard.current.trim().slice(0, 120) });
        set({ heard: heard.current.trim() });
      },
      onHeardFinal: (t) => {
        lastHeardAt.current = Date.now();
        heardFinal.current = t;
        if (t.trim()) set({ heard: t.trim() });
      },
      onSaid: (t) => {
        said.current.text += t.replace(/<\/?[a-z_]{2,20}>/gi, "");
        set({ saying: said.current.text.trim() });
        checkSaid(false);
      },
      onTurnComplete: () => {
        checkSaid(true);
        said.current = { text: "", flagged: new Set() };
        // Words heard that the model did not relay (it asked them to say it again): the next words are a new utterance.
        if (heardOpen.current && Date.now() - lastHeardAt.current > 1500) heardOpen.current = false;
        modelTurnOpen.current = false;
        const last = timings.current.at(-1);
        if (last && last.replySound !== undefined && last.replyDone === undefined) timing(last.turn, { replyDone: Date.now() - lastHeardAt.current });
        set({ saying: "", costUsd: cost() });
        if (ending.current === "goodbye" && !queue.current.length) {
          ending.current = null;
          window.setTimeout(() => hangUp(tx().goodbye, "goodbye"), 600);
          return;
        }
        window.setTimeout(flush, 150);
      },
      onInterrupted: () => {
        // Barge-in: the buyer started talking; the agent stops at once.
        a.stopPlayback();
        modelTurnOpen.current = false;
        set({ agentSpeaking: false });
      },
      onToolCall: (fcs) => void onRelay(fcs),
      onCancelled: () => {},
      onUsage: (u) => {
        tokens.current = { prompt: tokens.current.prompt + u.promptTokens, response: tokens.current.response + u.responseTokens, usd: tokens.current.usd + (u.costUsd ?? 0) };
      },
      onGoAway: () => set({ notice: tx().goAway }),
      onError: (code) => {
        if (/rate_limit/.test(code)) set({ notice: tx().rateLimited });
      },
      onClose: ({ clean, code, reason }) => {
        if (clean || self() === null) return;
        onLost({ code, reason });
      },
    }),
    [set, checkSaid, cost, onRelay, tx, timing, flush, hangUp],
  );

  /** Open the voice session for a started call. */
  const connect = useCallback(
    (start: CallStart, a: CallAudio, greeting: () => void, onLost: (info: { code: number; reason: string; ready: boolean }) => void) => {
      const live = start.live!;
      a.rate = live.inputRate;
      let s: VoiceSocket | null = null;
      let everReady = false;
      const ev = events(a, () => s, (info) => onLost({ ...info, ready: everReady }), greeting);
      const onReady = ev.onReady;
      ev.onReady = () => {
        everReady = true;
        onReady();
      };
      const rtc =
        live.transport === "webrtc"
          ? {
              stream: a.micStream!,
              handsFree: true,
              play: (remote: MediaStream) => a.playStream(remote),
              offer: async (sdp: string) => {
                const r = await post<{ sdp: string }>(`${base}/call/${start.callId}`, { op: "rtc", sdp });
                if (!r.ok || !r.data.sdp) throw new Error(r.data.error?.message ?? "the voice service did not answer");
                return r.data.sdp;
              },
            }
          : undefined;
      ev.onSpeaking = (on) => speaking.current(on);
      s = live.provider === "openai" ? new RealtimeSocket(live.wsUrl, live.token, live.model, ev, rtc) : new LiveSocket(live.wsUrl, live.token, live.model, ev);
      sock.current = s;
      const ends = Date.parse(start.expiresAt);
      timers.current.push(
        window.setInterval(() => {
          const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
          set({ secondsLeft: left, costUsd: cost() });
          if (left <= 30 && left > 0 && !warned.current) {
            warned.current = true;
            set({ notice: tx().thirtySeconds });
          }
          if (left <= 0) hangUp(tx().timeLimit, "time limit");
        }, 1000),
        window.setInterval(() => {
          const id = callId.current;
          if (!id) return;
          const au = audio.current;
          void post(`${base}/call/${id}`, { op: "beat", usage: { audioInSeconds: au?.seconds.in ?? 0, audioOutSeconds: au?.seconds.out ?? 0, promptTokens: tokens.current.prompt, responseTokens: tokens.current.response, ...(tokens.current.usd ? { costUsd: tokens.current.usd } : {}) }, grounding: grounding.current }).then((res) => {
            if (res.status === 404 || res.status === 410) hangUp(tx().timeLimit, "ended by the server");
          });
        }, 10_000),
      );
      return s;
    },
    [base, events, set, cost, hangUp, tx],
  );

  /**
   * Get a voice session: the first provider; a session that never starts moves to the other provider once; a call
   * lost mid-way reconnects once to the same provider, then once to the other; then voice is said to be unavailable.
   */
  const dial = useCallback(
    async (carryFrom: string | undefined, a: CallAudio, why: { avoid?: string; reconnect?: boolean }) => {
      const r = await post<CallStart>(`${base}/call`, { carryFrom, lang: langRef.current, ...(why.avoid ? { avoid: why.avoid } : {}) });
      if (!r.ok || !r.data.live) {
        hangUp(r.data.error?.message || tx().noVoice, "could not start");
        return;
      }
      const start = r.data;
      callId.current = start.callId;
      brands.current = start.brands;
      addFacts(facts.current, start.context);
      set({ secondsLeft: start.maxSeconds, provider: start.live!.provider });
      const greeting = () => {
        if (!why.reconnect) {
          modelTurnOpen.current = true;
          modelTurnAt.current = Date.now();
          sock.current?.text("[call connected]");
          return;
        }
        // Back after a drop: where things stand, from the conversation itself.
        void post<{ say: string }>(`${base}/call/${start.callId}`, { op: "standing" }).then((x) => utter(x.ok ? x.data.say : ""));
      };
      let started = false;
      const s = connect(start, a, greeting, ({ code, reason, ready }) => {
        if (sock.current !== s) return;
        void post(`${base}/call/${start.callId}`, { op: "end", reason: `${ready ? "lost" : "refused"} ${code}` });
        // The page went to the background or the screen locked: the browser took the line. Say so; no redial.
        if (hiddenAt.current !== null || document.visibilityState === "hidden") return hangUp(tx().background, "background");
        if (ready && (code === 1008 || /expire|deadline/i.test(reason))) return hangUp(tx().timeLimit, "time limit");
        const lostOnce = why.reconnect || why.avoid;
        if (!lostOnce) {
          // Once more: the same provider when the call had been live (a dropped line), else the other one.
          cleanup(true);
          set({ phase: "reconnecting", agentSpeaking: false, notice: ready ? tx().recovering : tx().switching });
          window.setTimeout(() => void dialRef.current(start.callId, a, ready ? { reconnect: true } : { avoid: start.live!.provider }), ready ? 600 : 0);
          return;
        }
        if (!why.avoid) {
          cleanup(true);
          set({ phase: "reconnecting", agentSpeaking: false, notice: tx().switching });
          window.setTimeout(() => void dialRef.current(start.callId, a, { avoid: start.live!.provider, reconnect: true }), 0);
          return;
        }
        hangUp(QUOTA.test(reason) ? tx().rateLimited : tx().lost, `lost ${code}`);
      });
      // A provider that accepts the socket but does not start the session in 6 s: the other one, once.
      window.setTimeout(() => {
        if (sock.current !== s || s.ready || started) return;
        started = true;
        void post(`${base}/call/${start.callId}`, { op: "end", reason: "slow start" });
        if (why.avoid) return hangUp(tx().noVoice, "connect timeout");
        cleanup(true);
        set({ phase: "reconnecting", notice: tx().switching });
        void dialRef.current(start.callId, a, { avoid: start.live!.provider, reconnect: why.reconnect });
      }, 6_000);
    },
    [base, cleanup, connect, set, hangUp, tx, utter],
  );

  useEffect(() => {
    dialRef.current = dial;
  }, [dial]);

  /** Must run inside the tap on the microphone: iOS opens the microphone and plays audio only from a user gesture. */
  const call = useCallback(async () => {
    cleanup();
    facts.current = emptyFacts();
    heard.current = "";
    heardFinal.current = undefined;
    heardOpen.current = false;
    warned.current = false;
    ending.current = null;
    queue.current = [];
    tokens.current = { prompt: 0, response: 0, usd: 0 };
    grounding.current = { checked: 0, dropped: 0 };
    hiddenAt.current = null;
    set({ phase: "starting", heard: "", saying: "", notice: undefined, micProblem: undefined, endReason: undefined, agentSpeaking: false, working: false, waitingFor: undefined, paused: false });
    let a: CallAudio;
    try {
      speaking.current = (on: boolean) => {
        set({ agentSpeaking: on });
        if (!on) window.setTimeout(flush, 200);
      };
      a = new CallAudio(
        (b64) => sock.current?.audio(b64),
        (on) => speaking.current(on),
      );
      audio.current = a;
      stopRing.current = a.ring();
      await a.openMic();
    } catch (err) {
      cleanup();
      const p = micProblem(err);
      set({ phase: "ended", micProblem: p, endReason: p === "denied" ? tx().micBlocked : (tx().mic[p] ?? tx().mic.failed) });
      return;
    }
    a.onMicEnded = () => {
      if (audio.current !== a) return;
      hangUp(hiddenAt.current !== null ? tx().background : tx().micEnded, "microphone ended");
    };
    // A phone call or Siri suspends the page's audio: shown, and resumed on the next tap.
    a.onAudioState = (state) => set({ paused: state === "interrupted" || (state === "suspended" && document.visibilityState === "visible") });
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wake.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* no wake lock: the screen may dim */
    }
    await dial(callId.current ?? undefined, a, {});
  }, [cleanup, set, dial, hangUp, tx, flush]);

  const setMuted = useCallback(
    (on: boolean) => {
      mutedRef.current = on;
      audio.current?.setSending(!on);
      sock.current?.setSending?.(!on);
      set({ muted: on });
    },
    [set],
  );

  const resume = useCallback(() => {
    audio.current?.resume();
    set({ paused: false });
  }, [set]);

  // The screen locks or the tab goes to the background: noted, so a line the browser takes is said to be because of it.
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else {
        hiddenAt.current = null;
        audio.current?.resume();
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (sock.current?.open && !wake.current) void nav.wakeLock?.request("screen").then((w) => (wake.current = w)).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  useEffect(
    () => () => {
      const id = callId.current;
      if (id && sock.current) void navigator.sendBeacon?.(`${base}/call/${id}`, new Blob([JSON.stringify({ op: "end", reason: "page closed" })], { type: "application/json" }));
      cleanup();
    },
    [base, cleanup],
  );

  /** Something that happened on the screen during the call (a card tapped): its reply is said too. */
  const followTurn = useCallback((agentTurnId: string) => void follow(agentTurnId, turn.current), [follow]);

  return { view: v, status: statusOf(v), call, hangUp, setMuted, resume, followTurn, level: () => audio.current?.level ?? 0, callId: () => callId.current };
}
