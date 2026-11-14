"use client";

import type { ButlerMessage } from "@/lib/agent/tools";
import { browserState, requestHandover, runBrowserTool, stopBrowserTools } from "@/lib/browser/client";
import { BROWSER_TOOL_NAMES, type BrowserStepData, type BrowserToolName, type HandoverAnswer } from "@/lib/browser/protocol";
import { CLIENT_HEADER, clientKind } from "@/lib/client-kind";
import type { LocateResult } from "@/lib/location";
import type { LocationAnswer } from "@/lib/widgets/types";
import { Microphone, Speaker, microphoneProblem } from "./audio";
import { LiveSocket, requestVoiceGrant, type FunctionCall } from "./live-socket";
import { LIVE_MODEL, NO_VOICE_TOKENS, voiceCost, type VoiceToolEvent, type VoiceTokens } from "./models";

/*
 * A live call: the user talks, the agent talks back, and its tools run in the background.
 *
 * The call is another way of holding the same conversation. Everything said and done in it is
 * written into the conversation's own messages as it happens (what the user said, what the agent
 * said, every tool call with its result), so the conversation view shows the call exactly as it
 * shows a typed exchange, and the conversation is saved the same way.
 *
 * Who does what: Gemini's live model listens, speaks and decides which tool to call. The tools
 * themselves are the app's own. The ones that search and read run on this app's server
 * (/api/voice/tool); the live browser's steps run in the desktop app, under its safety rules,
 * exactly as in a typed conversation; the user's location is read by this browser.
 */

export type CallStatus =
  | "idle" // no call
  | "connecting"
  | "listening" // waiting for the user, or hearing them
  | "thinking" // working out an answer, or a tool is running
  | "speaking"
  | "reconnecting";

export type CallSnapshot = {
  status: CallStatus;
  /** True from the tap that starts a call until it has ended. */
  active: boolean;
  muted: boolean;
  /** The server hears the user speaking right now. */
  userSpeaking: boolean;
  /** What the user last said. */
  heard: string;
  /** What the agent is saying now, all of it. The view shows as much as has been spoken (see `spokenShare`). */
  saying: string;
  /** What is running in the background, in plain words: "Checking flights". */
  working: string[];
  startedAt: number;
  /** Set when a call ended by itself, or could not start: why, in words for the user. */
  problem?: string;
};

/** No call. */
export const NO_CALL: CallSnapshot = { status: "idle", active: false, muted: false, userSpeaking: false, heard: "", saying: "", working: [], startedAt: 0 };
const IDLE = NO_CALL;

/** What the call needs from the conversation it belongs to. */
export type CallHost = {
  conversationId: string;
  /** What every request carries: the model picked for typed conversations, the place, the time zone, the user's position. */
  context: () => Record<string, unknown>;
  getMessages: () => ButlerMessage[];
  setMessages: (update: (messages: ButlerMessage[]) => ButlerMessage[]) => void;
  /** Read the user's position through the browser (it asks them the first time). */
  locate: () => Promise<LocateResult>;
};

const WORKING: Record<string, string> = {
  webSearch: "Searching the web",
  readPages: "Reading pages",
  findPlaces: "Finding places",
  searchFlights: "Checking flights",
  searchHotels: "Checking hotels",
  searchProducts: "Looking at products",
  getStocks: "Checking prices",
  getPredictionMarket: "Checking the odds",
  searchImages: "Finding pictures",
  getWeather: "Checking the weather",
  deepResearch: "Researching",
  showComparison: "Putting it on screen",
  showKeyFacts: "Putting it on screen",
  showWidget: "Putting it on screen",
  showActions: "Putting it on screen",
  requestLocation: "Finding where you are",
  requestUserAction: "Handing you the page",
  browserOpen: "Opening a page",
  browserAct: "Working on the page",
  browserRead: "Reading the page",
  browserLook: "Looking at the page",
  browserClose: "Closing the browser",
};

const isBrowserTool = (name: string): name is BrowserToolName => (BROWSER_TOOL_NAMES as readonly string[]).includes(name);
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

type Part = ButlerMessage["parts"][number];
type LooseToolPart = { type: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string; preliminary?: boolean };

/** What was said before the call, as plain text, so the agent can carry on from it. */
function historyOf(messages: ButlerMessage[]): string {
  const lines: string[] = [];
  for (const message of messages.slice(-14)) {
    const said = message.parts
      .map((part) => (part.type === "text" ? part.text : part.type.startsWith("tool-") && part.type !== "tool-askUser" ? `[showed the result of ${part.type.slice(5)} on screen]` : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (said) lines.push(`${message.role === "user" ? "User" : "You"}: ${said.length > 700 ? `${said.slice(0, 700)}…` : said}`);
  }
  const text = lines.join("\n");
  return text.length > 6000 ? text.slice(-6000) : text;
}

export class LiveCall {
  private snapshot: CallSnapshot = IDLE;
  private listeners = new Set<() => void>();
  private host: CallHost | undefined;
  private mic: Microphone | undefined;
  private speaker: Speaker | undefined;
  private socket: LiveSocket | undefined;
  private wakeLock: { release: () => Promise<void> } | undefined;
  /** Microphone audio that could not be sent yet (the line is being set up or restored). */
  private unsent: string[] = [];
  private retries = 0;
  private generation = 0;

  /* The conversation being written. */
  /** The agent's message that is being added to, until the user speaks next. */
  private assistantId: string | undefined;
  /** The user's message for what they are saying now. */
  private userId: string | undefined;
  /** The agent started answering before the words of the user's sentence arrived: they go in before its message. */
  private answeredFirst = false;
  /** Where in the speaker's stream the sentence being spoken began, so the view can show the words as they are heard. */
  private utteranceMark = 0;
  private utteranceOpen = false;
  private turnDone = true;
  private waitingForAnswer = false;
  /**
   * The tools the agent has just asked for. It says "let me check" and then calls a tool, but the
   * written words of what it said arrive late, sometimes after the call itself. They still belong
   * before it in the conversation. Its next words can only be about the results once it has been
   * given them and has started speaking again: until then, what arrives is the "let me check".
   */
  private round: { ids: string[]; answered: boolean; spokeAfter: boolean } | undefined;

  /* Tools. */
  private running = new Map<string, { label: string; abort: AbortController }>();
  /** Hand-overs waiting for the user to press Done, by tool call. */
  private handovers = new Set<string>();

  /* What the call used. */
  private tokens: VoiceTokens = { ...NO_VOICE_TOKENS };
  private turns = 0;

  /* ───────────── For the interface ───────────── */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  /** How loud the user and the agent are right now, 0 to about 1. Read from an animation frame. */
  levels(): { mic: number; speaker: number } {
    return { mic: this.snapshot.muted ? 0 : (this.mic?.level ?? 0), speaker: this.speaker?.level ?? 0 };
  }

  /** How much of what the agent is saying has actually been spoken, 0 to 1. Words appear as they are heard, not before. */
  spokenShare(): number {
    const speaker = this.speaker;
    if (!speaker || !this.utteranceOpen) return 1;
    const total = speaker.received - this.utteranceMark;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, (speaker.played - this.utteranceMark) / total));
  }

  /** The conversation the call belongs to, while there is one. */
  get conversationId(): string | undefined {
    return this.host?.conversationId;
  }

  /** True when this call asked the user to step in with that request. */
  ownsHandover(toolCallId: string | undefined): boolean {
    return Boolean(toolCallId) && this.handovers.has(toolCallId as string);
  }

  private set(change: Partial<CallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }

  /** Listening, thinking or speaking: worked out from what is going on. */
  private settle() {
    if (!this.snapshot.active || this.snapshot.status === "connecting" || this.snapshot.status === "reconnecting") return;
    const speaking = Boolean(this.speaker && !this.speaker.idle);
    const status: CallStatus = speaking ? "speaking" : this.running.size > 0 || this.waitingForAnswer ? "thinking" : "listening";
    const working = [...new Set([...this.running.values()].map((tool) => tool.label))];
    if (status !== this.snapshot.status || working.join("|") !== this.snapshot.working.join("|")) this.set({ status, working });
  }

  /* ───────────── Starting and ending ───────────── */

  /**
   * Start a call. Call it straight from a tap or a click: the speaker has to be made before
   * anything is awaited, or the browser will not let it make a sound.
   */
  async start(host: CallHost): Promise<void> {
    if (this.snapshot.active) return;
    const generation = ++this.generation;
    this.host = host;
    this.tokens = { ...NO_VOICE_TOKENS };
    this.turns = 0;
    this.retries = 0;
    this.unsent = [];
    this.assistantId = undefined;
    this.userId = undefined;
    this.turnDone = true;
    this.round = undefined;
    this.utteranceOpen = false;
    this.waitingForAnswer = false;
    this.set({ ...IDLE, status: "connecting", active: true, startedAt: Date.now(), problem: undefined });
    try {
      this.speaker = Speaker.create();
      this.speaker.onIdle = () => {
        if (this.turnDone) this.utteranceOpen = false;
        this.settle();
      };
      // The microphone and the session at once: whichever takes longer sets the wait.
      const [grant, mic] = await Promise.all([
        requestVoiceGrant("live", { ...host.context(), conversationId: host.conversationId, history: historyOf(host.getMessages()) }),
        Microphone.open((chunk) => this.fromMicrophone(chunk)),
      ]);
      if (generation !== this.generation || !this.snapshot.active) {
        mic.close();
        return;
      }
      this.mic = mic;
      this.connect(grant);
      void this.keepAwake();
    } catch (err) {
      if (generation !== this.generation) return;
      this.finish(err instanceof DOMException ? microphoneProblem(err) : err instanceof Error ? err.message : "The call could not start.");
    }
  }

  /** Hang up. */
  end() {
    if (!this.snapshot.active) return;
    this.finish();
  }

  private finish(problem?: string) {
    this.generation += 1;
    const host = this.host;
    const startedAt = this.snapshot.startedAt;
    for (const tool of this.running.values()) tool.abort.abort();
    if (this.running.size) stopBrowserTools();
    this.running.clear();
    this.socket?.close();
    this.socket = undefined;
    this.mic?.close();
    this.mic = undefined;
    this.speaker?.close();
    this.speaker = undefined;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
    // Whatever was still in the air is closed off, so the conversation does not show a step that never ends.
    host?.setMessages((messages) =>
      messages.map((message) => {
        if (message.role !== "assistant") return message;
        let changed = false;
        const parts = message.parts.map((part) => {
          if (part.type === "text" && part.state === "streaming") {
            changed = true;
            return { ...part, state: "done" as const };
          }
          const tool = part as unknown as LooseToolPart;
          if (part.type.startsWith("tool-") && (tool.state === "input-available" || tool.state === "input-streaming" || tool.preliminary) && !this.handovers.has(tool.toolCallId) ? this.callIds.has(tool.toolCallId) : false) {
            changed = true;
            return { ...tool, state: "output-error", errorText: "The call ended before this finished.", output: undefined, preliminary: undefined } as unknown as Part;
          }
          return part;
        });
        return changed ? { ...message, parts } : message;
      }),
    );
    this.handovers.clear();
    this.callIds.clear();
    const used = this.tokens;
    if (host && used.textIn + used.audioIn + used.textOut + used.audioOut > 0) {
      void fetch("/api/voice/usage", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", [CLIENT_HEADER]: clientKind() },
        body: JSON.stringify({ purpose: "live", conversationId: host.conversationId, startedAt, durationMs: Date.now() - startedAt, turns: this.turns, tokens: used }),
      }).catch(() => {});
    }
    this.host = undefined;
    this.set({ ...IDLE, problem });
  }

  /** Every tool call this call has made, so that ending it only closes off its own. */
  private callIds = new Set<string>();

  private async keepAwake() {
    try {
      const lock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      this.wakeLock = await lock?.request("screen");
    } catch {
      /* the screen may dim: the call goes on */
    }
  }

  /* ───────────── The line ───────────── */

  private connect(grant: Awaited<ReturnType<typeof requestVoiceGrant>>, resume?: string) {
    const generation = this.generation;
    const socket = new LiveSocket(grant, {
      onReady: () => {
        if (generation !== this.generation) return;
        this.retries = 0;
        for (const chunk of this.unsent.splice(0)) socket.sendAudio(chunk);
        this.set({ status: "listening" });
        this.settle();
      },
      onAudio: (audio) => this.onAudio(audio),
      onHeard: (text) => this.onHeard(text),
      onSaid: (text) => this.onSaid(text),
      onUserSpeaking: (speaking) => this.onUserSpeaking(speaking),
      onInterrupted: () => this.onInterrupted(),
      onToolCalls: (calls) => calls.forEach((call) => void this.runTool(call)),
      onToolCallsCancelled: (ids) => ids.forEach((id) => this.running.get(id)?.abort.abort()),
      onTurnComplete: () => this.onTurnComplete(),
      onUsage: (used) => this.onUsage(used),
      // The server ends a connection after about ten minutes and says so first: pick the session up on a new one.
      onGoingAway: () => this.reconnect(grant, socket),
      onClose: ({ clean, reason }) => {
        if (clean || generation !== this.generation || this.socket !== socket) return;
        this.reconnect(grant, socket, reason);
      },
    });
    this.socket = socket;
    socket.connect(resume);
  }

  /** The connection dropped, or is about to: carry the same session on over a new one. A few tries, then the call ends. */
  private reconnect(grant: Awaited<ReturnType<typeof requestVoiceGrant>>, old: LiveSocket, reason?: string) {
    if (!this.snapshot.active || this.socket !== old) return;
    const host = this.host;
    if (this.retries >= 3 || !host) {
      this.finish(/expired|token|unauth/i.test(reason ?? "") ? "The call ran out of time. Start it again to carry on." : "The call was cut off. Check your connection and start it again.");
      return;
    }
    this.retries += 1;
    const resume = old.resumeHandle;
    old.close();
    this.set({ status: "reconnecting" });
    const generation = this.generation;
    const again = async () => {
      // With the session's handle the same token carries on. Without one, or near the token's end, a new session starts from what was said.
      const fresh = !resume || Date.now() > grant.expiresAt - 30_000;
      const next = fresh ? await requestVoiceGrant("live", { ...host.context(), conversationId: host.conversationId, history: historyOf(host.getMessages()) }) : grant;
      if (generation !== this.generation || !this.snapshot.active) return;
      this.connect(next, fresh ? undefined : resume);
    };
    setTimeout(() => void again().catch(() => this.finish("The call was cut off. Check your connection and start it again.")), this.retries === 1 ? 150 : 900 * this.retries);
  }

  private fromMicrophone(chunk: string) {
    if (this.socket?.open) this.socket.sendAudio(chunk);
    else if (this.unsent.length < 75) this.unsent.push(chunk); // three seconds, while the line comes up
  }

  /* ───────────── Controls ───────────── */

  setMuted(muted: boolean) {
    if (!this.snapshot.active) return;
    this.mic?.mute(muted);
    if (muted) this.socket?.endAudio();
    this.set({ muted, userSpeaking: muted ? false : this.snapshot.userSpeaking });
  }

  /** Stop the agent talking, without saying anything: a tap on the screen. */
  interrupt() {
    if (!this.speaker || this.speaker.idle) return;
    this.onInterrupted();
    this.socket?.sendText("(The user tapped to stop you. Stop there and wait for them.)");
  }

  /** Something typed during a call: it joins the conversation and the agent answers aloud. */
  sendText(text: string) {
    const said = text.trim();
    if (!said || !this.snapshot.active) return;
    this.speaker?.flush();
    this.closeAssistant();
    this.append({ id: newId(), role: "user", parts: [{ type: "text", text: said }] } as ButlerMessage);
    this.userId = undefined;
    this.set({ heard: said, saying: "" });
    this.waitingForAnswer = true;
    this.socket?.sendText(said);
    this.settle();
  }

  /** The user pressed Done (or Skip) on something the agent handed to them. */
  handoverDone(answer: HandoverAnswer, toolCallId: string) {
    if (!this.handovers.delete(toolCallId)) return;
    this.updateToolPart(toolCallId, (part) => ({ ...part, state: "output-available", output: answer }));
    this.socket?.sendText(answer.status === "done" ? "(I have finished on the page and handed the browser back to you. Read the page and carry on.)" : "(I skipped that step. Do not ask for it again; tell me what is left for me to do.)");
  }

  /* ───────────── What comes down the line ───────────── */

  private onUserSpeaking(speaking: boolean) {
    if (this.snapshot.muted) return;
    if (speaking) {
      // A new sentence from the user: what the agent said so far is one finished message.
      this.closeAssistant();
      this.round = undefined;
      this.userId = undefined;
      this.answeredFirst = false;
      this.waitingForAnswer = false;
      this.set({ userSpeaking: true, heard: "" });
    } else {
      this.waitingForAnswer = true;
      this.set({ userSpeaking: false });
    }
    this.settle();
  }

  private onHeard(text: string) {
    const piece = text.trim();
    if (!piece) return;
    const existing = this.userId;
    if (existing) {
      this.host?.setMessages((messages) => messages.map((message) => (message.id === existing ? { ...message, parts: message.parts.map((part) => (part.type === "text" ? { ...part, text: `${part.text} ${piece}`.trim() } : part)) } : message)));
      this.set({ heard: `${this.snapshot.heard} ${piece}`.trim() });
      return;
    }
    const id = newId();
    this.userId = id;
    const message = { id, role: "user", parts: [{ type: "text", text: piece }] } as ButlerMessage;
    const before = this.answeredFirst ? this.assistantId : undefined;
    this.host?.setMessages((messages) => {
      const at = before ? messages.findIndex((m) => m.id === before) : -1;
      return at >= 0 ? [...messages.slice(0, at), message, ...messages.slice(at)] : [...messages, message];
    });
    this.set({ heard: piece });
  }

  private openUtterance() {
    if (this.utteranceOpen) return;
    this.utteranceOpen = true;
    this.turnDone = false;
    this.utteranceMark = this.speaker?.received ?? 0;
    this.set({ saying: "" });
  }

  private onAudio(audio: string) {
    // The agent is speaking again after being given what its tools found: from here its words are about that.
    if (this.round?.answered) this.round.spokeAfter = true;
    this.openUtterance();
    this.waitingForAnswer = false;
    this.speaker?.play(audio);
    this.settle();
  }

  private onSaid(text: string) {
    this.openUtterance();
    this.waitingForAnswer = false;
    this.set({ saying: this.snapshot.saying + text });
    const asked = this.round && !this.round.spokeAfter ? this.round.ids : [];
    this.writeAssistant((parts) => {
      // Words said before the tools were called go in front of them, even when they arrive after.
      const firstTool = asked.length ? parts.findIndex((part) => asked.includes((part as unknown as LooseToolPart).toolCallId)) : -1;
      const at = firstTool >= 0 ? firstTool : parts.length;
      const before = parts[at - 1];
      if (before?.type === "text" && (before.state === "streaming" || firstTool >= 0)) return [...parts.slice(0, at - 1), { ...before, text: before.text + text }, ...parts.slice(at)];
      return [...parts.slice(0, at), { type: "text", text, state: firstTool >= 0 ? "done" : "streaming" } as Part, ...parts.slice(at)];
    });
  }

  /** The user spoke over the agent: its voice stops at once, and the conversation keeps only what was actually said. */
  private onInterrupted() {
    const share = this.spokenShare();
    this.speaker?.flush();
    const heardSoFar = cutAt(this.snapshot.saying, share);
    const full = this.snapshot.saying;
    if (full && heardSoFar !== full) {
      this.writeAssistant((parts) => {
        const last = parts.at(-1);
        if (last?.type !== "text" || !last.text.endsWith(full)) return parts;
        const kept = `${last.text.slice(0, last.text.length - full.length)}${heardSoFar}`.trimEnd();
        return kept ? [...parts.slice(0, -1), { ...last, text: `${kept} …`, state: "done" as const }] : parts.slice(0, -1);
      }, false);
    }
    this.utteranceOpen = false;
    this.turnDone = true;
    this.set({ saying: heardSoFar });
    this.settle();
  }

  private onTurnComplete() {
    this.turns += 1;
    this.turnDone = true;
    this.waitingForAnswer = false;
    if (this.speaker?.idle ?? true) this.utteranceOpen = false;
    // This stretch of speech is finished text now; what a tool brings next starts a new stretch in the same message.
    this.writeAssistant((parts) => parts.map((part) => (part.type === "text" && part.state === "streaming" ? { ...part, state: "done" as const } : part)), false);
    this.settle();
  }

  private onUsage(used: VoiceTokens) {
    this.tokens = { textIn: this.tokens.textIn + used.textIn, audioIn: this.tokens.audioIn + used.audioIn, textOut: this.tokens.textOut + used.textOut, audioOut: this.tokens.audioOut + used.audioOut };
    const cost = voiceCost(LIVE_MODEL, used);
    this.noteStats((stats) => ({
      ...stats,
      llmCostUsd: (stats.llmCostUsd ?? 0) + cost,
      usage: {
        inputTokens: (stats.usage?.inputTokens ?? 0) + used.textIn + used.audioIn,
        outputTokens: (stats.usage?.outputTokens ?? 0) + used.textOut + used.audioOut,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
    }));
  }

  /* ───────────── Writing the conversation ───────────── */

  private append(message: ButlerMessage) {
    this.host?.setMessages((messages) => [...messages, message]);
  }

  /** The agent's message for this stretch of the call: made when it first says or does something. */
  private writeAssistant(change: (parts: Part[]) => Part[], create = true) {
    const host = this.host;
    if (!host) return;
    let id = this.assistantId;
    if (!id) {
      if (!create) return;
      id = newId();
      this.assistantId = id;
      if (!this.userId) this.answeredFirst = true;
      const made = { id, role: "assistant", parts: change([]), metadata: { modelId: LIVE_MODEL.id, modelLabel: LIVE_MODEL.label, startedAt: Date.now() } } as ButlerMessage;
      host.setMessages((messages) => [...messages, made]);
      return;
    }
    const target = id;
    host.setMessages((messages) => messages.map((message) => (message.id === target ? { ...message, parts: change(message.parts) } : message)));
  }

  /** The user is speaking again: the agent's message so far is complete, with how long it took. */
  private closeAssistant() {
    const id = this.assistantId;
    if (!id) return;
    this.assistantId = undefined;
    this.host?.setMessages((messages) =>
      messages.map((message) =>
        message.id === id
          ? {
              ...message,
              parts: message.parts.map((part) => (part.type === "text" && part.state === "streaming" ? { ...part, state: "done" as const } : part)),
              metadata: message.metadata ? { ...message.metadata, durationMs: message.metadata.durationMs ?? Date.now() - message.metadata.startedAt } : message.metadata,
            }
          : message,
      ),
    );
  }

  private noteStats(change: (stats: NonNullable<ButlerMessage["metadata"]>) => NonNullable<ButlerMessage["metadata"]>, messageId = this.assistantId) {
    if (!messageId) return;
    this.host?.setMessages((messages) =>
      messages.map((message) => (message.id === messageId && message.metadata ? { ...message, metadata: { ...change(message.metadata), durationMs: Date.now() - message.metadata.startedAt } } : message)),
    );
  }

  private updateToolPart(toolCallId: string, change: (part: LooseToolPart) => LooseToolPart) {
    this.host?.setMessages((messages) =>
      messages.map((message) => {
        if (message.role !== "assistant" || !message.parts.some((part) => (part as unknown as LooseToolPart).toolCallId === toolCallId)) return message;
        return { ...message, parts: message.parts.map((part) => ((part as unknown as LooseToolPart).toolCallId === toolCallId ? (change(part as unknown as LooseToolPart) as unknown as Part) : part)) };
      }),
    );
  }

  /* ───────────── Tools ───────────── */

  private async runTool(call: FunctionCall) {
    const socket = this.socket;
    const host = this.host;
    if (!socket || !host) return;
    const abort = new AbortController();
    this.callIds.add(call.id);
    if (this.round && !this.round.spokeAfter) this.round.ids.push(call.id);
    else this.round = { ids: [call.id], answered: false, spokeAfter: false };
    const round = this.round;
    this.running.set(call.id, { label: WORKING[call.name] ?? "Working", abort });
    this.waitingForAnswer = false;
    // The step appears in the conversation the moment it is asked for, as it would in a typed one.
    this.writeAssistant((parts) => [
      ...parts.map((part) => (part.type === "text" && part.state === "streaming" ? { ...part, state: "done" as const } : part)),
      { type: `tool-${call.name}`, toolCallId: call.id, state: "input-available", input: call.args } as unknown as Part,
    ]);
    const messageId = this.assistantId;
    this.settle();

    const answer = (response: Record<string, unknown>) => {
      // The line may have been replaced while the tool ran: the answer goes down whichever is up now.
      (this.socket ?? socket).sendToolResult(call, response);
      round.answered = true;
    };
    const done = (output: unknown, text: string) => {
      this.updateToolPart(call.id, (part) => ({ ...part, state: "output-available", output, preliminary: undefined }));
      answer({ result: text });
    };
    const failed = (problem: string) => {
      this.updateToolPart(call.id, (part) => ({ ...part, state: "output-error", errorText: problem, output: undefined, preliminary: undefined }));
      answer({ error: problem });
    };

    try {
      if (isBrowserTool(call.name)) {
        // The page is the user's until they hand it back themselves: the agent does not take it because it heard "done".
        const browser = browserState();
        if (browser.status === "ready" && browser.control === "user") {
          const problem = "The user still has the page. You get it back when they press Done or Hand back in the live browser: ask them to press it when they have finished, and wait.";
          done({ kind: "browser", label: "Waiting for you to hand the page back", action: "read", url: browser.url, title: browser.title, ok: false, problem, page: problem, sources: [] } satisfies BrowserStepData, problem);
        } else {
          const output = await runBrowserTool({ tool: call.name, toolCallId: call.id, input: call.args });
          // A picture of the page is for typed conversations, where the model can look at it. Here the text is what counts.
          done({ ...output, picture: undefined }, output.page);
        }
      } else if (call.name === "requestUserAction") {
        // The page is handed to the user at once. The call goes on: the agent says what to do, and waits to be told.
        requestHandover(call.args, call.id);
        this.handovers.add(call.id);
        answer({ result: "The page is the user's now. Tell them, in a sentence, what to do there, and to press Done in the live browser when they have finished. Do nothing in the browser until they have." });
      } else if (call.name === "requestLocation") {
        const found = await host.locate();
        if (found.ok) {
          const { location } = found;
          done({ status: "granted", ...location } satisfies LocationAnswer, `The user shared their exact location: ${location.label ?? "unnamed place"} (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}). It is saved for the rest of this conversation. For places around them, call findPlaces with near set to "near me".`);
        } else {
          const status = found.reason === "denied" ? "denied" : "unavailable";
          done({ status } satisfies LocationAnswer, `${status === "denied" ? "The user or their browser did not allow location access." : "The device could not determine a location."} Carry on with the approximate place you were given and say which place you assumed. Do not ask for location again.`);
        }
      } else {
        await this.runOnServer(call, host, abort.signal, done, failed, messageId);
      }
    } catch (err) {
      failed(abort.signal.aborted ? "Stopped." : err instanceof Error ? err.message.slice(0, 200) : "That did not work.");
    } finally {
      this.running.delete(call.id);
      if (this.running.size === 0 && this.snapshot.active) this.waitingForAnswer = true;
      this.settle();
    }
  }

  /** A tool that searches or reads: the server runs it and sends what there is so far, then the result. */
  private async runOnServer(call: FunctionCall, host: CallHost, signal: AbortSignal, done: (output: unknown, text: string) => void, failed: (problem: string) => void, messageId: string | undefined) {
    const response = await fetch("/api/voice/tool", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", [CLIENT_HEADER]: clientKind() },
      body: JSON.stringify({ ...host.context(), name: call.name, input: call.args, toolCallId: call.id, conversationId: host.conversationId }),
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      failed(body.error || "That did not work.");
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    const take = (line: string) => {
      if (!line.trim()) return;
      let event: VoiceToolEvent;
      try {
        event = JSON.parse(line) as VoiceToolEvent;
      } catch {
        return;
      }
      if (event.type === "progress") this.updateToolPart(call.id, (part) => ({ ...part, state: "output-available", output: event.output, preliminary: true }));
      else if (event.type === "result") {
        finished = true;
        done(event.output, event.text);
        const spent = event.spent;
        if (spent) {
          this.noteStats(
            (stats) => ({
              ...stats,
              exaCostUsd: (stats.exaCostUsd ?? 0) + (spent.exaCostUsd ?? 0),
              workerCostUsd: (stats.workerCostUsd ?? 0) + (spent.workerCostUsd ?? 0),
              exaCalls: spent.exaCalls
                ? {
                    search: (stats.exaCalls?.search ?? 0) + spent.exaCalls.search,
                    contents: (stats.exaCalls?.contents ?? 0) + spent.exaCalls.contents,
                    agent: (stats.exaCalls?.agent ?? 0) + spent.exaCalls.agent,
                    answer: (stats.exaCalls?.answer ?? 0) + spent.exaCalls.answer,
                  }
                : stats.exaCalls,
            }),
            messageId,
          );
        }
      } else {
        finished = true;
        failed(event.error);
      }
    };
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
      if (ended) break;
    }
    take(buffer);
    if (!finished) failed("That did not finish.");
  }
}

/** The start of `text` up to about `share` of it, cut at a word. */
function cutAt(text: string, share: number): string {
  if (share >= 0.98) return text;
  const words = text.split(/(\s+)/);
  const keep = Math.max(0, Math.round((words.length * share) / 2) * 2);
  return words.slice(0, keep).join("").trimEnd();
}

/** The words of `text` that have been spoken so far, for a caption that keeps pace with the voice. */
export function spokenSoFar(text: string, share: number): string {
  if (share >= 0.98) return text;
  const words = text.split(/(\s+)/);
  // A word ahead, so the caption never lags behind what is heard.
  const keep = Math.min(words.length, Math.ceil((words.length * share) / 2) * 2 + 2);
  return words.slice(0, keep).join("").trimEnd();
}
