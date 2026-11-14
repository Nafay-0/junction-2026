"use client";

/**
 * The browser's WebSocket to the Gemini Live API (BidiGenerateContentConstrained, v1beta), opened with the
 * one-use token from /ui-api/voice/{kitchen}/call. The setup is locked inside the token; the setup message sent
 * here only names the model. Message shapes from https://aistudio.google.com/api-reference/live.
 */

export type FunctionCall = { id: string; name: string; args?: Record<string, unknown> };

export type SocketEvents = {
  onReady: () => void;
  onAudio: (b64: string) => void;
  onHeard: (text: string) => void;
  onSaid: (text: string) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onToolCall: (calls: FunctionCall[]) => void;
  onCancelled: (ids: string[]) => void;
  onUsage: (u: { promptTokens: number; responseTokens: number; costUsd?: number }) => void;
  onGoAway: (secondsLeft: number) => void;
  onClose: (info: { code: number; reason: string; clean: boolean }) => void;
  /** The finished transcript of the caller's last turn, when the provider sends one (OpenAI). Replaces the deltas. */
  onHeardFinal?: (text: string) => void;
  /** A provider error that did not close the socket (rate limit, bad event). */
  onError?: (code: string, message: string) => void;
  /** The agent's voice started or stopped, when the provider plays it itself (OpenAI over WebRTC). */
  onSpeaking?: (speaking: boolean) => void;
};

/** What the call hook needs from a voice provider's socket (Gemini Live here, OpenAI Realtime in realtime-socket.ts). */
export interface VoiceSocket {
  readonly ready: boolean;
  readonly open: boolean;
  /** Sample rate the provider takes microphone audio at. */
  readonly inputRate: number;
  /** True when the provider sends a final transcript per turn (wait for it before acting on the caller's words). */
  readonly finalTranscripts: boolean;
  audio(b64: string): void;
  activityStart(): void;
  activityEnd(): void;
  text(t: string): void;
  toolResponse(responses: { id: string; name: string; response: unknown }[]): void;
  close(): void;
  /** WebRTC only: the microphone track on or off. */
  setSending?(on: boolean): void;
  /** WebRTC only: stop the agent's voice, which the provider plays. */
  stopSpeaking?(): void;
}

export class LiveSocket implements VoiceSocket {
  readonly inputRate = 16000;
  readonly finalTranscripts = false;
  private ws: WebSocket;
  private closedByUs = false;
  ready = false;

  constructor(url: string, token: string, model: string, private readonly ev: SocketEvents) {
    this.ws = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`);
    this.ws.onopen = () => this.send({ setup: { model: `models/${model}` } });
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
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof Blob) text = await data.text();
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m.setupComplete) {
      this.ready = true;
      this.ev.onReady();
    }
    const sc = m.serverContent as
      | { modelTurn?: { parts?: { inlineData?: { data: string } }[] }; inputTranscription?: { text?: string }; outputTranscription?: { text?: string }; turnComplete?: boolean; interrupted?: boolean }
      | undefined;
    if (sc) {
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) this.ev.onAudio(p.inlineData.data);
      if (sc.inputTranscription?.text) this.ev.onHeard(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this.ev.onSaid(sc.outputTranscription.text);
      if (sc.interrupted) this.ev.onInterrupted();
      if (sc.turnComplete) this.ev.onTurnComplete();
    }
    const tc = m.toolCall as { functionCalls?: FunctionCall[] } | undefined;
    if (tc?.functionCalls?.length) this.ev.onToolCall(tc.functionCalls);
    const cancel = m.toolCallCancellation as { ids?: string[] } | undefined;
    if (cancel?.ids?.length) this.ev.onCancelled(cancel.ids);
    const u = m.usageMetadata as { promptTokenCount?: number; responseTokenCount?: number } | undefined;
    if (u) this.ev.onUsage({ promptTokens: u.promptTokenCount ?? 0, responseTokens: u.responseTokenCount ?? 0 });
    const go = m.goAway as { timeLeft?: string } | undefined;
    if (go) this.ev.onGoAway(Number.parseFloat(go.timeLeft ?? "0") || 0);
  }

  private send(obj: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  audio(b64: string) {
    this.send({ realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } } });
  }
  activityStart() {
    this.send({ realtimeInput: { activityStart: {} } });
  }
  activityEnd() {
    this.send({ realtimeInput: { activityEnd: {} } });
  }
  audioStreamEnd() {
    this.send({ realtimeInput: { audioStreamEnd: true } });
  }
  text(t: string) {
    this.send({ realtimeInput: { text: t } });
  }
  toolResponse(responses: { id: string; name: string; response: unknown }[]) {
    this.send({ toolResponse: { functionResponses: responses } });
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
