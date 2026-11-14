/**
 * The partner's two menu scenarios, end to end, in process, on whatever catalogue this checkout runs (the partner's
 * real one with VALIO_API_KEY and its index; the seed otherwise), then the same as an outside MCP agent:
 *
 *   1. seasonal: "a menu around what is in season for 40 on <day>, I have butter": the kitchen's agent says it (en, fi),
 *      what is on hand and why, what is bought; a yes puts it on the sheet; placed through the gate
 *   2. event: "unexpected booking for 40 tomorrow, three courses": what cannot arrive and why, substitutes by recipe
 *      logic; the buyer's answer in words; placed through the gate
 *   3. an outside buyer's agent (a stock MCP client, a menu mandate Kaari signed for it) calls plan_seasonal_menu,
 *      plan_event_menu and order_menu
 *
 *   pnpm scenarios [--day YYYY-MM-DD] [--only seasonal|event|mcp]
 *
 * Model calls: the planner (Opus 5.5, low effort) once per plan, smart search's judge per ingredient. Spend printed.
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { signMandate } from "@/core/mandate";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import { formatEur } from "@/core/util";
import { demoKitchenKeyPair } from "@/server/demo-kitchen";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const only = opt("only");
const nextWeekday = (from: string, wd: number) => {
  for (let i = 1; i <= 7; i++) if (isoWeekday(addDaysIso(from, i)) === wd) return addDaysIso(from, i);
  return addDaysIso(from, 7);
};

async function main() {
  const { getRuntime } = await import("@/server/runtime");
  const { menuScenarios } = await import("@/server/agent/menu/runtime");
  const { resolveMenuKitchen } = await import("@/server/agent/menu/kitchens");
  const th = await import("@/server/agent/menu/thread");
  const rt = await getRuntime();
  const { service, scenarios } = await menuScenarios();
  const kaari = (await resolveMenuKitchen("kaari", rt))!;
  const today = localNow(new Date()).date;
  const day = opt("day") ?? nextWeekday(today, 5);
  console.log(`Catalogue: ${rt.catalogSource.kind}${rt.catalogSource.kind === "valio" ? ` (${rt.catalogSource.products} products)` : ""}; today ${today}\n`);
  const plans: string[] = [];
  const spend = async (k = kaari) => {
    let usd = 0;
    for (const id of plans) usd += (await service.get(k, id).catch(() => undefined))?.record.model.costUsd ?? 0;
    return usd;
  };
  const by = "Sanna Koskinen (head chef, script)";
  const place = async (sheet: Awaited<ReturnType<typeof scenarios.sheetOf>>, planId: string) => {
    const r = await scenarios.order(kaari, planId, sheet).catch((e: Error) => ({ error: e.message }));
    if ("error" in r) return console.log(`   placed: refused: ${r.error}`);
    console.log(`   placed: ${r.order.status}, ${formatEur(r.order.totalCents)}${r.order.approval ? `, waits for ${r.order.approval.approver.name}` : ""}; gate: ${r.order.decision.reasons.join(" ")}`);
  };

  if (!only || only === "seasonal") {
    const words = `Plan a lunch menu around what is in season for 40 covers on ${day}. I have butter.`;
    console.log(`1. Seasonal: "${words}"`);
    const t = await th.seasonalForThread("kaari", words, by, "en");
    plans.push(t.planId);
    console.log(`   [en] ${t.say} ${t.ask}`);
    const fi = await th.inLanguage(t, "fi");
    console.log(`   [fi] ${fi.say} ${fi.ask}`);
    for (const s of t.steps) console.log(`        step: ${s}`);
    const ans = th.scenarioAnswerOf("Yes, put it on the sheet", t.pending)!;
    const done = await th.actOnScenario("kaari", t.pending, ans, { by }, "en");
    console.log(`   buyer: "Yes, put it on the sheet" -> ${ans.kind}; ${done.reply}`);
    if (done.sheet) {
      console.log(`   sheet: ${done.sheet.lines.length} lines for ${done.sheet.deliveryDate}; left off: ${done.sheet.leftOff.map((x) => `${x.name} (${x.why})`).join("; ") || "none"}`);
      await place(done.sheet, t.planId);
    }
    console.log(`   model spend so far: $${(await spend()).toFixed(3)}\n`);
  }

  if (!only || only === "event") {
    const words = "Unexpected booking for 40 tomorrow: a three-course dinner.";
    console.log(`2. Event: "${words}"`);
    let t = await th.eventForThread("kaari", words, by, "en");
    plans.push(t.planId);
    console.log(`   [en] ${t.say} ${t.ask}`);
    if (t.pending.earliest) {
      const ans = th.scenarioAnswerOf("Yes", t.pending)!;
      const moved = await th.actOnScenario("kaari", t.pending, ans, { by }, "en");
      console.log(`   buyer: "Yes" -> ${ans.kind} ${"date" in ans ? ans.date : ""}`);
      t = moved.next!;
      plans.push(t.planId);
      console.log(`   [en] ${t.say} ${t.ask}`);
    }
    const fi = await th.inLanguage(t, "fi");
    console.log(`   [fi] ${fi.say} ${fi.ask}`);
    for (const s of t.steps) console.log(`        step: ${s}`);
    const words2 = t.pending.options.length > 1 ? "the second one" : "yes";
    const ans = th.scenarioAnswerOf(words2, t.pending) ?? { kind: "yes" as const };
    const done = await th.actOnScenario("kaari", t.pending, ans, { by }, "en");
    console.log(`   buyer: "${words2}" -> ${JSON.stringify(ans)}; ${done.reply}`);
    if (done.sheet) {
      console.log(`   sheet: ${done.sheet.lines.map((l) => `${l.packs} × ${l.productId}${l.substituteFor ? ` (substitute for ${l.substituteFor})` : ""}`).join(", ")}; decisions: ${done.sheet.decisions.map((d) => `${d.ingredient}: ${d.title} by ${d.by}`).join("; ") || "none"}`);
      await place(done.sheet, t.planId);
    }
    console.log(`   model spend so far: $${(await spend()).toFixed(3)}\n`);
  }

  if (!only || only === "mcp") {
    console.log("3. An outside buyer's agent over MCP (a menu mandate Kaari signed for it, stock client)");
    const { POST: mcpRoute } = await import("@/app/api/mcp/route");
    const agentId = "agent_kaari_outside_01";
    const token = await signMandate({ ...kaari.mandate, mandateId: `${kaari.mandate.mandateId}_outside`, agentId }, await demoKitchenKeyPair());
    const client = new Client({ name: "outside-menu-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", "http://dock.local"), { fetch: async (u: string | URL, i?: RequestInit) => mcpRoute(new Request(u, i)), requestInit: { headers: { authorization: `Bearer ${token}`, "dock-agent-id": agentId } } }));
    const call = async (name: string, a: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
      return { ok: !r.isError, s: r.structuredContent as Record<string, unknown> & { result?: Record<string, unknown>; error?: { message: string } } };
    };
    const s1 = await call("plan_seasonal_menu", { text: `Something with root vegetables for Friday ${day}, 40 covers`, have: ["butter", "wheat flour"], by: "Outside agent (script)" });
    const r1 = s1.s.result as unknown as import("@/server/agent/menu/scenarios").SeasonalResult;
    if (!s1.ok) console.log(`   plan_seasonal_menu refused: ${s1.s.error?.message}`);
    else {
      console.log(`   plan_seasonal_menu: anchor ${r1.anchor?.label.en ?? "none"}; dishes ${r1.dishes.map((d) => d.name).join(", ")}; ${r1.lines.filter((l) => l.product).length} lines to buy, ${formatEur(r1.totalCents)}`);
      for (const l of r1.lines) console.log(`     ${l.ingredient}: need ${l.need}; on hand ${l.onHand ? `${l.onHand.amount ?? "enough"} (${l.onHand.source}${l.onHand.estimate ? ", estimate" : ""})` : "none known"}; buy ${l.toBuy ?? "nothing"}${l.product ? ` -> ${l.product.packText} ${l.product.name}` : ""}${l.leftover ? ` [${l.leftover}]` : ""}`);
      const o1 = await call("order_menu", { planId: r1.planId, by: "Outside agent (script)" });
      console.log(`   order_menu: ${o1.ok ? (o1.s.order as { status: string }).status : `refused: ${o1.s.error?.message}`}; ${o1.s.nextStep ?? ""}`);
    }
    const s2 = await call("plan_event_menu", { text: "Unexpected booking for 40: three-course dinner", deliverBy: opt("event-day") ?? nextWeekday(today, 1), by: "Outside agent (script)" });
    const r2 = s2.s.result as unknown as import("@/server/agent/menu/scenarios").EventResult;
    if (!s2.ok) console.log(`   plan_event_menu refused: ${s2.s.error?.message}`);
    else {
      console.log(`   plan_event_menu for ${r2.deliverBy}: ${r2.cannotArrive.length} cannot arrive${r2.allLate ? " (nothing can)" : ""}`);
      for (const x of r2.cannotArrive) {
        console.log(`     ${x.ingredient} (${x.role}, ${x.dish}): ${x.arrival.why}`);
        for (const o of r2.options[x.lineId] ?? []) console.log(`       ${o.rank}: ${o.title}${o.signOff.needed ? " [sign-off]" : ""}`);
      }
      const choices = r2.cannotArrive.flatMap((x) => (r2.options[x.lineId]?.[0] ? [{ lineId: x.lineId, optionId: r2.options[x.lineId][0].optionId }] : []));
      const o2 = await call("order_menu", { planId: r2.planId, choices, by: "Outside agent (script)" });
      console.log(`   order_menu: ${o2.ok ? (o2.s.order as { status: string }).status : `refused: ${o2.s.error?.message}`}`);
    }
  }
  console.log(`\nLedger chain verifies: ${rt.dock.ledger.verify().ok}; scenario entries: ${rt.dock.ledger.entries().filter((e) => ["seasonal_anchor", "on_hand", "cannot_arrive", "substitution_options", "substitution_chosen"].includes(String((e.data as { step?: string }).step))).length}`);
  const { dailyUsage } = await import("@/server/limits");
  console.log(`Model spend: in-process plans $${(await spend()).toFixed(3)}; every metered model call this run (planner, name checks, fixes, search judge): ${JSON.stringify(dailyUsage())}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
