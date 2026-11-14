import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEED_PRODUCTS } from "@/core/seed";
import { loadLocalEnv } from "../../../scripts/lib/agent-cli";
import { resetRuntime } from "../runtime";
import { interpretNeed, vocabularyFrom } from "./interpret";
import { CHEAP_DEFAULTS, hasCredentials, type Provider } from "./models";
import { runBuyerAgent } from "./runner";

/**
 * Live smoke tests: one interpret call and one capped agent run per provider, on the milk example.
 * They spend real money (about a cent per provider), so they run only with DOCK_LIVE=1, and each provider
 * is skipped cleanly when its key (or, for OpenAI-compatible endpoints, base URL and model) is missing.
 *
 *   DOCK_LIVE=1 pnpm vitest run src/server/agent/live.test.ts
 */
const LIVE = process.env.DOCK_LIVE === "1";
if (LIVE) loadLocalEnv();

const MILK = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
const NOW = new Date("2026-11-13T12:00:00+02:00"); // a Friday: Monday is 2026-11-16

const models: [Provider, string | undefined][] = [
  ["anthropic", CHEAP_DEFAULTS.anthropic],
  ["openai", CHEAP_DEFAULTS.openai],
  ["google", CHEAP_DEFAULTS.google],
  ["compat", process.env.OPENAI_COMPATIBLE_MODEL && `compat:${process.env.OPENAI_COMPATIBLE_MODEL}`],
  ["verda", process.env.VERDA_MODEL && `verda:${process.env.VERDA_MODEL}`],
  ["nvidia", process.env.NVIDIA_MODEL && `nvidia:${process.env.NVIDIA_MODEL}`],
];

beforeAll(() => {
  if (!LIVE) console.info("live smoke tests skipped: set DOCK_LIVE=1 to run them (they call paid APIs)");
});

for (const [provider, model] of models) {
  const enabled = LIVE && !!model && hasCredentials(provider);
  describe.skipIf(!enabled)(`live: ${model ?? provider}`, () => {
    beforeEach(() => resetRuntime());

    it("interprets the milk example", async () => {
      const r = await interpretNeed({ text: MILK, now: NOW, model, vocabulary: vocabularyFrom(SEED_PRODUCTS) });
      expect(r.need).toMatchObject({ text: MILK, item: { category: "milk", attributes: ["lactose_free"] }, quantity: { amount: 1000, unit: "L" }, deliverBy: "2026-11-16" });
    }, 60_000);

    it("runs the milk order to a final state within the caps", async () => {
      const r = await runBuyerAgent({ model: model!, task: MILK, caps: { maxSteps: 14, maxCostUsd: 0.03, maxWallMs: 150_000 } });
      expect(r.outcome).not.toBe("error");
      expect(r.steps).toBeGreaterThan(0);
      if (r.costUsd !== null) expect(r.costUsd).toBeLessThanOrEqual(0.03);
    }, 180_000);
  });
}
