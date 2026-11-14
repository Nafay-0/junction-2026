"use client";

import { api } from "@/lib/auth/fetch";
import { LIVE_SOCKET, NO_VOICE_TOKENS, type VoiceGrant, type VoicePurpose, type VoiceTokens } from "./models";

/*
 * The line to Gemini's Live API, from the browser. The interface talks to it directly so that
 * sound takes the shortest way there and back; what it connects with is a short-lived token from
 * this app's server (the API key never leaves the server), locked to the model, the instructions
 * and the tools. The interface only names the model and, after a dropped connection, the session
 * to pick up again.
 *
 * Messages are plain JSON, as documented at aistudio.google.com/docs/live-api.
 */

export type FunctionCall = { id: string; name: string; args: Record<string, unknown> };

export type LiveEvents = {
  /** The session is set up: sound can be sent. */
  onReady?: () => void;
  /** A piece of the agent's voice: 24 kHz PCM, base64. */
  onAudio?: (base64: string) => void;
  /** What the user is saying, so far (replaces the last one), while they are still speaking. */
  onInterim?: (text: string) => void;
  /** What the user said: a finished piece of it. */
  onHeard?: (text: string) => void;
  /** What the agent is saying: the next piece of it. */
  onSaid?: (text: string) => void;
  onToolCalls?: (calls: FunctionCall[]) => void;
  /** The user spoke over the agent: tool calls that are no longer wanted. */
  onToolCallsCancelled?: (ids: string[]) => void;
  /** The user started or stopped speaking, as the server hears it. */
  onUserSpeaking?: (speaking: boolean) => void;
  /** The user spoke over the agent: stop its voice at once. */
  onInterrupted?: () => void;
  /** The agent has finished producing this answer (its voice may still be playing). */
  onAnswerComplete?: () => void;
  /** The agent's turn is over. */
  onTurnComplete?: () => void;
  /** The server will end this connection soon: reconnect and carry on. */
  onGoingAway?: () => void;
  onUsage?: (tokens: VoiceTokens) => void;
  /** The line is gone. `clean` when this side closed it. */
  onClose?: (info: { clean: boolean; reason: string }) => void;
};

type ServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  toolCallCancellation?: { ids?: string[] };
  voiceActivity?: { type?: string };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: {
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
};

const byModality = (details: Array<{ modality?: string; tokenCount?: number }> | undefined) => {
  let audio = 0;
  let other = 0;
  for (const detail of details ?? []) {
    if (detail.modality === "AUDIO") audio += detail.tokenCount ?? 0;
    else other += detail.tokenCount ?? 0;
  }
  return { audio, other };
};

/** Ask this app's server for a voice session. */
export async function requestVoiceGrant(purpose: VoicePurpose, details: Record<string, unknown> = {}): Promise<VoiceGrant> {
  // Signed out, this sends the user to the sign-in page.
  const response = await api("/api/voice/token", { method: "POST", json: { purpose, ...details } });
  const body = (await response.json().catch(() => ({}))) as Partial<VoiceGrant> & { error?: string };
  if (!response.ok || !body.token || !body.model) throw new Error(body.error || "Voice could not start. Try again in a moment.");
  return { token: body.token, model: body.model, expiresAt: body.expiresAt ?? Date.now() + 25 * 60_000 };
}

export class LiveSocket {
  /** The handle to pick this session up again after the connection drops. */
  resumeHandle: string | undefined;
  private socket: WebSocket | undefined;
  private ready = false;
  private closedHere = false;
  /** Tokens of the turn in progress: the server repeats the running count, so only the last one of a turn is added. */
  private turnTokens: VoiceTokens = { ...NO_VOICE_TOKENS };

  constructor(
    private grant: VoiceGrant,
    private events: LiveEvents,
  ) {}

  get open(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Connect, or reconnect to the same session when `resume` names it. */
  connect(resume?: string) {
    this.closedHere = false;
    this.ready = false;
    const socket = new WebSocket(`${LIVE_SOCKET}?access_token=${encodeURIComponent(this.grant.token)}`);
    this.socket = socket;
    socket.onopen = () => {
      const setup: Record<string, unknown> = { model: `models/${this.grant.model}` };
      if (resume) setup.sessionResumption = { handle: resume };
      socket.send(JSON.stringify({ setup }));
    };
    socket.onmessage = (event: MessageEvent<string | Blob | ArrayBuffer>) => {
      if (this.socket !== socket) return;
      const data = event.data;
      if (typeof data === "string") this.receive(data);
      else if (data instanceof Blob) void data.text().then((text) => this.socket === socket && this.receive(text));
      else this.receive(new TextDecoder().decode(data));
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.ready = false;
      this.events.onClose?.({ clean: this.closedHere, reason: event.reason || (event.code === 1000 ? "" : `closed (${event.code})`) });
    };
  }

  private receive(text: string) {
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (message.setupComplete !== undefined) {
      this.ready = true;
      this.events.onReady?.();
    }
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) this.resumeHandle = message.sessionResumptionUpdate.newHandle;
    if (message.voiceActivity?.type === "ACTIVITY_START") this.events.onUserSpeaking?.(true);
    if (message.voiceActivity?.type === "ACTIVITY_END") this.events.onUserSpeaking?.(false);
    if (message.usageMetadata) {
      const asked = byModality(message.usageMetadata.promptTokensDetails);
      const answered = byModality(message.usageMetadata.responseTokensDetails);
      this.turnTokens = { textIn: asked.other, audioIn: asked.audio, textOut: answered.other, audioOut: answered.audio };
    }
    if (message.toolCall?.functionCalls?.length) {
      this.events.onToolCalls?.(message.toolCall.functionCalls.filter((call) => call.id && call.name).map((call) => ({ id: call.id as string, name: call.name as string, args: call.args ?? {} })));
    }
    if (message.toolCallCancellation?.ids?.length) this.events.onToolCallsCancelled?.(message.toolCallCancellation.ids);
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) this.events.onInterrupted?.();
      if (content.interimInputTranscription?.text !== undefined) this.events.onInterim?.(content.interimInputTranscription.text);
      if (content.inputTranscription?.text) this.events.onHeard?.(content.inputTranscription.text);
      for (const part of content.modelTurn?.parts ?? []) if (part.inlineData?.data) this.events.onAudio?.(part.inlineData.data);
      if (content.outputTranscription?.text) this.events.onSaid?.(content.outputTranscription.text);
      if (content.generationComplete) this.events.onAnswerComplete?.();
      if (content.turnComplete) {
        this.events.onUsage?.(this.turnTokens);
        this.turnTokens = { ...NO_VOICE_TOKENS };
        this.events.onTurnComplete?.();
      }
    }
    if (message.goAway) this.events.onGoingAway?.();
  }

  private send(message: unknown) {
    if (this.open) this.socket?.send(JSON.stringify(message));
  }

  /** 40 ms of the microphone: 16 kHz PCM, base64. */
  sendAudio(base64: string) {
    this.send({ realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } } });
  }

  /** The microphone has stopped for now (muted, or dictation ended): what was said so far is final. */
  endAudio() {
    this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  /** Something typed, or something the app has to tell the agent, in the middle of a call. */
  sendText(text: string) {
    this.send({ realtimeInput: { text } });
  }

  /**
   * What a tool returned. "WHEN_IDLE" asks the agent to speak about it once it has finished its
   * sentence. "SILENT" only hands it the result: for a result that is one of several still on
   * their way, so that the agent answers once, with everything, instead of once per result.
   */
  sendToolResult(call: Pick<FunctionCall, "id" | "name">, response: Record<string, unknown>, scheduling: "WHEN_IDLE" | "SILENT" = "WHEN_IDLE") {
    this.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response, scheduling }] } });
  }

  close() {
    this.closedHere = true;
    this.ready = false;
    try {
      this.socket?.close(1000);
    } catch {
      /* already closed */
    }
  }
}
