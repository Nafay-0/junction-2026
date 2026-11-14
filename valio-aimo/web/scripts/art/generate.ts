/**
 * Generate original still-life art for the shop with the OpenAI Images API.
 *
 *   pnpm tsx scripts/art/generate.ts                 # every key without a raw file yet
 *   pnpm tsx scripts/art/generate.ts --only hero,dept-10
 *   pnpm tsx scripts/art/generate.ts --only hero --force
 *   pnpm tsx scripts/art/generate.ts --dry-run       # print the plan and estimate only
 *
 * Reads scripts/art/prompts.json (shared style + negative clause + per-key subject),
 * writes raw output to .art-raw/<key>.png (git-ignored) and appends the real cost,
 * computed from the response's `usage`, to scripts/art/spend.json. Refuses to start a
 * batch whose estimate would take the running total over the budget in spend.json.
 *
 * OPENAI_API_KEY comes from the environment or web/.env.local; it is never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..");
const RAW_DIR = join(WEB, ".art-raw");
const PROMPTS = join(HERE, "prompts.json");
const SPEND = join(HERE, "spend.json");

// USD per 1M tokens, gpt-image-2.5/2.6 family (developers.openai.com/api/docs/pricing, read 2026-11-14).
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 };
// Estimate only: ~1449 output tokens for a 1024x1024 medium image on gpt-image-2.6 (third-party
// measurements; OpenAI publishes only a calculator). Scaled by pixel count and quality.
const EST_TOKENS_1MP: Record<string, number> = { low: 823, medium: 1449, high: 4200 };

type Kind = "tile" | "department" | "hero";
type Entry = { kind: Kind; subject: string; accent?: string; size?: string; quality?: string };
type Prompts = {
  model: string;
  defaults: { quality: string; output_format: string; sizes: Record<Kind, string> };
  style: string;
  framing: Record<Kind, string>;
  accents: Record<string, string>;
  negative: string;
  images: Record<string, Entry>;
};
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  output_tokens_details?: { image_tokens?: number; text_tokens?: number };
};
type SpendEntry = {
  key: string;
  at: string;
  model: string;
  size: string;
  quality: string;
  usage: Usage | null;
  costUsd: number;
  estimated: boolean;
};
type Spend = { budgetUsd: number; totalUsd: number; entries: SpendEntry[] };

function loadKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = join(WEB, ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, "");
    }
  }
  throw new Error("OPENAI_API_KEY is not set (environment or web/.env.local)");
}

function readSpend(): Spend {
  if (!existsSync(SPEND)) return { budgetUsd: 6, totalUsd: 0, entries: [] };
  return JSON.parse(readFileSync(SPEND, "utf8")) as Spend;
}

function writeSpend(s: Spend) {
  s.totalUsd = round(s.entries.reduce((a, e) => a + e.costUsd, 0));
  writeFileSync(SPEND, JSON.stringify(s, null, 2) + "\n");
}

const round = (n: number) => Math.round(n * 10000) / 10000;

function pixels(size: string): number {
  const [w, h] = size.split("x").map(Number);
  return w * h;
}

function estimate(size: string, quality: string): number {
  const tokens = (EST_TOKENS_1MP[quality] ?? EST_TOKENS_1MP.high) * (pixels(size) / (1024 * 1024));
  return (tokens * PRICE.imageOut + 400 * PRICE.textIn) / 1e6;
}

function costOf(u: Usage | undefined): number | null {
  if (!u || typeof u.output_tokens !== "number") return null;
  const textIn = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
  const imageIn = u.input_tokens_details?.image_tokens ?? 0;
  // Price every output token at the image-output rate (text output has no listed rate).
  return (textIn * PRICE.textIn + imageIn * PRICE.imageIn + u.output_tokens * PRICE.imageOut) / 1e6;
}

export function buildPrompt(p: Prompts, e: Entry): string {
  const accent = p.accents[e.accent ?? "dill"];
  if (!accent) throw new Error(`unknown accent "${e.accent}"`);
  return [e.subject, p.framing[e.kind], p.style, accent, p.negative].join("\n\n");
}

function args() {
  const a = process.argv.slice(2);
  const onlyIdx = a.indexOf("--only");
  const only = onlyIdx >= 0 ? a[onlyIdx + 1]?.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const concIdx = a.indexOf("--concurrency");
  return {
    only,
    force: a.includes("--force"),
    dryRun: a.includes("--dry-run"),
    concurrency: concIdx >= 0 ? Math.max(1, Number(a[concIdx + 1]) || 1) : 3,
  };
}

async function generateOne(apiKey: string, p: Prompts, key: string, e: Entry, spend: Spend) {
  const size = e.size ?? p.defaults.sizes[e.kind];
  const quality = e.quality ?? p.defaults.quality;
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      prompt: buildPrompt(p, e),
      size,
      quality,
      output_format: p.defaults.output_format,
      background: "opaque",
      n: 1,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[];
    usage?: Usage;
    error?: { message?: string; code?: string };
  };
  if (!res.ok || !body.data?.[0]?.b64_json) {
    // A rejected request is not billed; record nothing.
    throw new Error(`${key}: HTTP ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim());
  }
  writeFileSync(join(RAW_DIR, `${key}.${p.defaults.output_format}`), Buffer.from(body.data[0].b64_json, "base64"));
  const real = costOf(body.usage);
  const entry: SpendEntry = {
    key,
    at: new Date().toISOString(),
    model: p.model,
    size,
    quality,
    usage: body.usage ?? null,
    costUsd: round(real ?? estimate(size, quality)),
    estimated: real === null,
  };
  spend.entries.push(entry);
  writeSpend(spend);
  console.log(
    `  ok  ${key}  ${size} ${quality}  $${entry.costUsd.toFixed(4)}${entry.estimated ? " (estimated)" : ""}` +
      `  out=${body.usage?.output_tokens ?? "?"} tok  ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
}

async function main() {
  const { only, force, dryRun, concurrency } = args();
  const p = JSON.parse(readFileSync(PROMPTS, "utf8")) as Prompts;
  mkdirSync(RAW_DIR, { recursive: true });

  const unknown = (only ?? []).filter((k) => !p.images[k]);
  if (unknown.length) throw new Error(`unknown keys: ${unknown.join(", ")}`);

  const keys = (only ?? Object.keys(p.images)).filter(
    (k) => force || !existsSync(join(RAW_DIR, `${k}.${p.defaults.output_format}`)),
  );
  const spend = readSpend();
  const est = keys.reduce((a, k) => {
    const e = p.images[k];
    return a + estimate(e.size ?? p.defaults.sizes[e.kind], e.quality ?? p.defaults.quality);
  }, 0);
  console.log(
    `${keys.length} image(s) to generate with ${p.model}: ${keys.join(", ") || "(none)"}\n` +
      `estimate $${est.toFixed(3)}; spent so far $${spend.totalUsd.toFixed(4)} of $${spend.budgetUsd} budget`,
  );
  if (!keys.length || dryRun) return;
  if (spend.totalUsd + est > spend.budgetUsd) {
    throw new Error(`batch would exceed the budget ($${(spend.totalUsd + est).toFixed(3)} > $${spend.budgetUsd})`);
  }

  const apiKey = loadKey();
  const queue = [...keys];
  const failures: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let k = queue.shift(); k; k = queue.shift()) {
        try {
          await generateOne(apiKey, p, k, p.images[k], spend);
        } catch (err) {
          failures.push(k);
          console.error(`  FAIL ${(err as Error).message}`);
        }
      }
    }),
  );
  console.log(`done; total spend $${spend.totalUsd.toFixed(4)}${failures.length ? `; failed: ${failures.join(", ")}` : ""}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
