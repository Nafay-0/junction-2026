/**
 * Any MCP client can buy through Dock. This script is a scripted purchasing agent (no LLM) that uses the stock
 * MCP TypeScript client, `@modelcontextprotocol/client`, and nothing Dock-specific except the mandate it
 * carries. It discovers the endpoint, lists the tools, and orders Valio Aimo's example through the intake:
 * a mistake check the buyer confirms, one question, option cards, a choice, a fixed-price quote, the order,
 * and the head chef's sign-off.
 *
 *   pnpm dev --port 3100                         in one terminal
 *   pnpm demo:mcp --url http://localhost:3100    in another (default http://localhost:3000, or DOCK_URL)
 *
 * The buyer is played by the client's elicitation handler (MCP 2026-07-28: Dock asks the person through the
 * client, not the agent). The approver's sign-off is played over plain HTTP with the dev outbox, standing in
 * for the head chef's phone.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { localNow, nextDeliveryDay } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { loadLocalEnv } from "./lib/env";
import { verifySigned } from "./lib/verify-receipt";

// The server reads .env.local; so must this script, or it signs with the public dev key the server no longer trusts.
loadLocalEnv();

const args = process.argv.slice(2);
const base = (args.includes("--url") ? args[args.indexOf("--url") + 1] : process.env.DOCK_URL) ?? "http://localhost:3000";

const say = (s = "") => console.log(s);
const step = (tag: string, s: string) => say(`\n[${tag}] ${s}`);
const indent = (lines: string[]) => lines.forEach((l) => say("      " + l));
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- the only Dock-specific part: the mandate this agent's organisation (a returning restaurant kitchen) signed for it ----
async function mandate(): Promise<{ token: string; agentId: string }> {
  return { token: await signMandate(demoKitchenMandate(new Date()), await demoKitchenKeyPair()), agentId: KITCHEN_ORG.agentId };
}

// ---- the human buyer, Sanna, the head chef. In a real client this is a form on her screen. ----
const BUYER = "Sanna Koskinen";
type Field = { title?: string; oneOf?: { const: string; title: string }[]; default?: unknown };
type Form = { message: string; requestedSchema: { properties: Record<string, Field> } };
type Content = Record<string, string | boolean>;

/** What Sanna answers: yes, 1,000 L is right this week (a wedding); and cheapest is what matters. */
function sanna(fields: Record<string, Field>): Content {
  const content: Content = { by: BUYER };
  for (const [key, f] of Object.entries(fields)) {
    if (!f.oneOf) continue;
    const pick = f.oneOf.find((o) => o.const === "confirm") ?? f.oneOf.find((o) => o.const === "price") ?? f.oneOf[0];
    content[key] = pick.const;
  }
  return content;
}

function showForm(form: Form, content: Content) {
  step("buyer", `${BUYER}'s screen (asked by Dock through the MCP client, not by the agent): ${form.message}`);
  for (const [key, f] of Object.entries(form.requestedSchema.properties)) {
    if (!f.oneOf) continue;
    indent([`${f.title}`, ...f.oneOf.map((o) => `  ${o.const === content[key] ? "(x)" : "( )"} ${o.title}${o.const === f.default ? "   <- the agent's suggestion" : ""}`)]);
  }
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
  // Declaring elicitation lets the server ask the human directly; the handler below is that human's screen.
  const client = new Client({ name: "generic-purchasing-agent", version: "1.0.0" }, { versionNegotiation: { mode: "auto" }, capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler("elicitation/create", async (req) => {
    const form = req.params as unknown as Form;
    const content = sanna(form.requestedSchema.properties);
    showForm(form, content);
    return { action: "accept", content };
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}`, "Dock-Agent-Id": agentId } } }),
  );
  const server = client.getServerVersion();
  step("connect", `${mcpUrl}: ${server?.title ?? server?.name} ${server?.version}, MCP protocol ${client.getNegotiatedProtocolVersion()}.`);

  const { tools } = await client.listTools();
  step("tools", `${tools.length} tools (* = needs the human buyer's own answer):`);
  indent(tools.map((t) => `${t._meta?.["dock/humanInput"] ? "*" : " "} ${t.name.padEnd(20)} ${t.title ?? ""}`));

  const call = async (name: string, a: Record<string, unknown> = {}): Promise<Result> => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    if (r.structuredContent) return r.structuredContent as Result;
    // No structured result: the client library or server refused the arguments before the tool ran.
    return { ok: false, nextStep: "", error: { code: "invalid_arguments", message: (r.content[0] as { text: string }).text } };
  };
  /** A human-input tool: Dock asks the buyer through the client. On a client without elicitation, the agent relays. */
  const fromBuyer = async (name: string, a: Record<string, unknown>, relay: () => Record<string, unknown>): Promise<Result> => {
    const r = await call(name, a);
    if (r.error?.code !== "human_answer_required") return r;
    step("relay", "This client cannot show Dock's form, so the agent asks the buyer and passes on her answer.");
    return call(name, { ...a, ...relay() });
  };

  const { mandate: m } = await call("read_mandate");
  step("mandate", `Buying for ${m.issuer.name}: alone up to ${eur(m.perOrderLimitCents)} per order, weekly budget ${eur(m.weeklyBudgetCents)}; above that ${m.approvers.map((a: { name: string; role: string }) => `${a.name} (${a.role})`).join(" or ")} signs off.`);

  const memory = await call("read_kitchen_memory");
  const milkMemory = memory.kitchen.families.find((f: { family: string }) => f.family === "milk");
  step("memory", `${memory.kitchen.name}: milk ${milkMemory ? `${milkMemory.usual.text} over ${milkMemory.orders} orders` : "never ordered"}; rules: ${memory.kitchen.stated.map((r: { text: string; statedBy: string }) => `"${r.text}" (${r.statedBy})`).join(", ") || "none"}.`);

  const deliverBy = nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
  const text = "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";
  let r = await call("submit_need", { need: { text, item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy }, by: BUYER });
  if (!r.ok) throw new Error(`submit_need refused: ${r.error?.message}`);
  const requestId: string = r.step.requestId;
  step("need", `submit_need: 1,000 L of milk by ${deliverBy}. ${requestId} is ${r.step.state}; waiting for: ${r.waitingFor}.`);

  if (r.step.state === "needs_confirmation") {
    indent(r.step.concerns.map((c: { message: string }) => `concern: ${c.message}`));
    const around = await call("request_quote", { requestId, lines: [{ productId: "VA-1010", quantity: 100 }] });
    step("misbehave", `The agent tries to quote around the check: refused by rule "${around.error?.rule}". nextStep: ${around.nextStep}`);
    const proposal = r.step.concerns.map((c: { key: string; corrections: { id: string }[] }) => ({ key: c.key, choice: c.corrections[0]?.id ?? "confirm" }));
    r = await fromBuyer("respond_to_concerns", { requestId, by: "the agent", responses: proposal }, () => ({ by: BUYER, responses: r.step.concerns.map((c: { key: string; confirmable: boolean; corrections: { id: string }[] }) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) }));
    if (!r.ok) throw new Error(`respond_to_concerns refused: ${r.error?.message}`);
    step("confirmed", `${r.step.acknowledgements.map((a: { by: string; action: string; code: string }) => `${a.by} ${a.action} ${a.code}`).join("; ")}. Now ${r.step.state}.`);
  }

  if (r.step.state === "needs_input") {
    indent(r.step.questions.map((q: { text: string }) => `question: ${q.text}`));
    indent(r.step.rules.filter((x: { source: string }) => x.source === "stated").map((x: { text: string }) => `from memory: ${x.text}`));
    r = await fromBuyer("answer_questions", { requestId }, () => ({ by: BUYER, answers: r.step.questions.map((q: { id: string; options: { id: string }[] }) => ({ questionId: q.id, optionId: q.options.find((o) => o.id === "price")?.id ?? q.options[0].id })) }));
    if (!r.ok) throw new Error(`answer_questions refused: ${r.error?.message}`);
  }

  if (r.step.state !== "options_ready") throw new Error(`expected options, got ${r.step.state}: ${r.nextStep}`);
  type Card = { optionId: string; title: string; labels: string[]; totalCents: number; deliveryDate: string; pros: string[]; cons: string[]; signOff: string[] };
  step("options", `${r.step.options.length} options (Dock checked live prices for a short list only):`);
  for (const o of r.step.options as Card[]) {
    indent([`${o.optionId}  [${o.labels.join(", ")}] ${o.title}: ${eur(o.totalCents)}, delivery ${o.deliveryDate}`]);
    indent([...o.pros.map((p) => `  + ${p}`), ...o.cons.map((c) => `  - ${c}`), ...o.signOff.map((x) => `  ! ${x}`)]);
  }
  const optionId: string = r.step.preselected?.optionId ?? r.step.options[0].optionId;
  if (r.step.preselected) indent([`pre-selected: ${optionId} (${r.step.preselected.reason})`]);

  r = await call("choose_option", { requestId, optionId, by: BUYER });
  if (!r.ok) throw new Error(`choose_option refused: ${r.error?.message}`);
  const q = r.step.quote;
  step("quote", `Signed quote ${q.quote.quoteId}: ${eur(q.quote.totalCents)}, price fixed until ${q.quote.expiresAt.slice(11, 16)} UTC. Gate preview: ${q.policyPreview.outcome}.`);
  if (q.policyPreview.outcome === "reject") {
    const failed = q.policyPreview.rules.find((x: { outcome: string }) => x.outcome === "fail");
    step("stop", `The gate would refuse this quote (${failed?.rule}): ${failed?.reason}`);
    if (failed?.rule === "weekly_budget") say("      This server already spent the kitchen's weekly budget (an earlier run). Restart `pnpm dev` for a fresh run.");
    process.exit(1);
  }
  const orderArgs = r.step.next.example;

  const placed = await call("place_order", orderArgs);
  if (!placed.ok) throw new Error(`place_order refused: ${placed.error?.message}`);
  const orderId: string = placed.order.orderId;
  step("order", `${orderId}: ${placed.order.status}.`);
  indent(placed.order.decision.reasons.map((x: string) => `- ${x}`));
  indent([`nextStep: ${placed.nextStep}`]);

  const retry = await call("place_order", orderArgs);
  step("misbehave", `Places the same order again anyway: refused by rule "${retry.error?.rule}". nextStep: ${retry.nextStep}`);
  const eleven = Array.from({ length: 11 }, (_, i) => `X-${i}`);
  const scan = await call("check_availability", { requestId, productIds: eleven });
  step("misbehave", `Asks live prices for 11 products at once: refused before reaching the live service (${scan.error?.message.split(":").slice(0, 2).join(":")}).`);

  if (placed.order.status === "pending_approval") {
    // The human side, not the agent: the approver opens the link sent to their phone and approves.
    const { messages } = await (await fetch(new URL("/api/v1/dev/outbox", base))).json();
    const msg = messages.find((x: { orderId: string }) => x.orderId === orderId);
    const res = await fetch(new URL(`/api/v1/approvals/${msg.approvalId}`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", token: new URL(msg.link, base).searchParams.get("token"), note: "Yes, for the wedding on Saturday." }),
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof TypeError && /fetch failed/.test(err.message)) console.error(`Is the dev server running? Start it with: pnpm dev --port ${new URL(base).port || 3000}`);
  process.exit(1);
});
