/**
 * pnpm aiven:restart-test
 *
 * Proves the PostgreSQL store survives a process restart. Two separate processes share one fresh schema
 * (dock_restart_<time>) and one wholesaler key:
 *
 *   before  places a small order the agent may place alone (committed), and a large one that needs sign-off
 *           (pending); remembers the order ids, the used quote token, the approval link token, the ledger head.
 *   after   a new process with a new runtime reads the committed order back, verifies the ledger (in the app and
 *           in SQL) and checks it still ends at the head seen before plus what it adds, places an order with
 *           the used quote (must be refused: quote_replay), and signs the pending approval with its link token.
 *
 * Reads web/.env.local (DATABASE_URL). Kafka, Valkey and OpenSearch follow DOCK_AIVEN=1 if set. Prints no secrets.
 */
import { spawnSync } from "node:child_process";
import { exportJWK, generateKeyPair } from "jose";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

type Before = { orderId: string; pendingOrderId: string; approvalId: string; approvalToken: string; quoteToken: string; requestId: string; head: { seq: number; hash: string } };

async function phaseBefore(): Promise<void> {
  const { getRuntime } = await import("@/server/runtime");
  const { shutdownAiven } = await import("@/server/aiven");
  const { signMandate } = await import("@/core/mandate");
  const { DEMO_ORG, demoMandate, demoOrgKeyPair } = await import("@/server/dev-fixtures");
  const rt = await getRuntime();
  const session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
  const req = await rt.dock.openRequest(session, { text: "Restart test: 20 L of lactose-free milk." });
  const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 20 }] });
  const order = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  const big = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId: "VA-1001", quantity: 700 }] });
  const pending = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: big.quoteToken, lines: big.quote.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) });
  const msg = rt.outbox.messages().find((m) => m.orderId === pending.orderId);
  const head = rt.dock.ledger.head()!;
  await shutdownAiven();
  const out: Before = {
    orderId: order.orderId,
    pendingOrderId: pending.orderId,
    approvalId: pending.approval?.approvalId ?? "",
    approvalToken: new URL(`http://x${msg?.link ?? ""}`).searchParams.get("token") ?? "",
    quoteToken: q.quoteToken,
    requestId: req.requestId,
    head,
  };
  console.error(`before: order ${order.orderId} ${order.status}; order ${pending.orderId} ${pending.status}; ledger head #${head.seq}`);
  process.stdout.write(`\nRESULT ${JSON.stringify(out)}\n`);
}

async function phaseAfter(before: Before): Promise<void> {
  const { getRuntime } = await import("@/server/runtime");
  const { shutdownAiven } = await import("@/server/aiven");
  const { signMandate } = await import("@/core/mandate");
  const { DEMO_ORG, demoMandate, demoOrgKeyPair } = await import("@/server/dev-fixtures");
  const rt = await getRuntime();
  const results: [string, boolean, string][] = [];
  const session = await rt.dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);

  const order = await rt.dock.getOrder(session, before.orderId).catch(() => undefined);
  results.push(["order placed before the restart is readable", order?.status === "committed" && Boolean(order.confirmation), `${before.orderId}: ${order?.status ?? "missing"}`]);

  const reloaded = rt.dock.ledger.verify(before.head);
  results.push(["ledger loaded from PostgreSQL verifies up to the head seen before", reloaded.ok, reloaded.ok ? `${reloaded.length} entries, head #${reloaded.head?.seq}` : reloaded.message]);

  const replay = await rt.dock.placeOrder(session, {
    requestId: before.requestId,
    quoteToken: before.quoteToken,
    lines: order?.lines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })) ?? [],
  });
  const replayRule = replay.decision.rules.find((r) => r.outcome === "fail")?.rule;
  results.push(["used quote is still refused", replay.status === "rejected" && replayRule === "quote_replay", `status ${replay.status}, rule ${replayRule}`]);

  const signed = await rt.dock.decideApproval(before.approvalId, { decision: "approve", proof: { kind: "link_token", token: before.approvalToken } }).catch((e: Error) => e);
  results.push(["approval requested before the restart can be signed after it", !(signed instanceof Error) && signed.status === "committed", signed instanceof Error ? signed.message : `${before.pendingOrderId}: ${signed.status}`]);

  const after = rt.dock.ledger.verify();
  results.push(["ledger still verifies after new entries", after.ok && (after.head?.seq ?? -1) > before.head.seq, after.ok ? `${after.length} entries` : after.message]);
  await rt.aiven.ledger?.flush();
  const sql = await rt.aiven.ledger?.verifyInDatabase();
  results.push(["ledger verifies in SQL (ledger_verify())", Boolean(sql?.ok) && sql?.headSeq === rt.dock.ledger.head()?.seq, JSON.stringify(sql)]);

  await shutdownAiven();
  for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  process.exitCode = results.every((r) => r[1]) ? 0 : 1;
}

async function main() {
  const phase = process.argv[2];
  if (phase === "before") return phaseBefore();
  if (phase === "after") return phaseAfter(JSON.parse(process.argv[3]) as Before);
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("DATABASE_URL is not set: nothing to test.");
    return;
  }
  const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
  const env = {
    ...process.env,
    DOCK_STORE: "postgres",
    DOCK_CATALOG: "seed",
    DOCK_PG_SCHEMA: process.env.DOCK_PG_SCHEMA ?? `dock_restart_${Date.now().toString(36)}`,
    DOCK_WHOLESALER_JWK: JSON.stringify(await exportJWK(privateKey)), // the same key in both processes, as in production
  };
  console.log(`schema ${env.DOCK_PG_SCHEMA}`);
  const run = (args: string[]) => spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const a = run(["before"]);
  if (a.status !== 0) throw new Error(`first process failed (${a.status})`);
  console.log("first process exited; starting a new one");
  const result = /^RESULT (.*)$/m.exec(a.stdout)?.[1];
  if (!result) throw new Error("first process printed no result");
  const b = run(["after", result]);
  process.stdout.write(b.stdout);
  process.exitCode = b.status ?? 1;
  if (!process.env.DOCK_PG_SCHEMA && !process.argv.includes("--keep")) {
    // The free plan has 1 GB of disk: do not leave test schemas behind.
    const { createPool } = await import("@/server/aiven/pg/pool");
    const pool = createPool(undefined, 1);
    await pool.query(`drop schema if exists ${env.DOCK_PG_SCHEMA} cascade`);
    await pool.end();
    console.log(`dropped schema ${env.DOCK_PG_SCHEMA} (pass --keep to inspect it)`);
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
