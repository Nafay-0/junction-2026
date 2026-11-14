import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoMandate } from "../dev-fixtures";
import { connectMaria, isoTime, type Maria } from "./client";
import { MARIADB_ENV, mariaUrl } from "./config";
import { listOrders, rulesAsOf } from "./history";
import { MariaMirror } from "./mirror";
import { AURINKO, SCENARIO_WRITER, runScenario, type ScenarioResult } from "./scenario";
import { ensureSchema } from "./schema";
import { timeMachineView } from "./service";
import { decisionDoc, indexDecisions, similarTo, type TextEmbedder } from "./vector";

/**
 * Against a real MariaDB: runs only when DOCK_MARIADB_URL is set, in a throwaway database dock_test_* that it creates
 * and drops (the compose file grants that to its user), so the database the variable names is never touched.
 * Start one with: docker compose -f infra/mariadb/compose.yaml up -d --wait
 */
const url = mariaUrl();

describe.runIf(!url)("the audit time machine on a real MariaDB", () => {
  it(`is skipped: ${MARIADB_ENV} is not set`, () => {
    console.warn(`[mariadb] live tests skipped: ${MARIADB_ENV} is not set. Start one with docker compose -f infra/mariadb/compose.yaml up -d --wait and set ${MARIADB_ENV}=mariadb://dock:dock@127.0.0.1:3407/dock_audit.`);
  });
});

describe.skipIf(!url)("the audit time machine on a real MariaDB", () => {
  const dbName = `dock_test_${randomUUID().slice(0, 8)}`;
  let admin: Maria;
  let db: Maria;
  let sc: ScenarioResult;

  beforeAll(async () => {
    admin = connectMaria(url!, { connections: 1 });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(url!);
    u.pathname = `/${dbName}`;
    db = connectMaria(u.toString(), { connections: 3 });
    await ensureSchema(db);
    sc = await runScenario(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.close();
  });

  it("keeps the history itself: three mandate versions, each starting at the scenario's moment", async () => {
    const r = await db.query("SELECT per_order_limit_cents AS l, forbidden_allergens AS f, ROW_START AS s FROM gate_mandate FOR SYSTEM_TIME ALL WHERE agent_id = ? ORDER BY ROW_START", [AURINKO.agentId]);
    expect(r.rows.map((x) => Number(x.l))).toEqual([40_000, 40_000, 100_000]);
    expect(isoTime(r.rows[1].s)).toBe(new Date(Date.parse(sc.anchor) + 7 * 86_400_000 + 6 * 3_600_000).toISOString());
    expect(String(r.rows[1].f)).toContain("gluten");
  });

  it("the same order gets different verdicts as of two times, for the right reason", async () => {
    const A = await timeMachineView(db, { orderId: sc.orders.A });
    expect(A.replay!.reproduces.same).toBe(true);
    expect(A.replay!.then.outcome).toBe("auto_approve");
    expect(A.replay!.now.outcome).toBe("reject");
    expect(A.replay!.thenVsNow.map((d) => d.rule)).toEqual(["forbidden_allergens"]);

    const B = await timeMachineView(db, { orderId: sc.orders.B });
    expect(B.replay!.then.outcome).toBe("needs_human_approval");
    expect(B.replay!.thenVsNow.map((d) => d.rule).sort()).toEqual(["per_order_limit", "weekly_budget"]);
    expect(B.replay!.termsDisagree).toEqual([]);
    expect(B.changes.some((c) => c.what.includes("€400 to €1,000"))).toBe(true);
    // The door the request came through is recorded with the order and shown with it.
    expect(B.order!.body.door).toBe("mcp");
    expect(B.orders.find((o) => o.orderId === sc.orders.B)?.doorText).toBe("an outside agent over MCP");
  });

  it("slides an order to the recall drill and to the night the agent was suspended", async () => {
    const hold = sc.moments.find((m) => m.label.startsWith("Recall drill"))!.at;
    const sus = sc.moments.find((m) => m.label === "Agent suspended")!.at;
    const atHold = await timeMachineView(db, { orderId: sc.orders.D, at: new Date(Date.parse(hold) + 3_600_000).toISOString() });
    expect(atHold.replay!.at.outcome).toBe("reject");
    expect(atHold.replay!.atVsNow.map((d) => d.rule)).toContain("recall_hold");
    // The gate's own rule, not a check beside it: it appears once, in the gate's rule list, with the drill's reason.
    expect(atHold.replay!.at.rules.filter((r) => r.rule === "recall_hold")).toMatchObject([{ outcome: "fail" }]);
    expect(atHold.replay!.at.rules.find((r) => r.rule === "recall_hold")!.reason).toContain("Recall drill");
    const atSus = await timeMachineView(db, { orderId: sc.orders.D, at: new Date(Date.parse(sus) + 1_800_000).toISOString() });
    expect(atSus.replay!.at.outcome).toBe("refused_at_door");
    expect(atSus.rulesAt.some((r) => r.area === "suspension")).toBe(true);
  });

  it("the live mirror (no session clock) is stamped by the server, and re-signing the same terms makes no version", async () => {
    const m = demoMandate(new Date());
    let current = m;
    const mirror = new MariaMirror({ db, writer: "live-test", intervalMs: 0, read: async () => ({ now: new Date(), mandates: [current], orders: [], requests: new Map(), unverified: new Map(), kitchens: [], holds: [], suspensions: [] }) });
    await mirror.sync();
    current = demoMandate(new Date(Date.now() + 60_000)); // a new id and window, same terms
    await mirror.sync();
    current = { ...current, perOrderLimitCents: 123_400 };
    await mirror.sync();
    const r = await db.query("SELECT per_order_limit_cents AS l, mandate_id, ROW_START AS s FROM gate_mandate FOR SYSTEM_TIME ALL WHERE agent_id = ? ORDER BY ROW_START", [m.agentId]);
    expect(r.rows.map((x) => Number(x.l))).toEqual([m.perOrderLimitCents, 123_400]);
    expect(Math.abs(Date.parse(isoTime(r.rows[1].s)!) - Date.now())).toBeLessThan(60_000);
    // The scenario's rows belong to another writer: the live mirror never touched them.
    expect((await rulesAsOf(db, AURINKO.orgId, new Date().toISOString())).rows.some((x) => x.area === "mandate")).toBe(true);
    expect((await listOrders(db)).rows.filter((o) => o.scenario).length).toBe(sc.counts.orders);
    await mirror.stop();
  });

  it("finds decisions like one in one statement with the mandate terms in force at each (vector + FOR SYSTEM_TIME)", async () => {
    // A deterministic stand-in for the embedding model: bag of words hashed into the column's 1,536 dimensions.
    const fake: TextEmbedder = {
      id: "test",
      dims: 1536,
      embed: async (texts) =>
        texts.map((t) => {
          const v = new Array<number>(1536).fill(0);
          for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1536, 7)] += 1;
          v[0] += 0.01;
          return v;
        }),
    };
    const docs = sc.ledger.map((e) => decisionDoc(e, (id) => sc.owner.get(id))).filter((d): d is NonNullable<typeof d> => !!d);
    expect(await indexDecisions(db, SCENARIO_WRITER, docs, fake)).toBe(docs.length);
    const [q] = await fake.embed([docs.find((d) => d.orderId === sc.orders.B)!.explanation]);
    const like = await similarTo(db, q, 3);
    expect(like.rows[0].orderId).toBe(sc.orders.B);
    expect(like.rows[0].doorText).toBe("an outside agent over MCP");
    expect(like.rows[0].termsThen?.perOrderLimitCents).toBe(40_000); // the limit as it stood at B's moment, not today's €1,000
    expect(like.sql).toContain("FOR SYSTEM_TIME ALL");
    expect(like.sql).toContain("VEC_DISTANCE_COSINE");
  });
});
