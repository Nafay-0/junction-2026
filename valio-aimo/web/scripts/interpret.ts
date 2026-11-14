/**
 * Free text to the structured need, from the terminal (Job 1 without the HTTP route).
 *
 *   pnpm interpret "I need 1,000 litres of lactose-free milk by Monday" [--model anthropic:claude-haiku-5-5] [--now 2026-11-13T10:00:00+02:00] [--raw]
 *
 * Reads keys from .env.local. The vocabulary is the seed catalogue plus the demo mandate's tags.
 */
import { SEED_PRODUCTS } from "@/core/seed";
import { interpretNeed, vocabularyFrom } from "@/server/agent/interpret";
import { demoMandate } from "@/server/dev-fixtures";
import { loadLocalEnv, flag } from "./lib/agent-cli";

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const text = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!text) throw new Error('Usage: pnpm interpret "<text>" [--model provider:model-id] [--now ISO] [--raw]');
  const m = demoMandate(new Date());
  const vocabulary = vocabularyFrom(SEED_PRODUCTS, { categories: m.allowedCategories, attributes: m.requiredAttributes, allergens: m.forbiddenAllergens });
  const now = flag(args, "--now");
  try {
    const r = await interpretNeed({ text, model: flag(args, "--model"), now: now ? new Date(now) : undefined, vocabulary });
    console.log(JSON.stringify(args.includes("--raw") ? r : { need: r.need, model: r.model, ms: r.ms, tokens: r.tokens, costUsd: r.costUsd }, null, 2));
  } catch (err) {
    const e = err as { status?: number; code?: string; message: string; details?: unknown };
    console.log(JSON.stringify({ error: { status: e.status, code: e.code, message: e.message, details: e.details } }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
