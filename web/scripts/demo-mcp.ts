/**
 * Any MCP client can buy through Dock. This script is a scripted purchasing agent (no LLM) that uses the stock
 * MCP TypeScript client, `@modelcontextprotocol/client`, and nothing Dock-specific except the mandate it
 * carries. It discovers the endpoint, lists the tools, and completes Valio Aimo's example order end to end.
 *
 *   pnpm dev --port 3100                         in one terminal
 *   pnpm demo:mcp --url http://localhost:3100    in another (default http://localhost:3000, or DOCK_URL)
 *
 * The approver's sign-off is played over plain HTTP with the dev outbox, standing in for the person's phone.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { verifySigned } from "./lib/verify-receipt";

const args = process.argv.slice(2);
const base = (args.includes("--url") ? args[args.indexOf("--url") + 1] : process.env.DOCK_URL) ?? "http://localhost:3000";

const say = (s = "") => console.log(s);
const step = (tag: string, s: string) => say(`\n[${tag}] ${s}`);
const indent = (lines: string[]) => lines.forEach((l) => say("      " + l));
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- the only Dock-specific part: the mandate this agent's organisation signed for it ----
async function mandate(): Promise<{ token: string; agentId: string }> {
  return { token: await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), agentId: DEMO_ORG.agentId };
}

// ---- everything below is generic MCP ----
type Result = { ok: boolean; nextStep: string; error?: { code: string; rule?: string; message: string; details?: Record<string, unknown> } } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  say(`Generic MCP agent against ${base}`);

  const catalog = await fetch(new URL("/.well-known/api-catalog", base));
  const { linkset } = (await catalog.json()) as { linkset: { anchor: string; "service-desc"?: { href: string }[] }[] };
  step("discover", `GET /.well-known/api-catalog (RFC 9727, ${catalog.headers.get("content-type")?.split(";")[0]}):`);
  indent(linkset.map((l) => `${l.anchor}${l["service-desc"] ? `  described by ${l["service-desc"][0].href}` : ""}`));
  const mcpUrl = linkset.map((l) => l.anchor).find((a) => a.endsWith("/mcp")) ?? new URL("/api/mcp", base).href;

  const { token, agentId } = await mandate();
  const client = new Client({ name: "generic-purchasing-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}`, "Dock-Agent-Id": agentId } } }),
  );
  const server = client.getServerVersion();
  step("connect", `${mcpUrl}: ${server?.title ?? server?.name} ${server?.version}, MCP protocol ${client.getNegotiatedProtocolVersion()}.`);

  const { tools } = await client.listTools();
  step("tools", `${tools.length} tools:`);
  indent(tools.map((t) => `${t.name.padEnd(19)} ${t.title ?? ""}`));

  const call = async (name: string, a: Record<string, unknown> = {}): Promise<Result> => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    if (r.structuredContent) return r.structuredContent as Result;
    // No structured result: the client library or server refused the arguments before the tool ran.
    return { ok: false, nextStep: "", error: { code: "invalid_arguments", message: (r.content[0] as { text: string }).text } };
  };

  const { mandate: m } = await call("read_mandate");
  step("mandate", `Buying for ${m.issuer.name}: alone up to ${eur(m.perOrderLimitCents)} per order, weekly budget ${eur(m.weeklyBudgetCents)}, must be ${m.requiredAttributes.join(", ")}.`);

  const neededBy = nextMonday(new Date());
  const { request } = await call("open_request", { text: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.", neededBy });
  const requestId: string = request.requestId;
  step("request", `${requestId}, need by ${neededBy}.`);

  const { products } = await call("search_products", { requestId, text: "milk", category: "milk", attributes: [...m.requiredAttributes, "fat_1_5"] });
  step("search", `${products.length} matching products in master data (no live call).`);

  type P = { id: string; packSize: number; deliveryReliability: number; carbonKgPerUnit: number };
  const shortlist = (products as P[])
    .filter((p) => p.deliveryReliability >= 0.95)
    .sort((a, b) => b.packSize - a.packSize || a.carbonKgPerUnit - b.carbonKgPerUnit)
    .slice(0, 3);
  const live = await call("check_availability", { requestId, productIds: shortlist.map((p) => p.id) });
  step("live", `Prices and stock for the shortlist only (${shortlist.length} of ${products.length}); allowance left: ${live.liveLookupBudget.newProductsLeft} products this hour.`);
  type O = { productId: string; unitPriceCents: number; availablePacks: number; deliveryDate: string };
  indent((live.offers as O[]).map((o) => `${o.productId.padEnd(8)} ${String(o.availablePacks).padStart(5)} packs  ${eur(o.unitPriceCents)}/pack  delivery ${o.deliveryDate}`));

  const pack = new Map(shortlist.map((p) => [p.id, p.packSize]));
  const perLitre = (o: O) => o.unitPriceCents / pack.get(o.productId)!;
  const usable = (live.offers as O[]).filter((o) => o.deliveryDate <= neededBy).sort((a, b) => perLitre(a) - perLitre(b));
  const first = usable[0].productId;
  let left = 1000;
  const lines: { productId: string; quantity: number; substituteFor?: string }[] = [];
  for (const o of usable) {
    if (left <= 0) break;
    const packs = Math.min(o.availablePacks, Math.ceil(left / pack.get(o.productId)!));
    lines.push({ productId: o.productId, quantity: packs, ...(o.productId === first ? {} : { substituteFor: first }) });
    left -= packs * pack.get(o.productId)!;
  }
  step("plan", `First choice ${first} is short; proposing ${lines.map((l) => `${l.quantity} x ${l.productId}${l.substituteFor ? " (substitute)" : ""}`).join(" + ")}.`);

  const q = await call("request_quote", { requestId, lines });
  if (!q.ok) throw new Error(`quote refused: ${q.error?.message}`);
  step("quote", `Signed quote ${q.quote.quoteId}: ${eur(q.quote.totalCents)}. Gate preview: ${q.policyPreview.outcome}.`);
  if (q.policyPreview.outcome === "reject") {
    const failed = q.policyPreview.rules.find((r: { outcome: string }) => r.outcome === "fail");
    step("stop", `The gate would refuse this quote (${failed?.rule}): ${failed?.reason}`);
    if (failed?.rule === "weekly_budget") say("      This server already spent the demo organisation's weekly budget (an earlier run). Restart `pnpm dev` for a fresh run.");
    process.exit(1);
  }
  const orderLines = q.quote.lines.map(({ productId, quantity, unitPriceCents }: O & { quantity: number }) => ({ productId, quantity, unitPriceCents }));

  const placed = await call("place_order", { requestId, quoteToken: q.quoteToken, lines: orderLines });
  const orderId: string = placed.order.orderId;
  step("order", `${orderId}: ${placed.order.status}.`);
  indent(placed.order.decision.reasons.map((r: string) => `- ${r}`));
  indent([`nextStep: ${placed.nextStep}`]);

  const retry = await call("place_order", { requestId, quoteToken: q.quoteToken, lines: orderLines });
  step("misbehave", `Places the same order again anyway: refused by rule "${retry.error?.rule}". nextStep: ${retry.nextStep}`);
  const eleven = Array.from({ length: 11 }, (_, i) => (products as P[])[i]?.id ?? `X-${i}`);
  const scan = await call("check_availability", { requestId, productIds: eleven });
  step("misbehave", `Asks live prices for 11 products at once: refused before reaching the live service (${scan.error?.message.split(":").slice(0, 2).join(":")}).`);

  if (placed.order.status === "pending_approval") {
    // The human side, not the agent: the approver opens the link sent to their phone and approves.
    const { messages } = await (await fetch(new URL("/api/v1/dev/outbox", base))).json();
    const msg = messages.find((x: { orderId: string }) => x.orderId === orderId);
    const res = await fetch(new URL(`/api/v1/approvals/${msg.approvalId}`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", token: new URL(msg.link, base).searchParams.get("token"), note: "Fine, Arla this week." }),
    });
    step("approver", `${msg.approver.name} (${msg.approver.role}) approves on their phone: HTTP ${res.status}.`);
  }

  const final = await call("get_order", { orderId });
  if (final.order.status !== "committed") throw new Error(`order ended ${final.order.status}`);
  const jwks = await (await fetch(new URL("/.well-known/jwks.json", base))).json();
  const receipt = await verifySigned(final.order.confirmation, jwks);
  const file = join(tmpdir(), `dock-receipt-${orderId}.json`);
  writeFileSync(file, JSON.stringify({ order: final.order }, null, 2));
  step("receipt", `Committed ${eur(final.order.totalCents)}. Receipt (${receipt.typ}) verified with /.well-known/jwks.json, key "${receipt.kid}".`);
  indent([`authorised by ${receipt.payload.authorisedBy && JSON.stringify(receipt.payload.authorisedBy)}`, `saved to ${file}`, `check it yourself: pnpm verify:receipt ${file} --url ${base}`]);

  const ex = await call("explain", { requestId });
  step("explain", `Audit trail (chain verified: ${ex.verification.ok}):`);
  indent(ex.explanation);
  await client.close();
}

function nextMonday(from: Date): string {
  const add = (8 - from.getUTCDay()) % 7 || 7;
  return new Date(from.getTime() + add * 86_400_000).toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof TypeError && /fetch failed/.test(err.message)) console.error(`Is the dev server running? Start it with: pnpm dev --port ${new URL(base).port || 3000}`);
  process.exit(1);
});
