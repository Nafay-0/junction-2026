import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { writeTelemetry } from "@/server/aiven/telemetry-sink";
import { sampleDay } from "./scorecard-fixture";
import { figuresFromEvents, figuresFromRow, scorecardSql } from "./scorecard";

/**
 * The scorecard's SQL and its in-memory twin agree on the same events. Needs a disposable PostgreSQL with
 * infra/telemetry.sql and infra/copilot.sql applied (local Docker): DOCK_SCORECARD_PG_URL=postgres://... (never Aiven).
 */
const url = process.env.DOCK_SCORECARD_PG_URL;

describe.skipIf(!url)("scorecard SQL against PostgreSQL", () => {
  it("gives the same figures as the code over the same events", async () => {
    if (/aivencloud|dock_prod/.test(url!)) throw new Error("not on a hosted database");
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query("delete from telemetry.events where source = 'dock-app' and attrs->>'test' = 'scorecard'");
      const t0 = Date.now() - 30 * 60_000;
      const events = sampleDay(t0).map((e) => ({ ...e, agentId: `${e.agentId}_sqltest`, attrs: { ...(e.attrs ?? {}), test: "scorecard" } }));
      await writeTelemetry(pool, events);
      const rows = (await pool.query(scorecardSql("1h"))).rows.filter((r) => String(r.agent_id).endsWith("_sqltest"));
      const fromSql = rows.map(figuresFromRow).sort((a, b) => a.agentId.localeCompare(b.agentId));
      const fromCode = figuresFromEvents(events, new Date(Date.now() - 3_600_000), new Date()).sort((a, b) => a.agentId.localeCompare(b.agentId));
      const strip = (f: (typeof fromCode)[number]) => ({ ...f, lastAt: f.lastAt ? new Date(f.lastAt).toISOString() : null });
      expect(fromSql.map(strip)).toEqual(fromCode.map(strip));
      await pool.query("delete from telemetry.events where attrs->>'test' = 'scorecard'");
    } finally {
      await pool.end();
    }
  });
});
