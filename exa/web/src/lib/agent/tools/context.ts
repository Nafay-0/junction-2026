import "server-only";

import type { LanguageModel } from "ai";
import type { ResearchDepth } from "../depth";
import type { RunMeter } from "../meter";
import type { Effort, ModeId } from "../modes";
import type { ModelInfo } from "../models";
import type { ClientKind } from "@/lib/client-kind";
import type { Source } from "@/lib/widgets/types";

/** What every tool needs from the request it runs in. */
export type ToolContext = {
  meter: RunMeter;
  /** The mode the user picked and how far the effort dial is turned. */
  mode: ModeId;
  effort: Effort;
  /** How far research goes at this mode and effort: team size, searches, sources, report length. */
  depth: ResearchDepth;
  /** The model behind the mode. */
  model: ModelInfo;
  /** The fast model for sub-agents and extraction, same family as `model`. */
  worker: { info: ModelInfo; model: LanguageModel };
  /** Two-letter country code used to localise searches, when known. */
  country?: string;
  /** The user's exact position, when they have shared it through the browser. */
  coords?: { lat: number; lng: number; label?: string };
  /** "Friday 14 November 2026" style, so tools and sub-agents know the date. */
  today: string;
  /** Where the request comes from: the desktop app (which has a live browser) or the web. */
  client: ClientKind;
  /**
   * The account the request is for, and what a job made in it should carry along: the user's
   * time zone, their approximate place and the chat it was made in. Set by the chat; without an
   * account the tools that manage jobs are left out (a live call, a run of a job).
   */
  userId?: string;
  timeZone?: string;
  place?: string;
  conversationId?: string;
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
