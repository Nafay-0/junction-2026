"use client";

import type { NeedInput } from "@/core/need";
import { helsinkiToday } from "../_ui/plain";
import { api, type ApiError } from "./api";
import { STAND_IN_MODEL, StandInError, standInInterpret } from "./interpret-standin";

/**
 * Free text -> structured need. Calls POST /api/v1/agent/interpret ({ text } -> { need, model, ms }) through
 * the console's agent, so the call carries the kitchen's mandate if the endpoint wants one.
 *
 * STAND-IN: while that endpoint does not exist (404) or cannot answer (network, 5xx), the fixed-rule reader in
 * interpret-standin.ts fills in, and the result says so (`standIn: true`). When the endpoint has landed and is
 * stable, remove the fallback branch below.
 */
export type Interpretation = { need: NeedInput; model: string; ms: number; standIn: boolean; fallbackReason?: string };

export class InterpretError extends Error {
  constructor(message: string, readonly error?: ApiError) {
    super(message);
  }
}

/** After a 404, skip the call for a minute: the endpoint is not on this server yet. */
let missingUntil = 0;

export async function interpretNeed(kitchen: string, text: string): Promise<Interpretation> {
  const started = performance.now();
  if (Date.now() < missingUntil) return standIn(text, started, "the model reader is not on this server yet");
  const r = await api<{ need: NeedInput; model: string; ms: number }>("POST", `/ui-api/kitchens/${encodeURIComponent(kitchen)}/call`, {
    method: "POST",
    path: "/api/v1/agent/interpret",
    body: { text },
  });
  if (r.ok && r.data.need) return { need: { ...r.data.need, text: r.data.need.text ?? text }, model: r.data.model, ms: r.data.ms, standIn: false };

  // The model's own refusal ("I could not tell how much") is an answer: show it, do not paper over it.
  if (!r.ok && r.status >= 400 && r.status < 500 && r.status !== 404 && r.status !== 405) throw new InterpretError(r.error.message, r.error);

  if (r.status === 404) missingUntil = Date.now() + 60_000;
  return standIn(text, started, r.ok ? "the reader sent no need" : r.status === 404 ? "the model reader is not on this server yet" : "the model reader did not answer");
}

function standIn(text: string, started: number, fallbackReason: string): Interpretation {
  try {
    const need = standInInterpret(text, helsinkiToday());
    return { need, model: STAND_IN_MODEL, ms: Math.round(performance.now() - started), standIn: true, fallbackReason };
  } catch (err) {
    if (err instanceof StandInError) throw new InterpretError(err.message);
    throw err;
  }
}
