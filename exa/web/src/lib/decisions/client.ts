import "server-only";

/**
 * A thin client for Gemini's Decisions API (https://aistudio.google.com/docs/decisions-api).
 *
 * A decision model does not write: it is given one shared input and up to 1,000 closed
 * questions about it, and answers each with calibrated probabilities. No words come back, so
 * there are no output tokens, and many questions take about as long as one. That is what makes
 * it possible to check dozens of pages against several wishes in about a second.
 *
 * We call the HTTP API directly, as with Exa, so the request is explicit. The field names are
 * the ones in `node_modules/@google/genai` (`decisions.create`); check there before changing them.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/decisions";

export const DECISION_MODEL = {
  id: "gemini-decision-1",
  label: "Gemini Decision 1",
  /** US dollars per million input tokens, the same for text, pictures and sound. Nothing is paid for output. */
  inputPerMTok: 0.1,
  /** The most questions one request may carry. */
  maxQuestions: 1000,
} as const;

/** A yes or no question. The answer is the probability of yes. */
export type YesNoQuestion = { type: "noul"; instructions: string; criteria?: { true_description?: string; false_description?: string } };
/** Pick one of several options, each with a description. The answer is the option and the probability of each. */
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type DecisionQuestion = YesNoQuestion | ChoiceQuestion;

export type YesNoAnswer = { type: "noul"; noul: number; confidence: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type DecisionAnswer = YesNoAnswer | ChoiceAnswer;

export type DecisionMeter = {
  /** Add what one decision request cost: only its input is paid for. */
  addJudge(inputTokens: number, costUsd: number): void;
};

export class DecisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

/** True when the server has the key the decision model needs. */
export function decisionsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY);
}

/**
 * Ask many closed questions about one input. `input` is read once and shared by every question,
 * so the questions should say which part of it they are about. What comes back is keyed like
 * `questions`.
 */
export async function decide(
  input: string,
  questions: Record<string, DecisionQuestion>,
  opts: { meter?: DecisionMeter; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ answers: Record<string, DecisionAnswer>; inputTokens: number; costUsd: number; ms: number }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new DecisionError("The decision model is not configured. Set GOOGLE_API_KEY in exa/.env.local.", 500);
  const count = Object.keys(questions).length;
  if (count === 0) return { answers: {}, inputTokens: 0, costUsd: 0, ms: 0 };
  if (count > DECISION_MODEL.maxQuestions) throw new DecisionError(`Too many questions for one request (${count}).`, 400);

  const body = JSON.stringify({ model: DECISION_MODEL.id, input, questions });
  const attempt = () => {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
  };

  const started = Date.now();
  let res = await attempt();
  // Busy or rate-limited: one polite retry, as with Exa.
  if (res.status === 429 || res.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(Number(res.headers.get("retry-after")) || 1, 3) * 1000));
    res = await attempt();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* keep the raw text */
    }
    throw new DecisionError(`The decision model answered ${res.status}: ${message}`, res.status);
  }
  const parsed = (await res.json()) as { answers?: Record<string, DecisionAnswer>; usage?: { total_input_tokens?: number; input_tokens?: number } };
  const inputTokens = parsed.usage?.total_input_tokens ?? parsed.usage?.input_tokens ?? 0;
  const costUsd = (inputTokens * DECISION_MODEL.inputPerMTok) / 1_000_000;
  opts.meter?.addJudge(inputTokens, costUsd);
  return { answers: parsed.answers ?? {}, inputTokens, costUsd, ms: Date.now() - started };
}
