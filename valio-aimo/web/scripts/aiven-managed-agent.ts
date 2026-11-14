/**
 * An outside buyer on Aiven: an Aiven Managed Agent connected to Dock's MCP endpoint with a demo mandate.
 *
 *   pnpm aiven:agent                        create (or reuse) the integration and the agent, send the milk request once
 *   pnpm aiven:agent --message "<text>"     send another message in a new session
 *   pnpm aiven:agent --status               list the integration's tools and the agent, send nothing
 *
 * Needs AIVEN_API_TOKEN, AIVEN_PROJECT, AIVEN_ORGANIZATION_ID and DOCK_DEMO_ORG_JWK (web/.env.local), the same
 * key the server trusts. The mandate is Laakso Catering's demo mandate (valid 7 days) and travels as the
 * integration's bearer token; the agent id goes on the URL (`?agent_id=`), since the integration sends no
 * custom headers. Uses the project's existing Managed Agents environment (free tier, daily run limit).
 * Prints no secrets.
 */
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { env, loadLocalEnv } from "./lib/env";

loadLocalEnv();
const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const DOCK_URL = (flag("--url") ?? "https://aimopilot.zeroanomaly.tech").replace(/\/$/, "");
const INTEGRATION = "dock";
const AGENT_NAME = "Laakso Catering purchasing agent";
const MODEL = flag("--model") ?? "gemini-3.8-flash";
const MESSAGE =
  flag("--message") ??
  "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.";

const SYSTEM = `You are the purchasing agent of Laakso Catering Oy, a catering kitchen in Finland. You buy from the
wholesaler Valio Aimo through AimoPilot, using only the AimoPilot tools. Your signed mandate (read it with the mandate tool
first) says what you may buy, how much you may spend alone, and who signs off above that.
Work like this: open a request, look products up in master data, check live price and availability only for a
short list, get a fixed-price quote, then place the order. If AimoPilot says the order needs a human sign-off, stop and
report who must approve and why. Never invent product ids or prices; use what AimoPilot returns. If AimoPilot refuses
something, report the rule it named. Answer the buyer briefly: what you ordered or proposed, the total, the
delivery date, and anything that needs their attention.`;

const token = env("AIVEN_API_TOKEN");
const project = env("AIVEN_PROJECT");
const org = env("AIVEN_ORGANIZATION_ID");
if (!token || !project || !org) throw new Error("AIVEN_API_TOKEN, AIVEN_PROJECT and AIVEN_ORGANIZATION_ID must be set");
const BASE = `https://api.aiven.io/v1/organization/${org}/project/${project}/managed-agents`;

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `aivenv1 ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type Tool = { id: string; name: string; display_name?: string };
type Integration = { integration_name: string; status: string; status_detail?: string | null; tools: Tool[] };
type Agent = { id?: string; agent_id?: string; name: string; model: string };

async function main() {
  const envs = await api<{ environments: { name: string; status: string; plan: string }[] }>("GET", "/environment");
  const environment = envs.environments[0];
  if (!environment) throw new Error("This project has no Managed Agents environment; create one in the Console first.");
  console.log(`Managed Agents environment ${environment.name}: ${environment.status} (${environment.plan})`);

  const list = async () => (await api<{ integrations: Integration[] }>("GET", `/environment/${environment.name}/integration`)).integrations;
  let dock = (await list()).find((i) => i.integration_name === INTEGRATION);
  if (!dock && !args.includes("--status")) {
    const mandate = await signMandate(demoMandate(new Date()), await demoOrgKeyPair());
    await api("POST", `/environment/${environment.name}/integration`, {
      catalog_type: "custom",
      name: INTEGRATION,
      custom_url: `${DOCK_URL}/api/mcp?agent_id=${DEMO_ORG.agentId}`,
      credentials: { token: mandate },
      read_only: false,
    });
    dock = (await list()).find((i) => i.integration_name === INTEGRATION);
  }
  if (!dock) throw new Error(`integration "${INTEGRATION}" not found`);
  console.log(`Integration "${dock.integration_name}": ${dock.status}${dock.status_detail ? ` (${dock.status_detail})` : ""}, ${dock.tools.length} tools: ${dock.tools.map((t) => t.name).join(", ")}`);

  const agents = (await api<{ agents: Agent[] }>("GET", "/agent")).agents ?? [];
  let agent = agents.find((a) => a.name === AGENT_NAME);
  if (args.includes("--status")) {
    console.log(agent ? `Agent "${agent.name}" (${agent.model})` : "No agent yet.");
    return;
  }
  if (!agent) {
    agent = await api<Agent>("POST", "/agent", { name: AGENT_NAME, model: MODEL, system_instructions: SYSTEM, tool_ids: dock.tools.map((t) => t.id) });
    console.log(`Created agent "${AGENT_NAME}" on ${MODEL}.`);
  }
  const agentId = agent.id ?? agent.agent_id;
  const session = await api<{ id?: string; session_id?: string }>("POST", `/agent/${agentId}/session`, {});
  const sessionId = session.id ?? session.session_id;
  console.log(`\nSession ${sessionId}. Buyer: "${MESSAGE}"\n`);
  const t0 = Date.now();
  const reply = await api<Record<string, unknown>>("POST", `/agent/${agentId}/session/${sessionId}/message`, { message: MESSAGE, stream: false });
  console.log(`Agent replied after ${Math.round((Date.now() - t0) / 1000)} s:\n`);
  console.log(JSON.stringify(reply, null, 2).slice(0, 6000));
}

main().catch((err) => {
  console.error(`aiven:agent failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
