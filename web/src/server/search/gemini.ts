/**
 * The two Google calls smart search makes, over plain fetch with a deadline: one query embedding
 * (gemini-embedding-2) and one Decisions request (gemini-decision-1). Both read GEMINI_API_KEY from the environment
 * and never log it. Prices are per million input tokens; neither model bills output.
 */

export const EMBED_MODEL = "gemini-embedding-2";
export const DECISION_MODEL = "gemini-decision-1";
/** USD per million input tokens (aistudio.google.com/docs/pricing, read 14 Nov 2026). */
export const EMBED_USD_PER_M = 0.2;
export const DECISION_USD_PER_M = 0.1;

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(
    readonly code: "no_key" | "timeout" | "http" | "refused" | "quota" | "network" | "bad_answer",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export function geminiKey(): string | undefined {
  const v = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return v && v.trim() ? v.trim() : undefined;
}

async function post<T>(url: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const key = geminiKey();
  if (!key) throw new GeminiError("no_key", "GEMINI_API_KEY is not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new GeminiError("timeout", `no answer within ${timeoutMs} ms`)), timeoutMs);
  const onAbort = () => ctl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message?.slice(0, 300) ?? msg;
      } catch {
        // not JSON
      }
      const code = res.status === 429 ? "quota" : res.status === 400 && /safety|blocked|prohibited/i.test(msg) ? "refused" : "http";
      throw new GeminiError(code, `HTTP ${res.status}: ${msg}`, res.status);
    }
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (ctl.signal.aborted && ctl.signal.reason instanceof GeminiError) throw ctl.signal.reason;
    throw new GeminiError("network", err instanceof Error ? err.message.slice(0, 200) : "network error");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ---------- embeddings ----------

export type EmbedResult = { vectors: Float32Array[]; tokens: number };

/** Embed up to 100 texts (already in the model's prompt format) at `dim` dimensions. */
export async function embedTexts(texts: string[], dim: number, timeoutMs: number, signal?: AbortSignal): Promise<EmbedResult> {
  if (texts.length > 100) throw new Error("at most 100 texts per call");
  type R = { embeddings?: { values: number[] }[]; usageMetadata?: { promptTokenCount?: number } };
  const r = await post<R>(
    `${BASE}/models/${EMBED_MODEL}:batchEmbedContents`,
    { requests: texts.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] }, output_dimensionality: dim })) },
    timeoutMs,
    signal,
  );
  if (!r.embeddings || r.embeddings.length !== texts.length) throw new GeminiError("bad_answer", "embedding count does not match");
  return { vectors: r.embeddings.map((e) => Float32Array.from(e.values)), tokens: r.usageMetadata?.promptTokenCount ?? 0 };
}

/** The query prompt gemini-embedding-2 expects for asymmetric retrieval. */
export const queryPrompt = (text: string) => `task: search result | query: ${text}`;

// ---------- decisions ----------

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true_description: string; false_description: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type DecisionAnswer = {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence: number;
};

export type DecisionResult = { answers: Record<string, DecisionAnswer>; tokens: number };

export async function decide(input: string, questions: Record<string, DecisionQuestion>, timeoutMs: number, signal?: AbortSignal): Promise<DecisionResult> {
  type R = { answers?: Record<string, DecisionAnswer>; usage?: { total_input_tokens?: number; total_tokens?: number } };
  const r = await post<R>(`${BASE}/decisions`, { model: DECISION_MODEL, input, questions }, timeoutMs, signal);
  if (!r.answers) throw new GeminiError("bad_answer", "no answers in the response");
  return { answers: r.answers, tokens: r.usage?.total_input_tokens ?? r.usage?.total_tokens ?? 0 };
}
