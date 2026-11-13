"use client";

import type { NeedInput } from "@/core/need";
import { helsinkiToday } from "../_ui/plain";
import { api } from "./api";
import { STAND_IN_MODEL, StandInError, standInInterpret } from "./interpret-standin";

/**
 * Free text -> structured need, through POST /api/v1/agent/interpret ({ text } -> { need, model, ms }), sent by
 * the console's agent so it carries the kitchen's mandate. Every answer comes back as data for the console:
 *
 *   ok             the model filled the need
 *   incomplete     422 need_incomplete: what it understood (`partial`) and what is `missing`; the buyer adds it as fields
 *   not_purchase   422 not_a_purchase_request: say so, plainly
 *   unavailable    502 / 503 / 504 or no connection: offer a retry, and the offline example reader
 *
 * OFFLINE EXAMPLE: interpret-standin.ts, a fixed-rule reader for the demo sentences. Used only when the buyer
 * asks for it after the model failed, or automatically on a server that has no interpret route at all (404).
 */
export type Interpretation = { need: NeedInput; model: string; ms: number; offline: boolean; addedByBuyer?: ("item" | "quantity")[] };

export type InterpretOutcome =
  | { kind: "ok"; interp: Interpretation }
  | { kind: "incomplete"; message: string; missing: ("item" | "quantity")[]; partial: NeedInput; model: string }
  | { kind: "not_purchase"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

type Details = { missing?: string[]; partial?: NeedInput };

export async function interpretNeed(kitchen: string, text: string): Promise<InterpretOutcome> {
  const started = performance.now();
  const r = await api<{ need: NeedInput; model: string; ms: number }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen)}/call`, {
    method: "POST",
    path: "/api/v1/agent/interpret",
    body: { text },
  });
  if (r.ok && r.data.need) return { kind: "ok", interp: { need: { ...r.data.need, text: r.data.need.text ?? text }, model: r.data.model, ms: r.data.ms, offline: false } };
  if (r.ok) return { kind: "unavailable", message: "The reader answered without a need." };

  const e = r.error;
  if (e.code === "need_incomplete") {
    const d = (e.details ?? {}) as Details;
    const missing = (d.missing ?? []).filter((m): m is "item" | "quantity" => m === "item" || m === "quantity");
    return { kind: "incomplete", message: e.message, missing, partial: { ...(d.partial ?? { item: { text: "" } }), text }, model: "the model reader" };
  }
  if (e.code === "not_a_purchase_request") return { kind: "not_purchase", message: e.message };
  if (r.status === 404 && e.code !== "kitchen_not_found") {
    // A server without the interpret route: the offline reader is the only reader there is.
    return offlineExample(text, started);
  }
  if (r.status === 0 || r.status >= 500) return { kind: "unavailable", message: e.message };
  return { kind: "error", message: e.message };
}

/** The offline example reader, labelled as such wherever its result is shown. */
export function offlineExample(text: string, started = performance.now()): InterpretOutcome {
  try {
    const need = standInInterpret(text, helsinkiToday());
    return { kind: "ok", interp: { need, model: STAND_IN_MODEL, ms: Math.round(performance.now() - started), offline: true } };
  } catch (err) {
    if (err instanceof StandInError) return { kind: "error", message: err.message };
    throw err;
  }
}
