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

export class RealtimeSocket implements VoiceSocket {
  readonly inputRate = 24000;
  readonly finalTranscripts = true;
  private ws: WebSocket;
  private closedByUs = false;
  private responding = false;
  /** Messages (text turns, a response request) waiting for the current response to finish. */
  private queue: unknown[][] = [];
  private calls: FunctionCall[] = [];
  private appended = false;
  ready = false;

  constructor(
    url: string,
    token: string,
    private readonly model: string,
    private readonly ev: SocketEvents,
  ) {
    this.ws = new WebSocket(`${url}?model=${encodeURIComponent(model)}`, ["realtime", `openai-insecure-api-key.${token}`]);
    this.ws.onmessage = (e) => void this.message(e.data);
    this.ws.onclose = (e) => {
      this.ready = false;
      ev.onClose({ code: e.code, reason: e.reason, clean: this.closedByUs });
    };
    this.ws.onerror = () => {
      /* onclose follows with the code */
    };
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
        this.ready = true;
        this.ev.onReady();
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
    if (this.ws.readyState !== WebSocket.OPEN) return;
    for (const e of events) this.ws.send(JSON.stringify(e));
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
    this.appended = true;
    this.send({ type: "input_audio_buffer.append", audio: b64 });
  }
  activityStart() {
    // Barge-in by push-to-talk: stop the agent's current answer, start a fresh turn.
    if (this.responding) this.send({ type: "response.cancel" });
    this.queue = [];
    this.appended = false;
    this.send({ type: "input_audio_buffer.clear" });
  }
  activityEnd() {
    if (!this.appended) return;
    this.appended = false;
    this.sendOrQueue([{ type: "input_audio_buffer.commit" }, { type: "response.create" }]);
  }
  text(t: string) {
    this.sendOrQueue([{ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] } }, { type: "response.create" }]);
  }
  toolResponse(responses: { id: string; name: string; response: unknown }[]) {
    this.sendOrQueue([...responses.map((r) => ({ type: "conversation.item.create", item: { type: "function_call_output", call_id: r.id, output: JSON.stringify(r.response) } })), { type: "response.create" }]);
  }
  get open() {
    return this.ws.readyState === WebSocket.OPEN;
  }
  close() {
    this.closedByUs = true;
    try {
      this.ws.close(1000, "hung up");
    } catch {
      /* closed */
    }
  }
}
