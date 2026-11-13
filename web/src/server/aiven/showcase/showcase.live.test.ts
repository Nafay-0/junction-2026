import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Platform section against the real services. Opt-in: DOCK_AIVEN_TESTS=1 (`pnpm test:aiven`); each block skips
 * when its address or token is absent. Read-only: nothing here writes, and no Managed Agent run is started.
 */
const enabled = process.env.DOCK_AIVEN_TESTS === "1";
if (enabled) {
  const envFile = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const dbOn = enabled && Boolean(process.env.DOCK_COPILOT_PG_URL?.trim());
const apiOn = enabled && Boolean(process.env.AIVEN_READONLY_TOKEN?.trim() && process.env.AIVEN_ORGANIZATION_ID?.trim());

describe.skipIf(!dbOn)("the copilot's database user on dock-pg", () => {
  it("reads the view, and the database itself refuses what the guard refuses", async () => {
    const { Client } = await import("pg");
    const u = new URL(process.env.DOCK_COPILOT_PG_URL!);
    u.searchParams.set("uselibpqcompat", "true");
    const c = new Client({ connectionString: u.toString() });
    await c.connect();
    try {
      await expect(c.query("select count(*) from telemetry.ops_events")).resolves.toBeTruthy();
      await expect(c.query("insert into telemetry.events (source, kind) values ('test', 'x')")).rejects.toThrow(/read-only|permission/);
      await expect(c.query("select * from telemetry.events limit 1")).rejects.toThrow(/permission/);
      await expect(c.query("select count(*) from dock.docs")).rejects.toThrow(/permission/);
      await expect(c.query("select pg_sleep(4)")).rejects.toThrow(/statement timeout/);
    } finally {
      await c.end();
    }
  });

  it("answers a question through the guarded path with rows and the query", async () => {
    const { ask } = await import("./copilot");
    const card = await ask("How many orders were refused in the last 7 days and by which rule?");
    expect(card.answerable).toBe(true);
    expect(card.steps[0].query).toMatch(/from telemetry\.ops_events/);
    expect(JSON.stringify(card)).not.toMatch(/password|aivenv1 [A-Za-z0-9]/);
  });
});

describe.skipIf(!apiOn)("Aiven MCP detection", () => {
  it("reads the organisation switch and probes the server", async () => {
    const { mcpStatus } = await import("./aiven-mcp");
    const s = await mcpStatus(true);
    expect(typeof s.orgEnabled).toBe("boolean");
    if (s.orgEnabled) expect(s.reachable).toBe(true);
    else expect(s.instruction).toMatch(/Allow MCP connections/);
  }, 30_000);
});
