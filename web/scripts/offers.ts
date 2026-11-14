/**
 * The proactive selling agent, end to end, in process, on whatever catalogue this checkout runs (the partner's real
 * one with VALIO_API_KEY and its index; the seed otherwise):
 *
 *   1. the wholesaler's selling agent runs over the demo kitchens, then a campaign for one product
 *   2. the kitchen's own agent says the offer it would show in the conversation (offerForThread)
 *   3. an outside buyer's agent, a stock MCP client with Kaari's mandate, lists the offers, saves the signed token and
 *      the published JWK Set (for `pnpm verify:offer`, a script that imports no AimoPilot code), accepts one, and the
 *      ordinary order it starts goes through the intake, the quote and the gate
 *
 *   pnpm offers [--campaign <productId>] [--out <dir>]
 *
 * A few live price calls per kitchen (at most six products each). No model call unless DOCK_OFFER_LLM is on and a
 * key is set (then one short line per offer).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { GET as jwksRoute } from "@/app/.well-known/jwks.json/route";
import { getRuntime } from "@/server/runtime";
import { resolveKitchen } from "@/server/console-kitchens";
import { runSellingAgent, startCampaign } from "@/server/offers/service";
import { offerForThread } from "@/server/offers/thread";
import { loadLocalEnv } from "./lib/env";

loadLocalEnv();
process.env.DOCK_OFFER_LLM ??= "off";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = opt("out") ?? path.join("offers-out");

async function main() {
  const rt = await getRuntime();
  console.log(`Catalogue: ${rt.catalogSource.kind}${rt.catalogSource.kind === "valio" ? ` (${rt.catalogSource.products} products)` : ""}\n`);

  console.log("1. The selling agent runs over every kitchen");
  for (const r of await runSellingAgent(rt)) {
    console.log(`   ${r.name}: ${r.offered.length} offered, ${r.withheld.length} held back${r.notRelevant ? `; ${r.notRelevant}` : ""}`);
    for (const o of r.offered) console.log(`     + ${o.productName}: ${o.line}`);
    for (const w of r.withheld) console.log(`     - ${w.productName}: ${w.rule} (${w.reason})`);
  }

  const campaignId = opt("campaign") ?? (rt.catalogSource.kind === "seed" ? "VA-1201" : undefined);
  if (campaignId) {
    console.log(`\n   A campaign for ${campaignId}, listed as new:`);
    const c = await startCampaign(rt, { productId: campaignId, by: "Operations (script)", listAsNew: true });
    for (const r of c.results) console.log(`     ${r.outcome.padEnd(12)} ${r.name}: ${r.reason}`);
  }

  console.log("\n2. Kaari's own agent, in the conversation");
  const k = (await resolveKitchen("kaari"))!;
  const session = await rt.dock.authenticate(k.mandateToken, k.agentId, { via: "onsite", path: "/script", method: "POST" } as never);
  for (const lang of ["en", "fi", "sv"] as const) {
    const t = await offerForThread(rt, session, k.info.name, lang);
    if (!t) {
      console.log("   (no offer for Kaari now)");
      break;
    }
    console.log(`   [${lang}] ${t.say} ${t.ask}`);
    if (lang === "en") for (const s of t.steps) console.log(`        step: ${s}`);
  }

  console.log("\n3. An outside buyer's agent over MCP (Kaari's mandate, stock client)");
  const mandate = await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair());
  const client = new Client({ name: "outside-buyer", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", "http://dock.local"), { fetch: async (u: string | URL, i?: RequestInit) => mcpRoute(new Request(u, i)), requestInit: { headers: { authorization: `Bearer ${mandate}`, "dock-agent-id": KITCHEN_ORG.agentId } } }));
  const call = async (name: string, a: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    return { ok: !r.isError, s: r.structuredContent as Record<string, any> };
  };
  const listed = await call("list_offers");
  const offers = (listed.s.offers ?? []) as { offerId: string; token: string; verified: boolean; offer: { product: { name: string }; line: string } }[];
  console.log(`   list_offers: ${offers.length} open, ${offers.filter((o) => o.verified).length} verified`);
  if (!offers.length) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "offer.json"), JSON.stringify(offers[0], null, 2));
  writeFileSync(path.join(out, "jwks.json"), JSON.stringify(await (await jwksRoute(new Request("http://dock.local/.well-known/jwks.json"))).json(), null, 2));
  console.log(`   saved ${path.join(out, "offer.json")} and the published keys ${path.join(out, "jwks.json")}: pnpm verify:offer ${path.join(out, "offer.json")} --jwks ${path.join(out, "jwks.json")} --org ${KITCHEN_ORG.orgId}`);

  const accepted = await call("accept_offer", { offerId: offers[0].offerId, by: "Head chef (script)" });
  let step = accepted.s.step;
  console.log(`   accept_offer ${offers[0].offer.product.name}: an ordinary order, step ${step?.state}`);
  for (let i = 0; i < 4 && step && step.state !== "options_ready" && step.state !== "quoted"; i++) {
    if (step.state === "needs_confirmation") step = (await call("respond_to_concerns", { requestId: step.requestId, by: "Head chef (script)", responses: step.concerns.map((c: { key: string }) => ({ key: c.key, choice: "confirm" })) })).s.step;
    else if (step.state === "needs_input") step = (await call("answer_questions", { requestId: step.requestId, by: "Head chef (script)", answers: step.questions.map((q: { questionId: string; options: { optionId: string }[] }) => ({ questionId: q.questionId, optionId: q.options[0].optionId })) })).s.step;
    else break;
    console.log(`     -> ${step?.state}`);
  }
  if (step?.state !== "options_ready") return console.log(`   stopped at ${step?.state}: ${accepted.s.nextStep ?? ""}`);
  const optionId = step.preselected?.optionId ?? step.options[0].optionId;
  await call("choose_option", { requestId: step.requestId, optionId, by: "Head chef (script)" });
  const placed = await call("place_order", { requestId: step.requestId });
  console.log(`   place_order: ${placed.ok ? placed.s.order.status : `refused, ${placed.s.error?.rule}: ${placed.s.error?.message}`}`);
  console.log(`   the gate's reasons: ${(placed.s.order?.decision?.reasons ?? []).join(" ")}`);
  console.log(`   ledger chain verifies: ${rt.dock.ledger.verify().ok}; offer entries: ${rt.dock.ledger.entries().filter((e) => e.type === "offer").length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
