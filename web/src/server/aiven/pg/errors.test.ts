import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isDockError } from "@/core/errors";
import { handle } from "../../http";
import { asStoreError, isStoreConnectionError, isStoreUnavailable, storeUnavailable } from "./errors";
import { createPool, inTransaction } from "./pool";

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

describe("store errors", () => {
  it("recognise the database being away, and only that", () => {
    for (const e of [
      pgError("ECONNREFUSED"),
      pgError("ECONNRESET"),
      pgError("ETIMEDOUT"),
      pgError("08006"),
      pgError("57P01"),
      pgError("57014"),
      pgError("53300"),
      new Error("timeout exceeded when trying to connect"),
      new Error("Query read timeout"),
      new Error("Connection terminated unexpectedly"),
      new Error("Connection terminated due to connection timeout"),
      Object.assign(new AggregateError([pgError("ECONNREFUSED")]), {}),
    ])
      expect(isStoreConnectionError(e), String(e.message)).toBe(true);
    for (const e of [pgError("23505"), pgError("23514"), pgError("42P01"), new Error("boom"), null, "ECONNREFUSED"]) expect(isStoreConnectionError(e)).toBe(false);
  });

  it("become one honest 503 with a sentence and a retry hint; other errors pass unchanged", () => {
    const e = asStoreError(pgError("ECONNREFUSED"));
    expect(isDockError(e) && { status: e.status, code: e.code, rule: e.rule, retry: e.details?.retryAfterSeconds }).toEqual({ status: 503, code: "store_unavailable", rule: "store", retry: 10 });
    expect((e as Error).message).toMatch(/cannot reach its database right now, so nothing was saved/);
    expect(isStoreUnavailable(e)).toBe(true);
    expect(asStoreError(e)).toBe(e);
    const unique = pgError("23505");
    expect(asStoreError(unique)).toBe(unique);
  });

  it("reach every route as JSON with Retry-After, never an empty 500", async () => {
    const res = await handle(async () => {
      throw pgError("ECONNRESET"); // e.g. a pool created outside pool.ts
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("10");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("store_unavailable");
    const again = await handle(async () => {
      throw storeUnavailable();
    });
    expect(again.status).toBe(503);
  });
});

/** A TCP server that accepts and then never answers: the database behind a dropped-packet network. */
function blackhole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((s) => {
    sockets.add(s);
    s.on("error", () => undefined);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as { port: number }).port,
        close: () => new Promise<void>((r) => (sockets.forEach((s) => s.destroy()), server.close(() => r()))),
      }),
    ),
  );
}

describe("the pool's own deadlines", () => {
  const saved = { c: process.env.DOCK_PG_CONNECT_TIMEOUT_MS, q: process.env.DOCK_PG_QUERY_TIMEOUT_MS };
  afterEach(() => {
    for (const [k, v] of [["DOCK_PG_CONNECT_TIMEOUT_MS", saved.c], ["DOCK_PG_QUERY_TIMEOUT_MS", saved.q]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("give up on a database that never answers, as store_unavailable, within the connect deadline", async () => {
    const hole = await blackhole();
    process.env.DOCK_PG_CONNECT_TIMEOUT_MS = "400";
    const pool = createPool(`postgresql://u:p@127.0.0.1:${hole.port}/db?sslmode=disable`, 1);
    try {
      const t0 = Date.now();
      const err = await pool.query("select 1").catch((e) => e);
      expect(isStoreUnavailable(err)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(3_000);
      const tx = await inTransaction(pool, async (c) => c.query("select 1")).catch((e) => e);
      expect(isStoreUnavailable(tx)).toBe(true);
    } finally {
      await pool.end().catch(() => undefined);
      await hole.close();
    }
  });

  it("refused connections fail at once, as store_unavailable", async () => {
    const hole = await blackhole();
    const port = hole.port;
    await hole.close(); // nothing listens there now
    const pool = createPool(`postgresql://u:p@127.0.0.1:${port}/db?sslmode=disable`, 1);
    try {
      const t0 = Date.now();
      const err = await pool.query("select 1").catch((e) => e);
      expect(isStoreUnavailable(err)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2_000);
    } finally {
      await pool.end().catch(() => undefined);
    }
  });
});
