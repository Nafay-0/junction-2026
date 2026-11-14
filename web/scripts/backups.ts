/**
 * A backup "in case this is not delivered", on a public test kitchen and the real catalogue, in process:
 *
 *   1. the kitchen orders a product with a poor delivery record (the gate decides as ever)
 *   2. the agent's one sentence at order time (en, fi, sv), the alternatives behind the list
 *   3. "you choose": the best inside the kitchen's preferences is lined up; nothing is bought
 *   4. the product is staged out of stock; the watch orders the backup by itself and reports it in one sentence
 *   5. the same order as an outside agent sees it over MCP: deliveryRecords on get_order, line_up_backup
 *
 *   pnpm backups [--kitchen kahvila-sointu] [--product 468720] [--packs 4]
 *
 * Live calls: the quote, one for the alternatives' prices, the watch's look and the backup's quote.
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { addDaysIso, localNow } from "@/core/kitchen";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { resolveKitchen } from "@/server/console-kitchens";
import { getRuntime } from "@/server/runtime";
import { backupEvents } from "@/server/reliability/service";
import { answerBackup, backupAnswerOf, backupMomentForThread } from "@/server/reliability/thread";
import { runWatch, stageStockOut } from "@/server/watch/service";
import { watchMomentForThread } from "@/server/watch/thread";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
process.env.DOCK_WATCH_MINUTES = "0";
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const slug = opt("kitchen") ?? "kahvila-sointu";
const productId = opt("product") ?? "468720"; // Juustoportti Halla grilling cheese, lactose-free: 0.767 in the partner's file
const packs = Number(opt("packs") ?? 4);

async function main() {
  const rt = await getRuntime();
  console.log(`Catalogue: ${rt.catalogSource.kind}; kitchen ${slug}\n`);
  const k = (await resolveKitchen(slug))!;
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/script", method: "POST" } as never);
  const [p] = await rt.catalog.searchProducts({ ids: [productId], limit: 1 });
  console.log(`1. ${k.info.name} orders ${packs} × ${p.name} (deliveryReliability ${p.deliveryReliability})`);
  const day = addDaysIso(localNow(new Date()).date, 4);
  const req = await rt.dock.openRequest(session, { text: `${packs} × ${p.name}`, neededBy: day, productIds: [productId] });
  const q = await rt.dock.requestQuote(session, { requestId: req.requestId, lines: [{ productId, quantity: packs }] });
  const o = await rt.dock.placeOrder(session, { requestId: req.requestId, quoteToken: q.quoteToken, lines: q.quote.lines.map(({ productId: id, quantity, unitPriceCents }) => ({ productId: id, quantity, unitPriceCents })) });
  console.log(`   the gate: ${o.status}, ${(o.totalCents / 100).toFixed(2)} €, delivery ${o.lines[0].deliveryDate}`);

  console.log(`\n2. The agent at order time`);
  for (const lang of ["en", "fi", "sv"] as const) {
    const m = await backupMomentForThread(rt, session, { orderId: o.orderId }, lang);
    console.log(`   [${lang}] ${m ? `${m.say} ${m.ask}` : "(nothing: no poor record)"}`);
  }
  const m = await backupMomentForThread(rt, session, { orderId: o.orderId }, "en");
  if (!m) return;
  for (const s of m.steps) console.log(`        step: ${s}`);

  console.log(`\n3. buyer: "you choose"`);
  const a = backupAnswerOf(m, "you choose")!;
  const set = await answerBackup(rt, session, m.id, a, { by: `${k.info.name} (script)`, via: "conversation (script)", lang: "en" });
  console.log(`   agent: ${set.reply}`);
  if (!set.backup?.chosen) {
    const b = backupAnswerOf(m, "that one")!;
    const again = await answerBackup(rt, session, m.id, b, { by: `${k.info.name} (script)`, via: "conversation (script)", lang: "en" });
    console.log(`   buyer: "that one" -> ${b}\n   agent: ${again.reply}`);
  }
  console.log(`   orders now: ${(await rt.dock.listOrders({ orgId: k.info.orgId })).filter((x) => x.status === "committed" || x.status === "pending_approval").length} (nothing extra bought)`);

  console.log(`\n4. ${p.name} is staged out of stock; the watch runs`);
  await stageStockOut(rt, { kitchen: slug, productId, by: "Operations (script)" });
  const [r] = await runWatch(rt, { kitchens: [slug], fresh: true });
  const f = r.findings.find((x) => x.product.productId === productId);
  console.log(`   finding: ${f?.state}, decided via ${f?.decision?.via}: ${f?.decision?.action}, order ${f?.decision?.orderId} ${f?.decision?.status}`);
  const rep = await watchMomentForThread(rt, session, "en", { asked: true });
  console.log(`   agent: ${rep?.say}`);
  console.log(`   event for the emails: ${JSON.stringify((await backupEvents(rt, "1970-01-01"))[0])}`);

  console.log(`\n5. The same order over MCP (the kitchen's mandate)`);
  const client = new Client({ name: "outside-buyer", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", "http://dock.local"), { fetch: async (u: string | URL, i?: RequestInit) => mcpRoute(new Request(u, i)), requestInit: { headers: { authorization: `Bearer ${k.mandateToken}`, "dock-agent-id": k.agentId } } }));
  const got = (await client.callTool({ name: "get_order", arguments: { orderId: o.orderId } })) as CallToolResult;
  console.log(`   get_order deliveryRecords: ${JSON.stringify((got.structuredContent as { order?: { deliveryRecords?: unknown } }).order?.deliveryRecords)}`);
  console.log(`\n   ledger chain verifies: ${rt.dock.ledger.verify().ok}; live calls: ${rt.dock.stats().liveCalls}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
