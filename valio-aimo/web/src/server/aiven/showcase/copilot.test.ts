import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardSql, MAX_SQL_CHARS } from "./sql-guard";
import { redact, redactDeep } from "./redact";
import { agentTerm, windowOf } from "./copilot";

describe("the copilot's SQL guard", () => {
  it("accepts one read-only SELECT over the allowed view, and caps its rows", () => {
    const g = guardSql("select kind, count(*) from telemetry.ops_events where ts > now() - interval '1 hour' group by 1 order by 2 desc;");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.relations).toEqual(["telemetry.ops_events"]);
    expect(g.wrapped).toMatch(/\) as answer limit 201$/);
    expect(guardSql("select 1 from ops_events", { maxRows: 5 })).toMatchObject({ ok: true, maxRows: 5 });
    expect(guardSql("select * from telemetry.ops_events", { maxRows: 50_000 })).toMatchObject({ ok: true, maxRows: 1_000 });
  });

  it("accepts the shapes the copilot's own questions use", () => {
    for (const sql of [
      "select distinct on (rule) rule, ok from telemetry.ops_events order by rule, ts desc",
      "with r as (select agent_id, count(*) n from telemetry.ops_events group by 1) select * from r order by n desc",
      "select extract(epoch from ts) as t, count(*) filter (where kind = 'gate.refused') from ops_events e group by 1",
      "select a.kind from telemetry.ops_events a join telemetry.ops_events b on a.request_id = b.request_id",
      "select * from (select kind from telemetry.ops_events) x",
      "select date_trunc('hour', ts) h, count(*) from telemetry.ops_events where agent_id like '%laakso%' group by 1",
      "select * from generate_series(1, 3) g",
    ]) {
      expect(guardSql(sql), sql).toMatchObject({ ok: true });
    }
  });

  it("refuses every kind of write, also hidden in a CTE or after a semicolon", () => {
    const writes = [
      "delete from telemetry.events",
      "insert into telemetry.events (source, kind) values ('x', 'y')",
      "update telemetry.events set ok = false",
      "drop table telemetry.events",
      "truncate telemetry.events",
      "alter role dock_copilot set statement_timeout = 0",
      "grant select on dock.docs to dock_copilot",
      "with d as (delete from telemetry.events returning *) select * from d",
      "select 1; delete from telemetry.events",
      "select * into telemetry.copy from telemetry.ops_events",
      "select * from telemetry.ops_events for update",
      "copy telemetry.events to stdout",
      "set statement_timeout = 0",
      "begin; delete from telemetry.events; commit",
      "call do_something()",
      "create table x as select 1",
    ];
    for (const sql of writes) {
      const g = guardSql(sql);
      expect(g.ok, sql).toBe(false);
    }
  });

  it("allows only the listed relations: not the raw table, the app's schema, partner data or the catalogues", () => {
    expect(guardSql("select * from telemetry.events")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select * from dock.docs")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select * from partner_data.catalog_index")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select * from telemetry.ops_events, dock.ledger")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select * from telemetry.ops_events e join dock.docs d on true")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select (select count(*) from dock.docs) from telemetry.ops_events")).toMatchObject({ ok: false, code: "relation" });
    expect(guardSql("select * from pg_catalog.pg_authid")).toMatchObject({ ok: false, code: "catalog" });
    expect(guardSql("select * from pg_user")).toMatchObject({ ok: false, code: "catalog" });
    expect(guardSql('select * from "pg_shadow"')).toMatchObject({ ok: false, code: "catalog" });
    expect(guardSql("select * from information_schema.tables")).toMatchObject({ ok: false, code: "catalog" });
    expect(guardSql("with x as (table telemetry.events) select * from x")).toMatchObject({ ok: false });
  });

  it("refuses sleeping, file, session and cross-database functions, and anything that hides text", () => {
    expect(guardSql("select pg_sleep(10)")).toMatchObject({ ok: false, code: "function" });
    expect(guardSql("select pg_read_file('/etc/passwd')")).toMatchObject({ ok: false, code: "function" });
    expect(guardSql("select current_setting('statement_timeout')")).toMatchObject({ ok: false, code: "function" });
    expect(guardSql("select set_config('statement_timeout', '0', false)")).toMatchObject({ ok: false, code: "function" });
    expect(guardSql("select * from dblink('host=x', 'select 1') as t(a int)")).toMatchObject({ ok: false });
    expect(guardSql("select 1 -- hidden\n")).toMatchObject({ ok: false, code: "comment" });
    expect(guardSql("select /* x */ 1")).toMatchObject({ ok: false, code: "comment" });
    expect(guardSql("select $$delete$$")).toMatchObject({ ok: false, code: "quoting" });
    expect(guardSql("select E'\\x41'")).toMatchObject({ ok: false, code: "quoting" });
    expect(guardSql("select 'unclosed")).toMatchObject({ ok: false, code: "syntax" });
    expect(guardSql("x".repeat(MAX_SQL_CHARS + 1))).toMatchObject({ ok: false, code: "too_long" });
    expect(guardSql("")).toMatchObject({ ok: false, code: "empty" });
  });

  it("is not fooled by write words inside string literals", () => {
    expect(guardSql("select count(*) from telemetry.ops_events where summary like '%delete%'")).toMatchObject({ ok: true });
  });
});

describe("what the copilot puts into SQL from a question", () => {
  it("turns time words into a fixed interval, never into typed text", () => {
    expect(windowOf("refusals in the last hour").sql).toBe("now() - interval '1 hour'");
    expect(windowOf("refusals today").sql).toBe("date_trunc('day', now())");
    expect(windowOf("last 15 minutes").sql).toBe("now() - interval '15 minutes'");
    expect(windowOf("last 99999 days").sql).toBe("now() - interval '30 days'");
    expect(windowOf("anything'; drop table x; --").sql).toBe("now() - interval '24 hours'");
  });

  it("keeps only safe characters of an agent name", () => {
    expect(agentTerm("show me everything agent_laakso_aiven_01 did")).toBe("agent_laakso_aiven_01");
    expect(agentTerm("what did agent laakso do")).toBe("laakso");
    expect(agentTerm(`everything by "x'; drop table--"`)).toMatch(/^[a-z0-9_]+$/);
    expect(agentTerm("show me everything agent X did")).toBeUndefined();
  });
});

describe("no secrets in anything the showcase sends", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.AIVEN_READONLY_TOKEN = "ro-token-ABCDEFGHIJKLMNOP1234567890";
    process.env.DOCK_COPILOT_PG_URL = "postgres://dock_copilot:s3cretPassw0rd@pg.example:1234/defaultdb?sslmode=require";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("removes configured secrets, connection strings, signed tokens, PEM blocks and secret-looking fields", () => {
    const text = [
      "token ro-token-ABCDEFGHIJKLMNOP1234567890",
      "password s3cretPassw0rd",
      "postgres://avnadmin:other-pass@host:5432/db",
      "eyJhbGciOiJFZDI1NTE5In0.eyJtYW5kYXRlIjp7fX0.c2lnbmF0dXJlc2lnbmF0dXJl",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      "Authorization: aivenv1 abcdef",
    ].join("\n");
    const out = redact(text);
    for (const leak of ["ro-token-ABCDEFGHIJKLMNOP1234567890", "s3cretPassw0rd", "other-pass", "eyJhbGci", "BEGIN PRIVATE KEY", "aivenv1 abcdef"]) expect(out).not.toContain(leak);
    expect(redactDeep({ rows: [{ password: "hunter2hunter2", note: "fine" }] })).toEqual({ rows: [{ password: "[withheld]", note: "fine" }] });
  });
});

describe("questions the data cannot answer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says so, runs nothing, and does not read kitchen memory", async () => {
    vi.resetModules();
    vi.doMock("./aiven-mcp", () => ({ mcpStatus: async () => ({ orgEnabled: true, reachable: false, sql: false, tools: 0, orgReadOnly: false, checkedAt: "" }), mcpCall: vi.fn() }));
    const query = vi.fn();
    vi.doMock("./readonly-db", () => ({ readOnlyQuery: query, readOnlyDbConfigured: () => true }));
    const { ask } = await import("./copilot");
    const weather = await ask("What will the weather be in Helsinki tomorrow?");
    expect(weather.answerable).toBe(false);
    expect(weather.answer).toMatch(/^The data does not say\./);
    expect(weather.steps).toEqual([]);
    const memory = await ask("What does Kaari usually order on Mondays?");
    expect(memory.answerable).toBe(false);
    expect(memory.answer).toMatch(/kitchen's memory/);
    expect(query).not.toHaveBeenCalled();
    const write = await ask("delete from telemetry.events");
    expect(write.refused?.code).toBe("not_select");
    expect(query).not.toHaveBeenCalled();
    vi.doUnmock("./aiven-mcp");
    vi.doUnmock("./readonly-db");
  });

  it("computes the answer from the rows, and says 'does not say' when a query fails", async () => {
    vi.resetModules();
    vi.doMock("./aiven-mcp", () => ({ mcpStatus: async () => ({ orgEnabled: true, reachable: false, sql: false, tools: 0, orgReadOnly: false, checkedAt: "" }), mcpCall: vi.fn() }));
    const rows = [
      { rule: "per_order_limit", refusals: 3, agents: 1, last_at: "x" },
      { rule: "category_allowed", refusals: 1, agents: 1, last_at: "x" },
    ];
    const query = vi.fn().mockResolvedValueOnce({ ok: true, sql: "q", columns: ["rule", "refusals"], rows, truncated: false, ms: 3, path: "direct", as: "dock_copilot" }).mockResolvedValueOnce({ ok: false, sql: "q", code: "timeout", reason: "The query ran past the 3 s limit and was stopped.", path: "direct" });
    vi.doMock("./readonly-db", () => ({ readOnlyQuery: query, readOnlyDbConfigured: () => true }));
    const { ask } = await import("./copilot");
    const card = await ask("How many orders were refused in the last hour and by which rule?");
    expect(card.answer).toBe("4 refusals in the last hour. Most by per_order_limit (3), then category_allowed (1).");
    expect(card.path).toBe("direct");
    expect(card.steps[0].rows).toEqual(rows);
    const timeout = await ask("How many orders were refused today?");
    expect(timeout.answerable).toBe(false);
    expect(timeout.answer).toBe("The data does not say.");
    expect(timeout.steps[0].error).toMatch(/3 s limit/);
    vi.doUnmock("./aiven-mcp");
    vi.doUnmock("./readonly-db");
  });
});

describe("the read-only path's own caps", () => {
  it("refuses to run an unguarded query and is not configured without its user", async () => {
    vi.resetModules();
    const saved = process.env.DOCK_COPILOT_PG_URL;
    delete process.env.DOCK_COPILOT_PG_URL;
    const { readOnlyQuery } = await import("./readonly-db");
    expect(await readOnlyQuery("delete from telemetry.events")).toMatchObject({ ok: false, code: "not_select" });
    expect(await readOnlyQuery("select 1 from telemetry.ops_events")).toMatchObject({ ok: false, code: "not_configured" });
    if (saved) process.env.DOCK_COPILOT_PG_URL = saved;
  });
});
