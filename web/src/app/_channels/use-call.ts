"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeView } from "@/core/intake";
import type { PublicOrder } from "@/core/orders";
import type { CallStart } from "@/server/channels/voice/start";
import type { Pending, ToolReply } from "@/server/channels/voice/tools";
import { CallAudio, MIC_TEXT, micProblem, type MicProblem } from "./audio";
import { addFacts, checkSpeech, correctionFor, emptyFacts, type Facts } from "./grounding";
import { LiveSocket, type FunctionCall } from "./live-socket";

/**
 * One call with a kitchen's purchasing agent, from the tap on "Call" to hang-up.
 *
 * The voice model runs in Google's cloud; its tool calls arrive here and are relayed to this app's server,
 * which runs Dock's intake and composes what the agent may say. This hook attaches what the caller said
 * (the live transcript of their last turn) to each tool call, keeps every tool result as the call's facts,
 * and checks the agent's own transcript against them while it speaks.
 */

export type Mode = "push_to_talk" | "hands_free";
export type Phase = "idle" | "ringing" | "connected" | "lost" | "ended" | "typed";
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

type Post = <T>(path: string, body: unknown) => Promise<{ ok: boolean; status: number; data: T & { error?: { code: string; message: string } } }>;

const post: Post = async (path, body) => {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { code: "network", message: "No connection to Dock. Check the network and try again." } } as never };
  }
};

const PRICE = { inPerMin: 0.005, outPerMin: 0.018, textInPerM: 0.75, textOutPerM: 4.5 };

export function useCall(kitchen: string, opts: { onStep?: (s: IntakeView) => void; onOrder?: (o: PublicOrder) => void } = {}) {
  const base = `/ui-api/voice/${encodeURIComponent(kitchen)}`;
  const [v, setV] = useState<CallView>({ phase: "idle", mode: "push_to_talk", lines: [], talking: false, latched: false, agentSpeaking: false, busy: false, costUsd: 0, grounding: { checked: 0, dropped: 0 } });
  const set = useCallback((f: Partial<CallView> | ((x: CallView) => Partial<CallView>)) => setV((x) => ({ ...x, ...(typeof f === "function" ? f(x) : f) })), []);

  const audio = useRef<CallAudio | null>(null);
  const sock = useRef<LiveSocket | null>(null);
  const callId = useRef<string | null>(null);
  const facts = useRef<Facts>(emptyFacts());
  const brands = useRef<string[]>([]);
  const lineId = useRef(0);
  const turn = useRef(0);
  const heardOpen = useRef(false);
  const heard = useRef("");
  const lastHeardAt = useRef(0);
  const said = useRef({ id: -1, text: "", flagged: new Set<string>() });
  const tokens = useRef({ prompt: 0, response: 0 });
  const grounding = useRef({ checked: 0, dropped: 0 });
  const pressAt = useRef(0);
  const latched = useRef(false);
  const modeRef = useRef<Mode>("push_to_talk");
  const timers = useRef<number[]>([]);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
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

  const cost = useCallback(() => {
    const a = audio.current;
    return (a ? (a.seconds.in / 60) * PRICE.inPerMin + (a.seconds.out / 60) * PRICE.outPerMin : 0) + (tokens.current.prompt * PRICE.textInPerM + tokens.current.response * PRICE.textOutPerM) / 1e6 / 4;
  }, []);

  const cleanup = useCallback(() => {
    for (const t of timers.current) window.clearInterval(t);
    timers.current = [];
    stopRing.current?.();
    stopRing.current = null;
    sock.current?.close();
    sock.current = null;
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
      set({ phase, talking: false, latched: false, agentSpeaking: false, endReason: reason, costUsd: cost() });
    },
    [base, cleanup, cost, set],
  );

  // ---------- the agent's tool calls ----------

  const runTools = useCallback(
    async (fcs: FunctionCall[]) => {
      set({ busy: true });
      // The caller's last words may still be arriving as transcript: wait until it has been quiet for 400 ms.
      for (let i = 0; i < 10 && Date.now() - lastHeardAt.current < 400; i++) await new Promise((r) => setTimeout(r, 100));
      const responses: { id: string; name: string; response: unknown }[] = [];
      for (const fc of fcs) {
        const words = heard.current.trim();
        const r = await post<ToolReply>(`${base}/tool`, { callId: callId.current, name: fc.name, args: fc.args ?? {}, heard: words ? { text: words, turn: turn.current } : undefined, via: "speech" });
        let reply: ToolReply;
        if (r.ok) reply = r.data;
        else {
          const message = r.data.error?.message ?? "Dock could not be reached.";
          reply = { forModel: { ok: false, state: "error", say: `Dock could not do that: ${message}` }, screen: { problem: { code: r.data.error?.code ?? "error", message } } };
        }
        screen(reply);
        responses.push({ id: fc.id, name: fc.name, response: reply.forModel });
      }
      heard.current = "";
      heardOpen.current = false;
      sock.current?.toolResponse(responses);
      set({ busy: false });
    },
    [base, screen, set],
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
      set({ phase: "typed", start: r.data, micProblem: mic, notice: message, talking: false, latched: false });
    },
    [base, set],
  );

  // ---------- starting a call ----------

  /** Must run inside the tap on "Call": iOS opens the microphone and plays audio only from a user gesture. */
  const call = useCallback(
    async (mode: Mode, carryFrom?: string) => {
      cleanup();
      modeRef.current = mode;
      facts.current = emptyFacts();
      turn.current = 0;
      heard.current = "";
      grounding.current = { checked: 0, dropped: 0 };
      set({ phase: "ringing", mode, lines: [], notice: undefined, problem: undefined, micProblem: undefined, endReason: undefined, talking: false, latched: false, grounding: { checked: 0, dropped: 0 } });
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
        await startTyped(p, MIC_TEXT[p], carryFrom);
        return;
      }
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wake.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* no wake lock: the screen may dim; the call survives a short lock on most phones */
      }
      const r = await post<CallStart>(`${base}/call`, { mode, carryFrom });
      if (!r.ok || !r.data.live) {
        cleanup();
        await startTyped(undefined, r.data.error?.message ?? "The call could not start.", carryFrom);
        return;
      }
      const start = r.data;
      callId.current = start.callId;
      brands.current = start.brands;
      addFacts(facts.current, start.context);
      set({ start, secondsLeft: start.maxSeconds });
      const s = new LiveSocket(start.live!.wsUrl, start.live!.token, start.live!.model, {
        onReady: () => {
          stopRing.current?.();
          stopRing.current = null;
          set({ phase: "connected" });
          s.text("[call connected]");
          if (modeRef.current === "hands_free") a.setSending(true);
        },
        onAudio: (b64) => a.play(b64),
        onHeard: (t) => {
          lastHeardAt.current = Date.now();
          if (!heardOpen.current && modeRef.current === "hands_free") turn.current += 1;
          heardOpen.current = true;
          heard.current = `${heard.current}${t}`;
          const text = heard.current.trim();
          set((x) => {
            const last = x.lines.at(-1);
            if (last && last.who === "you" && !last.final) return { lines: x.lines.map((l) => (l.id === last.id ? { ...l, text } : l)) };
            return { lines: [...x.lines.slice(-60), { id: ++lineId.current, who: "you", text, final: false }] };
          });
        },
        onSaid: (t) => {
          heardOpen.current = false;
          if (said.current.id < 0) said.current = { id: addLine("agent", "", false), text: "", flagged: new Set() };
          said.current.text += t;
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
          set((x) => ({ lines: x.lines.map((l) => (l.who === "you" ? { ...l, final: true } : l)), costUsd: cost() }));
        },
        onInterrupted: () => a.stopPlayback(),
        onToolCall: (fcs) => void runTools(fcs),
        onCancelled: () => {},
        onUsage: (u) => {
          tokens.current = { prompt: tokens.current.prompt + u.promptTokens, response: tokens.current.response + u.responseTokens };
        },
        onGoAway: () => set({ notice: "The voice service is ending this call soon." }),
        onClose: ({ clean, code, reason }) => {
          if (clean) return;
          cleanup();
          set({ phase: "lost", talking: false, latched: false, agentSpeaking: false, endReason: code === 1008 || /expire|deadline/i.test(reason) ? "The call reached its time limit." : "The connection to the voice service was lost." });
          if (callId.current) void post(`${base}/call/${callId.current}`, { op: "end", reason: `lost ${code}` });
        },
      });
      sock.current = s;
      const ends = Date.parse(start.expiresAt);
      timers.current.push(
        window.setInterval(() => {
          const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
          set({ secondsLeft: left, costUsd: cost() });
          if (left <= 0) hangUp("time limit");
        }, 1000),
        window.setInterval(() => {
          const id = callId.current;
          if (!id) return;
          const au = audio.current;
          void post(`${base}/call/${id}`, { op: "beat", usage: { audioInSeconds: au?.seconds.in ?? 0, audioOutSeconds: au?.seconds.out ?? 0, promptTokens: tokens.current.prompt, responseTokens: tokens.current.response }, grounding: grounding.current }).then((res) => {
            if (res.status === 404 || res.status === 410) hangUp("ended by the server");
          });
        }, 10_000),
      );
      // If nothing connects in 12 s (blocked WebSocket, captive portal), fall back to typing.
      window.setTimeout(() => {
        if (sock.current === s && !s.ready) {
          cleanup();
          void post(`${base}/call/${start.callId}`, { op: "end", reason: "connect timeout" });
          void startTyped(undefined, "The voice connection did not open (the network may block it). Type instead.", start.callId);
        }
      }, 12_000);
    },
    [base, cleanup, set, addLine, patchLine, checkSaid, runTools, hangUp, cost, startTyped],
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
        set({ problem: { code: r.data.error?.code ?? "error", message: r.data.error?.message ?? "Dock could not do that." } });
        return;
      }
      screen(r.data);
      // On screen the cards carry the detail: the transcript gets Dock's first sentence only.
      addLine("dock", r.data.forModel.say.split(/(?<=[.:])\s/)[0]);
    },
    [addLine, base, screen, set],
  );

  /** A tap on a card during a call or a typed call: the same step, then the agent is told what happened. */
  const tap = useCallback(
    async (name: string, args: Record<string, unknown>, label: string) => {
      if (!callId.current) return;
      set({ busy: true });
      addLine("you", `Tapped: ${label}`);
      const live = !!sock.current?.open;
      const r = await post<ToolReply>(`${base}/tool`, { callId: callId.current, name, args, via: live ? "speech" : "typed", tapped: true });
      set({ busy: false });
      if (!r.ok) {
        set({ problem: { code: r.data.error?.code ?? "error", message: r.data.error?.message ?? "Dock could not do that." } });
        return;
      }
      screen(r.data);
      if (live) sock.current!.text(`[Dock update] The caller tapped "${label}" on the screen. Dock's reply: ${JSON.stringify(r.data.forModel)}`);
      else addLine("dock", r.data.forModel.say);
    },
    [addLine, base, screen, set],
  );

  // ---------- push-to-talk ----------

  const pressTalk = useCallback(() => {
    const a = audio.current;
    const s = sock.current;
    if (!a || !s?.ready) return;
    a.resume();
    if (latched.current) {
      // A second tap ends a tapped (latched) turn.
      latched.current = false;
      a.setSending(false);
      s.activityEnd();
      set({ talking: false, latched: false });
      return;
    }
    pressAt.current = Date.now();
    a.stopPlayback();
    turn.current += 1;
    heard.current = "";
    s.activityStart();
    a.setSending(true);
    set({ talking: true });
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
    set({ talking: false });
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
        if (sock.current?.open) sock.current.text(`[Dock update] ${r.data.forModel.say} Tell the caller in one sentence.`);
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

  useEffect(() => () => {
    const id = callId.current;
    if (id && sock.current) void navigator.sendBeacon?.(`${base}/call/${id}`, new Blob([JSON.stringify({ op: "end", reason: "page closed" })], { type: "application/json" }));
    cleanup();
  }, [base, cleanup]);

  const typeInstead = useCallback(() => startTyped(undefined, "Typing instead of talking: the same request, the same checks.", callId.current ?? undefined), [startTyped]);

  return { view: v, call, hangUp, typeInstead, pressTalk, releaseTalk, typed, tap, callId: () => callId.current, level: () => audio.current?.level ?? 0 };
}
