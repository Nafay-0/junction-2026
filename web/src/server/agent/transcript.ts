import type { HumanAnswer, HumanPrompt } from "./human";
import type { Tokens } from "./pricing";

/**
 * A run's complete record: every model turn, tool call, tool result, refusal, human answer, violation,
 * retry and cap, in order, plus the outcome and what it cost. Plain JSON, so a crash test can store
 * hundreds and compare them.
 */

export type TranscriptEvent =
  | { type: "model"; step: number; ms: number; text: string; reasoning?: string; toolCalls: { id: string; name: string }[]; finishReason: string; tokens: Tokens; costUsd: number | null }
  | { type: "tool_call"; step: number; id: string; name: string; args: unknown; by: "model" | "human_relay" }
  | { type: "tool_result"; step: number; id: string; name: string; ok: boolean; ms: number; result: unknown; by: "model" | "human_relay" }
  | { type: "refusal"; step: number; id: string; name: string; code: string; rule?: string; message: string }
  | { type: "tool_error"; step: number; id: string; name: string; message: string }
  | { type: "violation"; step: number; id: string; name: string; kind: "answered_for_human"; args: unknown; detail: string }
  | { type: "human"; step: number; prompt: HumanPrompt; answer: HumanAnswer }
  | { type: "retry"; step: number; attempt: number; waitMs: number; error: string }
  | { type: "cap"; step: number; cap: CapName; detail: string }
  | { type: "error"; step: number; message: string };

export type CapName = "steps" | "tokens" | "cost" | "time" | "human_rounds";

export type Outcome =
  | "committed" // the order is placed within the mandate (or a person already approved it)
  | "pending_approval" // the order waits for a person's sign-off
  | "declined" // a person declined the order
  | "refused" // Dock's last word was a refusal and the agent stopped there
  | "gave_up" // the agent stopped without an order and without a refusal
  | "awaiting_human" // the buyer did not answer one of Dock's questions
  | "cap_reached" // a step, token, cost or time cap ended the run
  | "error"; // the model provider or the connection failed

export type RunResult = {
  outcome: Outcome;
  model: string;
  task: string;
  order?: { orderId: string; status: string; totalCents?: number };
  finalText: string;
  steps: number;
  toolCalls: number;
  refusals: number;
  violations: number;
  tokens: Tokens & { total: number };
  costUsd: number | null;
  wallMs: number;
  cap?: CapName;
  error?: string;
  caps: Record<string, number>;
  tools: string[];
  startedAt: string;
  events: TranscriptEvent[];
};

const eur = (cents?: number) => (cents === undefined ? "" : `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const json = (v: unknown, n = 220) => clip(JSON.stringify(v) ?? "", n);

function resultLine(result: unknown): string {
  const r = result as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return json(result);
  const order = r.order as { orderId?: string; status?: string; totalCents?: number } | undefined;
  if (order?.status) return `order ${order.orderId} ${order.status} ${eur(order.totalCents)}`;
  if (Array.isArray(r.products)) return `${r.products.length} products: ${(r.products as { id: string }[]).map((p) => p.id).join(", ")}`;
  if (Array.isArray(r.offers)) return `${r.offers.length} offers: ${(r.offers as { productId: string; availablePacks: number; unitPriceCents: number; deliveryDate: string }[]).map((o) => `${o.productId} ${o.availablePacks} packs @ ${eur(o.unitPriceCents)} by ${o.deliveryDate}`).join("; ")}`;
  const quote = r.quote as { quoteId?: string; totalCents?: number } | undefined;
  const preview = r.policyPreview as { outcome?: string } | undefined;
  if (quote?.quoteId) return `quote ${quote.quoteId} ${eur(quote.totalCents)}, gate preview: ${preview?.outcome}`;
  const request = r.request as { requestId?: string } | undefined;
  if (request?.requestId) return `request ${request.requestId}`;
  if (r.mandate) return "mandate read";
  const step = (r.step ?? r) as { state?: string; requestId?: string };
  if (step.state) return `intake ${step.requestId} ${step.state}`;
  return json(r);
}

/** A readable transcript for a terminal. */
export function formatTranscript(r: RunResult): string {
  const out: string[] = [];
  const say = (s = "") => out.push(s);
  say(`Model ${r.model}`);
  say(`Task  ${r.task}`);
  say(`Tools ${r.tools.join(", ")}`);
  for (const e of r.events) {
    switch (e.type) {
      case "model": {
        const cost = e.costUsd === null ? "" : `, $${e.costUsd.toFixed(5)}`;
        say(`\n[${e.step}] model (${e.ms} ms, ${e.tokens.input} in / ${e.tokens.output} out${e.tokens.reasoning ? ` incl. ${e.tokens.reasoning} reasoning` : ""}${cost}, ${e.finishReason})`);
        if (e.text.trim()) for (const l of clip(e.text.trim(), 1200).split("\n")) say(`    “${l}”`);
        break;
      }
      case "tool_call":
        say(`    ${e.by === "human_relay" ? "buyer via runner" : "->"} ${e.name} ${json(e.args, 260)}`);
        break;
      case "tool_result":
        if (e.ok) say(`       <- ${resultLine(e.result)}`);
        break;
      case "refusal":
        say(`       <- REFUSED ${e.code}${e.rule ? ` (rule ${e.rule})` : ""}: ${clip(e.message, 200)}`);
        break;
      case "tool_error":
        say(`       <- ERROR ${clip(e.message, 240)}`);
        break;
      case "violation":
        say(`       !! VIOLATION ${e.kind}: ${e.detail}`);
        break;
      case "human":
        say(`    ?? Dock asks the buyer (${e.prompt.kind}): ${e.prompt.kind === "confirmation" ? e.prompt.concerns.map((c) => c.message).join(" / ") : e.prompt.questions.map((q) => q.text).join(" / ")}`);
        say(`       buyer: ${e.answer ? json(e.answer, 260) : "(no answer)"}`);
        break;
      case "retry":
        say(`    .. retry ${e.attempt} in ${e.waitMs} ms (${e.error})`);
        break;
      case "cap":
        say(`    ## cap reached: ${e.cap} (${e.detail})`);
        break;
      case "error":
        say(`    ## error: ${e.message}`);
        break;
    }
  }
  say("");
  say(`Outcome   ${r.outcome}${r.cap ? ` (${r.cap})` : ""}${r.order ? `  order ${r.order.orderId} ${r.order.status} ${eur(r.order.totalCents)}` : ""}`);
  say(`Steps     ${r.steps} model turns, ${r.toolCalls} tool calls, ${r.refusals} refusals, ${r.violations} violations`);
  say(`Tokens    ${r.tokens.input} in (${r.tokens.cachedInput} cached) / ${r.tokens.output} out (${r.tokens.reasoning} reasoning)`);
  say(`Cost      ${r.costUsd === null ? "unknown (no price for this model)" : `$${r.costUsd.toFixed(4)} estimated`}`);
  say(`Wall time ${(r.wallMs / 1000).toFixed(1)} s`);
  return out.join("\n");
}
