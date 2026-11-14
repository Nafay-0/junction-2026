import type { LanguageModel } from "ai";
import { DockError } from "@/core/errors";
import { playingNow } from "./clock";

/**
 * The two models a kitchen's conversation uses (the request reader and the store's agent), played by plain code for the
 * sample conversations, so they cost nothing and call no provider. Like the scripted provider (agent/scripted.ts), each
 * answer is written down beforehand: the reader returns the need the script gives for the turn, the agent calls the
 * `order` tool with the buyer's words and then says the script's line. They answer only inside a sample beat; any other
 * caller that meets them in the moment they are installed is told to try again, never given a scripted answer.
 */
export type TurnScript = { words?: string; need?: Record<string, unknown>; line: string; order?: boolean; holdMs?: number };

const g = globalThis as typeof globalThis & { __dockSampleScript?: TurnScript };

export function setTurnScript(s: TurnScript | undefined): void {
  g.__dockSampleScript = s;
}

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };

function guard(): TurnScript {
  const s = g.__dockSampleScript;
  if (!playingNow() || !s) throw new DockError(503, "model_unavailable", "The agent's model is busy for a moment; try again.");
  return s;
}

type Part = { type?: string };
type Msg = { role?: string; content?: string | Part[] };

export function sampleReader(): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "sample",
    modelId: "scripted-reader",
    supportedUrls: {},
    async doGenerate() {
      const s = guard();
      return { content: [{ type: "text", text: JSON.stringify(s.need ?? {}) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
    async doStream() {
      throw new Error("not streamed");
    },
  } as unknown as LanguageModel;
}

let seq = 0;

export function sampleAgent(): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "sample",
    modelId: "scripted-agent",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("streamed only");
    },
    async doStream(options: { prompt: unknown }) {
      const s = guard();
      const prompt = (Array.isArray(options.prompt) ? options.prompt : []) as Msg[];
      let lastUser = -1;
      for (let i = prompt.length - 1; i >= 0; i--) if (prompt[i].role === "user") {
        lastUser = i;
        break;
      }
      const toolsRan = prompt.slice(lastUser + 1).some((m) => m.role === "tool");
      if (s.holdMs) await new Promise((r) => setTimeout(r, s.holdMs));
      const words = (() => {
        const m = prompt[lastUser];
        return typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => ((p as { text?: string }).text ?? "")).join(" ");
      })();
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      const call = s.order && !toolsRan;
      if (call) parts.push({ type: "tool-call", toolCallId: `sample_${++seq}`, toolName: "order", input: JSON.stringify({ words: s.words ?? words }) });
      else parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: s.line }, { type: "text-end", id: "t" });
      parts.push({ type: "finish", finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined }, usage });
      return { stream: new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }) };
    },
  } as unknown as LanguageModel;
}
