/**
 * Two of the partner's example scenarios end to end, in process, on whatever catalogue this checkout runs (the
 * partner's real one with VALIO_API_KEY and its index; the seed otherwise):
 *
 *   1. Supplier stock-out: a stock-out of Kaari's usual milk is staged (the mock API will not run out on cue); the
 *      kitchen's agent's watch notices in one live call, ranks substitutes, says it in the conversation's words and,
 *      on a yes, switches the order through the gate.
 *   2. Standing-order drift: the watch learns Kaari's recurring orders; creeping portions are staged on the milk;
 *      Sanna switches auto-renew on; the watch holds the milk before renewing and asks; the cream (nothing drifted)
 *      is renewed alone.
 *   3. The same as an outside buyer's agent: a stock MCP client with Kaari's mandate (watch_orders, answer_watch,
 *      set_auto_renew).
 *
 *   pnpm scenarios
 *
 * A few live calls (the watch: one per run for the key products, one for a finding's substitutes; each order's
 * quote). One relevance-judge search per finding on the real catalogue (about 0.06 US cents).
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { getRuntime, resetRuntime } from "@/server/runtime";
import { resolveKitchen } from "@/server/console-kitchens";
import { liftStage, runWatch, setAutoRenew, stageDrift, stageStockOut, standingFor, watchView, type Finding, type Renewal } from "@/server/watch/service";
import { answerWatchMoment, watchAnswerOf, watchMomentForThread } from "@/server/watch/thread";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
process.env.DOCK_WATCH_MINUTES = "0";

const eur = (c?: number | null) => (c === undefined || c === null ? "?" : `${(c / 100).toFixed(2)} €`);

function printFinding(f: Finding) {
  console.log(`   ${f.staged ? "[STAGED] " : ""}${f.product.name} cannot come for ${f.need.date} (${f.need.source}, ${f.need.amount} ${f.need.unit}): ${f.problems.join(", ")}${f.shortfall.backOn ? `, back ${f.shortfall.backOn}` : ""}`);
  console.log(`   candidates: ${f.search.mapCandidates} map, ${f.search.searchCandidates} search (${f.search.path}), ${f.search.priced} priced; usual ${f.usualPerUnitCents} c per ${f.product.unit}`);
  for (const s of f.substitutes) console.log(`     ${s.rank.padEnd(6)} ${s.name}: ${s.why} -> ${s.insidePreferences ? "inside preferences (agent may order alone)" : `needs a person: ${s.outside.join("; ")}`}`);
  if (f.claim) console.log(`   signed availability claim ${f.claim.claimId}${f.claim.simulated ? " (simulated)" : ""}: ${JSON.stringify(f.claim.statement)}`);
}

function printRenewal(r: Renewal) {
  console.log(`   ${r.staged ? "[STAGED] " : ""}${r.family} for ${r.deliveryDate}: ${r.state}. ${r.decision.reason}`);
  if (r.drift.portions) console.log(`     portions: ${r.drift.portions.points.map((p) => p.amount).join(" -> ")} (${r.drift.portions.pct} % since ${r.drift.portions.since})`);
  if (r.drift.cost) console.log(`     cost: ${r.drift.cost.from} -> ${r.drift.cost.to} c per unit (${r.drift.cost.pct} %)`);
  if (r.drift.basket) console.log(`     basket: ${eur(r.drift.basket.usualCents)} -> ${eur(r.drift.basket.nowCents)} (${r.drift.basket.pct} %)`);
  if (r.outcome?.orderId) console.log(`     order ${r.outcome.orderId}: ${r.outcome.status}, ${eur(r.outcome.totalCents)}${r.outcome.approver ? `, signer ${r.outcome.approver}` : ""}`);
  if (r.outcome?.refused) console.log(`     refused (${r.outcome.refused.rule ?? r.outcome.refused.code}): ${r.outcome.refused.message}`);
}

async function main() {
  const rt = await getRuntime();
  console.log(`Catalogue: ${rt.catalogSource.kind}${rt.catalogSource.kind === "valio" ? ` (${rt.catalogSource.products} products)` : ""}\n`);
  const k = (await resolveKitchen("kaari"))!;
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/script", method: "POST" } as never);
  const orgId = k.info.orgId;
  const standing = await standingFor(rt, orgId);
  console.log("0. What the watch learned from Kaari's own orders");
  for (const s of standing) console.log(`   ${s.family}: ${s.product.name}; ${s.slots.map((x) => `${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][x.weekday]} usually ${x.usualAmount} ${s.unit} at ${x.usualPerUnitCents} c per ${s.unit} (${x.orders} orders)`).join("; ")}; ${s.basedOn.orders} orders over ${s.basedOn.weeks.length} weeks (${s.basedOn.from} to ${s.basedOn.to}); next ${s.next?.date}; drifted: ${s.drifted}`);
  const milk = standing.find((s) => s.family === "milk");
  if (!milk) throw new Error("Kaari has no recurring milk order on this catalogue.");

  console.log("\n1. Supplier stock-out (staged): Kaari's usual milk");
  const stage = await stageStockOut(rt, { kitchen: "kaari", productId: milk.product.productId, by: "Operations (script)" });
  const liveBefore = rt.dock.stats().liveCalls;
  const [r1] = await runWatch(rt, { kitchens: ["kaari"], fresh: true, by: "script" });
  console.log(`   watched ${r1.keys.length} key products (${r1.keys.map((x) => `${x.productId} for ${x.date}`).join(", ")}); live calls: ${rt.dock.stats().liveCalls - liveBefore}`);
  const f = r1.findings.find((x) => x.product.productId === milk.product.productId);
  if (f) printFinding(f);
  for (const lang of ["en", "fi", "sv"] as const) {
    const m = await watchMomentForThread(rt, session, lang);
    if (m) console.log(`   [${lang}] ${m.say} ${m.ask ?? ""}`);
  }
  const m1 = await watchMomentForThread(rt, session, "en");
  if (m1?.kind === "stock_out") {
    for (const s of m1.steps) console.log(`        step: ${s}`);
    const words = "Yes, switch it";
    const a = watchAnswerOf(m1, words);
    console.log(`   buyer: "${words}" -> ${a}`);
    const done = await answerWatchMoment(rt, session, m1.id, a!, { by: "Sanna Koskinen (head chef, script)", via: "conversation (script)", lang: "en" });
    console.log(`   agent: ${done.reply}`);
    if (done.order) console.log(`   the gate: ${done.order.status}; ${done.order.decision.reasons.join(" ")}`);
    // Back to a clean week for the next scenario: the switched order is withdrawn while it waits for sign-off.
    if (done.order?.status === "pending_approval") await rt.dock.withdrawOrder(session, done.order.orderId, { reason: "script: next scenario", by: "script" });
  }
  for (const x of r1.findings.filter((y) => y !== f)) printFinding(x);
  await liftStage(rt, stage.stageId, "Operations (script)");

  console.log("\n2. Standing-order drift: creeping portions staged on the milk; auto-renew on for milk and cream");
  await stageDrift(rt, { kitchen: "kaari", family: "milk", by: "Operations (script)" });
  for (const fam of standing.map((s) => s.family)) await setAutoRenew(rt, session, { family: fam, on: true, by: "Sanna Koskinen (head chef, script)", via: "conversation (script)" });
  const [r2] = await runWatch(rt, { kitchens: ["kaari"], fresh: true, renew: "now", by: "script" });
  for (const r of r2.renewals) printRenewal(r);
  for (let i = 0; i < 3; i++) {
    const m = await watchMomentForThread(rt, session, "en");
    if (!m) break;
    const fi = await watchMomentForThread(rt, session, "fi");
    console.log(`   [en] ${m.say} ${m.ask ?? ""}`);
    if (fi) console.log(`   [fi] ${fi.say} ${fi.ask ?? ""}`);
    if (m.kind === "renewal_held") {
      const words = "Go back to the usual";
      const a = watchAnswerOf(m, words)!;
      const done = await answerWatchMoment(rt, session, m.id, a, { by: "Sanna Koskinen (head chef, script)", via: "conversation (script)", lang: "en" });
      console.log(`   buyer: "${words}" -> ${a}; agent: ${done.reply}`);
    } else {
      const { markSaid } = await import("@/server/watch/service");
      await markSaid(rt, m.id);
    }
  }

  const v = await watchView(rt);
  console.log(`\n   operations: ${JSON.stringify(v.stats)}`);
  console.log(`   ledger chain verifies: ${rt.dock.ledger.verify().ok}; watch entries: ${rt.dock.ledger.entries().filter((e) => e.type === "watch").length}; live calls so far: ${rt.dock.stats().liveCalls}`);

  console.log("\n3. An outside buyer's agent over MCP (Kaari's mandate, stock client), on a fresh server state");
  resetRuntime();
  const rt3 = await getRuntime();
  await stageStockOut(rt3, { kitchen: "kaari", productId: milk.product.productId, by: "Operations (script)" });
  const mandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  const client = new Client({ name: "outside-buyer", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", "http://dock.local"), { fetch: async (u: string | URL, i?: RequestInit) => mcpRoute(new Request(u, i)), requestInit: { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId } } }));
  const call = async (name: string, a: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    return { ok: !r.isError, s: r.structuredContent as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const w = await call("watch_orders", { fresh: true });
  const open = (w.s.findings ?? []).filter((x: Finding) => x.state === "open") as Finding[];
  console.log(`   watch_orders: ${open.length} open findings, ${(w.s.standing ?? []).length} recurring orders, ${(w.s.renewals ?? []).length} renewals; nextStep: ${w.s.nextStep}`);
  for (const x of open) printFinding(x);
  if (open[0]) {
    const ans = await call("answer_watch", { findingId: open[0].findingId, choice: "switch", by: "Head chef (outside agent)" });
    console.log(`   answer_watch switch: ${ans.ok ? `${ans.s.state}; order ${ans.s.order?.orderId ?? "-"} ${ans.s.order?.status ?? ""}` : JSON.stringify(ans.s)}; ${ans.s.nextStep ?? ""}`);
  }
  const on = await call("set_auto_renew", { family: "milk", on: true, by: "Head chef (outside agent)" });
  console.log(`   set_auto_renew milk on: ${on.ok ? `recorded (${on.s.autoRenew?.by}, ${on.s.autoRenew?.via})` : JSON.stringify(on.s)}`);
  const w2 = await call("watch_orders", {});
  console.log(`   watch_orders again: milk auto-renew ${(w2.s.standing ?? []).find((x: { family: string }) => x.family === "milk")?.autoRenew?.on}; ${(w2.s.findings ?? []).filter((x: Finding) => x.state === "open").length} open findings`);
  console.log(`   ledger chain verifies: ${rt3.dock.ledger.verify().ok}; live calls: ${rt3.dock.stats().liveCalls}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
