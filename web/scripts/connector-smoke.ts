/**
 * A stock MCP client given nothing but a kitchen's connector address: no headers, no mandate, no elicitation
 * (like a consumer chat assistant). It runs the milk order up to the sign-off step and stops there, as an
 * assistant should. Read-only apart from the one order it places.
 *
 *   pnpm tsx scripts/connector-smoke.ts <connector address>
 *   pnpm tsx scripts/connector-smoke.ts --kitchen kaari --url http://localhost:3141   (asks /ui-api/connect for it)
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { localNow, nextDeliveryDay } from "@/core/kitchen";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const say = (s: string) => console.log(s);

async function address(): Promise<string> {
  const direct = args.find((a) => /\/api\/mcp\/c\//.test(a));
  if (direct) return direct;
  const base = opt("--url") ?? "http://localhost:3000";
  const res = await fetch(new URL(`/ui-api/connect/${opt("--kitchen") ?? "kaari"}`, base));
  const body = (await res.json()) as { connector?: { url: string } };
  if (!body.connector) throw new Error(`No connector address: HTTP ${res.status}`);
  return body.connector.url;
}

type R = { ok: boolean; nextStep: string; waitingFor?: string; error?: { code: string; rule?: string; message: string } } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  const url = await address();
  say(`connector address: ${url.replace(/(dk_.{6}).*/, "$1…")}`);
  const client = new Client({ name: "connector-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  say(`connected: ${client.getServerVersion()?.title}, protocol ${client.getNegotiatedProtocolVersion()}`);
  const { tools } = await client.listTools();
  say(`${tools.length} tools; any approval tool: ${tools.some((t) => /approv|sign.?off/i.test(t.name))}`);
  const call = async (name: string, a: Record<string, unknown> = {}): Promise<R> => {
    const r = (await client.callTool({ name, arguments: a })) as CallToolResult;
    const s = r.structuredContent as R;
    say(`  ${name}: ${s.ok ? "ok" : `refused (${s.error?.code}/${s.error?.rule})`}${s.step ? `, step ${s.step.state}` : ""}${s.order ? `, order ${s.order.status}` : ""}`);
    return s;
  };

  const m = await call("read_mandate");
  say(`  buying for ${m.mandate.issuer.name} as ${m.mandate.agentId}`);
  const deliverBy = nextDeliveryDay(nextDeliveryDay(localNow(new Date()).date, [1, 2, 3, 4, 5])!, [1, 2, 3, 4, 5])!;
  let r = await call("submit_need", { need: { text: "1,000 litres of lactose-free milk by Monday", item: { text: "lactose-free milk", category: "milk" }, quantity: { amount: 1000, unit: "L" }, deliverBy } });
  const requestId = r.step.requestId;
  if (r.step.state === "needs_confirmation") {
    say(`  Dock asks the buyer: ${r.step.concerns.map((c: { message: string }) => c.message).join(" / ")}`);
    say("  (the buyer answers: yes, 1,000 L is right)");
    r = await call("respond_to_concerns", { requestId, responses: r.step.concerns.map((c: { key: string; confirmable: boolean; corrections: { id: string }[] }) => ({ key: c.key, choice: c.confirmable ? "confirm" : c.corrections[0].id })) });
  }
  if (r.step.state === "needs_input") {
    say(`  Dock asks the buyer: ${r.step.questions.map((q: { text: string }) => q.text).join(" / ")}`);
    r = await call("answer_questions", { requestId, answers: r.step.questions.map((q: { id: string; options: { id: string }[] }) => ({ questionId: q.id, optionId: q.options[0].id })) });
  }
  if (r.step.state !== "options_ready") throw new Error(`expected options, got ${r.step.state}: ${r.nextStep}`);
  const optionId = r.step.preselected?.optionId ?? r.step.options[0].optionId;
  r = await call("choose_option", { requestId, optionId });
  const placed = await call("place_order", r.step.next.example);
  say(`  nextStep: ${placed.nextStep}`);
  await client.close();
  if (placed.order?.status !== "pending_approval" && placed.order?.status !== "committed") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
