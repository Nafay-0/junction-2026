import { generateText, Output, type LanguageModel } from "ai";
import { DockError } from "@/core/errors";
import { createModel, ModelConfigError } from "../../agent/models";
import { costOf, tokensFromUsage, type Price } from "../../agent/pricing";
import { describeError, isRetryable, withRetry } from "../../agent/retry";
import { scanSystem, scanUser } from "../prompts";
import { RawScan, toLines, type ScanLine, type SourceKind } from "./lines";

/**
 * The document reader for the photo door: an image, a PDF or pasted text to lines for the buyer to review.
 * The file is passed to the model from memory and dropped when the request ends; nothing is written to disk
 * or kept.
 *
 * Model: DOCK_SCAN_MODEL as `provider:model-id`, default anthropic:claude-haiku-5-5, chosen by the fixed
 * evaluation (web/scripts/eval/eval-scan.ts; results in web/docs/doors.md): every line right and nothing unsafe in
 * both runs, $0.001 and about 5 s a page. google:gemini-3.1-flash-lite scored the same in the evaluation but
 * guessed a smudged amount once in a separate try. `featherless:<model-id>` runs a model
 * on Featherless (OpenAI-compatible, FEATHERLESS_API_KEY), which is how NVIDIA's models were evaluated.
 */

export const DEFAULT_SCAN_MODEL = "anthropic:claude-haiku-5-5";

const EXTRA_PRICES: Record<string, Price> = {
  "featherless:nvidia/Cosmos-Reason2-32B": { inputPerM: 0.416, outputPerM: 1.664 },
  "featherless:Qwen/Qwen3-VL-32B-Instruct": { inputPerM: 0.104, outputPerM: 0.416 },
  "featherless:nvidia/Nemotron-3.5-Content-Safety": { inputPerM: 0.05, outputPerM: 0.1 },
};

export function scanModel(spec?: string): { model: LanguageModel; id: string; price?: Price } {
  const s = spec ?? process.env.DOCK_SCAN_MODEL?.trim() ?? DEFAULT_SCAN_MODEL;
  try {
    if (s.startsWith("featherless:")) {
      const id = s.slice("featherless:".length);
      const apiKey = process.env.FEATHERLESS_API_KEY;
      if (!apiKey) throw new ModelConfigError("No API key for featherless: set FEATHERLESS_API_KEY.", "model_key_missing");
      const m = createModel(`compat:${id}`, { baseURL: "https://api.featherless.ai/v1", apiKey });
      return { model: m.model, id: s, price: EXTRA_PRICES[s] };
    }
    const m = createModel(s);
    return { model: m.model, id: m.spec.id, price: m.price ?? EXTRA_PRICES[s] };
  } catch (err) {
    if (err instanceof ModelConfigError) throw new DockError(503, "scan_unavailable", `The document reader is not configured: ${err.message}`);
    throw err;
  }
}

export type ScanInput = { kind: "image" | "pdf"; bytes: Uint8Array; mediaType: string } | { kind: "text"; text: string };

export type ScanResult = {
  kind: SourceKind;
  isOrderList: boolean;
  deliverByAsWritten: string | null;
  lines: ScanLine[];
  model: string;
  ms: number;
  costUsd: number | null;
};

export async function readDocument(input: ScanInput, opts: { model?: string | { model: LanguageModel; id: string; price?: Price }; timeoutMs?: number } = {}): Promise<ScanResult> {
  const m = typeof opts.model === "object" ? opts.model : scanModel(opts.model);
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.DOCK_SCAN_TIMEOUT_MS) || 45_000);
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  const content =
    input.kind === "text"
      ? [{ type: "text" as const, text: scanUser("text", input.text) }]
      : [
          { type: "file" as const, data: input.bytes, mediaType: input.mediaType },
          { type: "text" as const, text: scanUser(input.kind) },
        ];
  let res;
  try {
    res = await withRetry(
      () =>
        generateText({
          model: m.model,
          instructions: scanSystem(),
          messages: [{ role: "user", content }],
          output: Output.object({ schema: RawScan, name: "purchase_list", description: "Every line of the list, transcribed." }),
          maxOutputTokens: 6000,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      { deadline, policy: { maxRetries: 1, baseMs: 800, maxMs: 4000 } },
    );
  } catch (err) {
    if (Date.now() >= deadline || (err as Error)?.name === "TimeoutError") throw new DockError(504, "scan_timeout", `The reader did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    throw new DockError(isRetryable(err) ? 503 : 502, "scan_failed", `The reader failed: ${describeError(err)}`);
  }
  const raw = RawScan.safeParse(res.output);
  if (!raw.success) throw new DockError(502, "scan_invalid_output", "The reader returned something that is not a list.");
  const tokens = tokensFromUsage(res.usage);
  return {
    kind: input.kind,
    isOrderList: raw.data.isOrderList,
    deliverByAsWritten: raw.data.deliverByAsWritten?.trim().slice(0, 60) || null,
    lines: toLines(raw.data, input.kind),
    model: m.id,
    ms: Date.now() - t0,
    costUsd: costOf(tokens, m.price),
  };
}
