"use client";

import type { FunctionCall, SocketEvents, VoiceSocket } from "./live-socket";

/**
 * The browser's WebSocket to the OpenAI Realtime API (GA interface), opened with a client secret from
 * /ui-api/voice/{kitchen}/call (server/channels/voice/realtime.ts). The session's instructions, tools and audio
 * settings come with the secret. Events from https://developers.openai.com/api/docs/guides/realtime-conversations.
 *
 * Push-to-talk: the microphone audio of a turn is appended, then committed with a response requested. Hands-free:
 * the server's semantic turn detection does both. Tool calls arrive with the response that made them; their
 * results go back as function_call_output items, then one response is requested.
 */

const PRICE: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }> = {
  "gpt-realtime-2.1": { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
  "gpt-realtime-2.1-mini": { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
  "gpt-realtime-2": { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { audio_tokens?: number; text_tokens?: number; cached_tokens?: number; cached_tokens_details?: { audio_tokens?: number; text_tokens?: number } };
  output_token_details?: { audio_tokens?: number; text_tokens?: number };
};

/** One response's cost at list prices. */
export function realtimeCost(model: string, u: Usage): number {
  const p = PRICE[model] ?? PRICE["gpt-realtime-2.1"];
  const i = u.input_token_details ?? {};
  const cachedAudio = i.cached_tokens_details?.audio_tokens ?? 0;
  const cachedText = i.cached_tokens_details?.text_tokens ?? Math.max(0, (i.cached_tokens ?? 0) - cachedAudio);
  const audioIn = Math.max(0, (i.audio_tokens ?? 0) - cachedAudio);
  const textIn = Math.max(0, (i.text_tokens ?? 0) - cachedText);
  const o = u.output_token_details ?? {};
  return (audioIn * p.audioIn + cachedAudio * p.audioCached + textIn * p.textIn + cachedText * p.textCached + (o.audio_tokens ?? 0) * p.audioOut + (o.text_tokens ?? 0) * p.textOut) / 1e6;
}

/** How events travel: a WebSocket (the evaluation, in Node) or a WebRTC data channel (the browser). */
type Transport = { send: (obj: unknown) => void; close: () => void; readonly open: boolean };

export class RealtimeSocket implements VoiceSocket {
  readonly inputRate = 24000;
  readonly finalTranscripts = true;
  private transport: Transport = { send: () => {}, close: () => {}, open: false };
  private closedByUs = false;
  private closed = false;
  private responding = false;
  /** Messages (text turns, a response request) waiting for the current response to finish. */
  private queue: unknown[][] = [];
  private calls: FunctionCall[] = [];
  private appended = false;
  /** WebRTC: the microphone track (on only while the caller holds the button, or always in hands-free). */
  private track?: MediaStreamTrack;
  private pc?: RTCPeerConnection;
  ready = false;

  /** WebSocket with a short-lived client secret (in-process callers; Node has no WebRTC). */
  constructor(
    url: string,
    token: string,
    private readonly model: string,
    private readonly ev: SocketEvents,
    rtc?: { offer: (sdp: string) => Promise<string>; stream: MediaStream; play: (remote: MediaStream) => void; handsFree: boolean },
  ) {
    if (rtc) {
      void this.connectRtc(rtc);
      return;
    }
    const ws = new WebSocket(`${url}?model=${encodeURIComponent(model)}`, ["realtime", `openai-insecure-api-key.${token}`]);
    ws.onmessage = (e) => void this.message(e.data);
    ws.onclose = (e) => this.lost(e.code, e.reason);
    ws.onerror = () => {
      /* onclose follows with the code */
    };
    this.transport = {
      send: (obj) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)),
      close: () => ws.close(1000, "hung up"),
      get open() {
        return ws.readyState === WebSocket.OPEN;
      },
    };
  }

  /**
   * WebRTC set up through this app's server (/ui-api/voice/{kitchen}/call/{callId} op "rtc"): the offer goes to the
   * server, which answers it through OpenAI with the call's session and keeps the call id, so it can hang the
   * session up at the time limit. The microphone is the track; the agent's voice is the remote track.
   */
  private async connectRtc(rtc: { offer: (sdp: string) => Promise<string>; stream: MediaStream; play: (remote: MediaStream) => void; handsFree: boolean }) {
    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;
      pc.ontrack = (e) => rtc.play(e.streams[0] ?? new MediaStream([e.track]));
      this.track = rtc.stream.getAudioTracks()[0];
      if (this.track) {
        this.track.enabled = rtc.handsFree;
        pc.addTrack(this.track, rtc.stream);
      }
      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => void this.message(e.data);
      dc.onopen = () => this.markReady();
      dc.onclose = () => this.lost(1006, "data channel closed");
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") this.lost(1006, `connection ${pc.connectionState}`);
      };
      this.transport = {
        send: (obj) => dc.readyState === "open" && dc.send(JSON.stringify(obj)),
        close: () => {
          dc.close();
          pc.close();
        },
        get open() {
          return dc.readyState === "open";
        },
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await rtc.offer(offer.sdp ?? "");
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err) {
      this.lost(1011, (err as Error).message || "webrtc failed");
    }
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    this.ev.onReady();
  }

  private lost(code: number, reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.ev.onClose({ code, reason, clean: this.closedByUs });
  }

  private async message(data: unknown) {
    const text = typeof data === "string" ? data : data instanceof Blob ? await data.text() : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "";
    let m: { type?: string; [k: string]: unknown };
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.type) {
      case "session.created":
        this.markReady();
        break;
      case "response.created":
        this.responding = true;
        this.calls = [];
        break;
      case "response.output_audio.delta":
        if (typeof m.delta === "string") this.ev.onAudio(m.delta);
        break;
      case "response.output_audio_transcript.delta":
        if (typeof m.delta === "string") this.ev.onSaid(m.delta);
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (typeof m.delta === "string" && m.delta) this.ev.onHeard(m.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.ev.onHeardFinal?.(String(m.transcript ?? ""));
        break;
      case "conversation.item.input_audio_transcription.failed":
        this.ev.onHeardFinal?.("");
        break;
      case "output_audio_buffer.started":
        this.ev.onSpeaking?.(true);
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.ev.onSpeaking?.(false);
        break;
      case "input_audio_buffer.speech_started":
        // Hands-free barge-in: the caller started talking over the agent.
        this.ev.onInterrupted();
        break;
      case "response.function_call_arguments.done": {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(m.arguments ?? "{}"));
        } catch {
          /* empty */
        }
        this.calls.push({ id: String(m.call_id), name: String(m.name), args });
        break;
      }
      case "response.done": {
        this.responding = false;
        const r = m.response as { status?: string; usage?: Usage } | undefined;
        if (r?.usage) this.ev.onUsage({ promptTokens: r.usage.input_tokens ?? 0, responseTokens: r.usage.output_tokens ?? 0, costUsd: realtimeCost(this.model, r.usage) });
        const calls = this.calls;
        this.calls = [];
        if (r?.status === "cancelled") this.ev.onInterrupted();
        if (calls.length && r?.status !== "cancelled") this.ev.onToolCall(calls);
        this.ev.onTurnComplete();
        if (!calls.length || r?.status === "cancelled") this.drain();
        break;
      }
      case "error": {
        const e = (m.error ?? {}) as { code?: string; message?: string };
        if (e.code === "response_cancel_not_active" || e.code === "input_audio_buffer_commit_empty") break;
        this.ev.onError?.(e.code ?? "error", e.message ?? "");
        break;
      }
    }
  }

  private send(...events: unknown[]) {
    if (!this.transport.open) return;
    for (const e of events) this.transport.send(e);
  }

  /** Send now, or after the current response if it would start a second one. */
  private sendOrQueue(events: unknown[]) {
    if (this.responding) this.queue.push(events);
    else {
      this.send(...events);
      if (events.some((e) => (e as { type: string }).type === "response.create")) this.responding = true;
    }
  }

  private drain() {
    const next = this.queue.shift();
    if (next) this.sendOrQueue(next);
  }

  audio(b64: string) {
    if (this.pc) return; // WebRTC: the microphone track carries the audio
    this.appended = true;
    this.send({ type: "input_audio_buffer.append", audio: b64 });
  }
  /** WebRTC: the microphone track on or off (push-to-talk, hands-free half-duplex). */
  setSending(on: boolean) {
    if (this.track) this.track.enabled = on;
  }
  /** Stop the agent's voice now (barge-in, or a sentence the grounding check refused). */
  stopSpeaking() {
    if (this.responding) this.send({ type: "response.cancel" });
    if (this.pc) this.send({ type: "output_audio_buffer.clear" });
  }
  activityStart() {
    // Barge-in by push-to-talk: stop the agent's current answer, start a fresh turn.
    this.stopSpeaking();
    this.queue = [];
    this.appended = !!this.pc;
    this.send({ type: "input_audio_buffer.clear" });
    this.setSending(true);
  }
  activityEnd() {
    if (!this.appended) return;
    this.appended = false;
    if (this.pc) {
      // The last 200 ms of speech are still on their way over the track.
      window.setTimeout(() => {
        this.setSending(false);
        this.sendOrQueue([{ type: "input_audio_buffer.commit" }, { type: "response.create" }]);
      }, 200);
      return;
    }
    this.sendOrQueue([{ type: "input_audio_buffer.commit" }, { type: "response.create" }]);
  }
  text(t: string) {
    this.sendOrQueue([{ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] } }, { type: "response.create" }]);
  }
  toolResponse(responses: { id: string; name: string; response: unknown }[]) {
    this.sendOrQueue([...responses.map((r) => ({ type: "conversation.item.create", item: { type: "function_call_output", call_id: r.id, output: JSON.stringify(r.response) } })), { type: "response.create" }]);
  }
  get open() {
    return this.transport.open;
  }
  close() {
    this.closedByUs = true;
    try {
      this.transport.close();
    } catch {
      /* closed */
    }
  }
}
