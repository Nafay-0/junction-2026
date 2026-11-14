import { describe, expect, it } from "vitest";
import { emptyProfile } from "@/core/kitchen";
import { loadLocalEnv } from "../../../scripts/lib/env";
import { decide } from "./decide";
import { llmProposer, memoryModelSpec, toCandidate } from "./propose";
import { T_NUT_RULE, T_PRODUCT_TEXT, T_TRANSCRIPT_INJECTION } from "./test-interactions";

/**
 * Live, opt-in: the memory model on the test interactions (about $0.002), and pgvector on the project's
 * database. DOCK_LIVE=1 pnpm vitest run src/server/memory/live.test.ts
 */
const LIVE = process.env.DOCK_LIVE === "1";
if (LIVE) loadLocalEnv();

describe.skipIf(!LIVE || !memoryModelSpec())("memory model, live", () => {
  const propose = llmProposer({ timeoutMs: 30_000 });
  it("proposes the nut rule with its exact words, and plain code turns it into one question", async () => {
    const r = await propose({ interaction: T_NUT_RULE, families: ["yoghurt"] });
    expect(r.error).toBeUndefined();
    const d = decide(emptyProfile("org_live", "Live"), r.raw.candidates.map(toCandidate), T_NUT_RULE, new Date(T_NUT_RULE.at));
    expect(d.outcomes.filter((o) => o.action === "confirm")).toHaveLength(1);
  }, 40_000);
  it("stores nothing from a product description or an instruction in a transcript", async () => {
    for (const it of [T_PRODUCT_TEXT, T_TRANSCRIPT_INJECTION]) {
      const r = await propose({ interaction: it, families: ["yoghurt"] });
      const d = decide(emptyProfile("org_live", "Live"), r.raw.candidates.map(toCandidate), it, new Date(it.at));
      expect(d.outcomes.filter((o) => o.action !== "discarded")).toEqual([]);
    }
  }, 60_000);
});

describe.skipIf(!LIVE || !process.env.DATABASE_URL)("pgvector, live", () => {
  it("stores and searches vectors per kitchen, and never across", async () => {
    const { Pool } = await import("pg");
    const { pgConnectionString } = await import("@/server/valio/index-store");
    const { LexicalEmbedder, PgVectorIndex } = await import("./vectors");
    const pool = new Pool({ connectionString: pgConnectionString(process.env.DATABASE_URL!), max: 2 });
    const idx = new PgVectorIndex(pool, new LexicalEmbedder(), "dock_memory_vectors_test");
    try {
      await idx.upsert("org_live_a", [{ id: "a1", text: "Never nuts: a school kitchen" }]);
      await idx.upsert("org_live_b", [{ id: "b1", text: "Porridge every morning" }]);
      expect((await idx.search("org_live_a", "pähkinä nuts", 5)).map((h) => h.id)).toEqual(["a1"]);
      expect((await idx.search("org_live_b", "nuts", 5)).map((h) => h.id)).toEqual(["b1"]);
      await idx.remove("org_live_a", ["a1"]);
      expect(await idx.search("org_live_a", "nuts", 5)).toEqual([]);
    } finally {
      await pool.query("DROP TABLE IF EXISTS dock_memory_vectors_test");
      await pool.end();
    }
  }, 30_000);
});
