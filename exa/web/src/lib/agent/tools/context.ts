import "server-only";

import type { LanguageModel } from "ai";
import type { RunMeter } from "../meter";
import type { ModelInfo } from "../models";
import type { Source } from "@/lib/widgets/types";

/** What every tool needs from the request it runs in. */
export type ToolContext = {
  meter: RunMeter;
  /** The model the user picked. */
  model: ModelInfo;
  /** The fast model for sub-agents and extraction, same family as `model`. */
  worker: { info: ModelInfo; model: LanguageModel };
  /** Two-letter country code used to localise searches, when known. */
  country?: string;
  /** "Friday 14 November 2026" style, so tools and sub-agents know the date. */
  today: string;
};

/** Turn a thrown value into a short message a widget can show. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "This took too long and was stopped.";
    return err.message;
  }
  return "Something went wrong.";
}

/** A compact, numbered source list for the model, so it can cite pages by URL. */
export function sourcesForModel(sources: Source[], max = 8): string {
  if (sources.length === 0) return "";
  return "Sources:\n" + sources.slice(0, max).map((s) => `- ${s.title ?? s.domain}: ${s.url}`).join("\n");
}

export function clip(text: string | undefined | null, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}
