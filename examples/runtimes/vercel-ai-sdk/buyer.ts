/**
 * A purchasing agent on the Vercel AI SDK (v7 `ToolLoopAgent` + `@ai-sdk/mcp`) that orders through any MCP server.
 * Standalone: it shares nothing with the project's own buyer agent.
 *
 *   npm ci && DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> node buyer.ts
 *
 * Nothing here knows the gate beyond its address and the mandate: the MCP client connects over Streamable HTTP
 * with the two headers and hands the discovered tools to the agent. The buyer is a scripted person, Sanna,
 * never the model:
 *   - the client declares elicitation, so the gate asks her directly through `onElicitationRequest`;
 *   - tools the server marks as needing a person (`_meta["dock/humanInput"]`) also go through the SDK's
 *     `toolApproval` step, answered with a `tool-approval-response` after Sanna reviews the call;
 *   - when the agent stops to ask a question, Sanna's reply is the next user message.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient, ElicitationRequestSchema } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, isStepCount, type ModelMessage, type ToolApprovalStatus } from "ai";
import { readFileSync } from "node:fs";

const RUNTIME = "vercel-ai-sdk";
const VERSION = JSON.parse(readFileSync(new URL("./node_modules/ai/package.json", import.meta.url), "utf8")).version;
const BASE = (process.env.DOCK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MODEL = process.env.MODEL ?? "openai:gpt-6-luna";
const PRICES: Record<string, [number, number]> = { "openai:gpt-6-luna": [0.1, 0.5], "anthropic:claude-haiku-5-5": [0.1, 0.5] }; // USD per M tokens
const [provider, modelId] = MODEL.split(/:(.*)/);
const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);

const TASK = "Order 1,000 litres of lactose-free milk for delivery on Monday for this kitchen; ask me if something needs my decision.";
const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const INSTRUCTIONS =
  `You are the purchasing agent of a restaurant kitchen. Today is ${today}. Use the tools you have to carry out the buyer's request. ` +
  "When something needs the buyer's decision, stop and ask them in plain words; never answer on their behalf.";

// ---- the human buyer, scripted ----
const BUYER = "Sanna Koskinen";
const REPLY =
  "Yes, 1,000 litres is right: we have a wedding this week. If something has to be chosen, take the cheapest option that meets our requirements; " +
  "delivery any day up to Monday is fine. Go ahead and place the order. - Sanna Koskinen, head chef";
let replies = 0;
let forms = 0;
let selfAnswers = 0;

function sannaFills(schema: { properties?: Record<string, { oneOf?: { const: string }[] }> }): Record<string, string> {
  const content: Record<string, string> = { by: BUYER };
  for (const [key, f] of Object.entries(schema.properties ?? {})) {
    const choices = (f.oneOf ?? []).map((c) => c.const);
    if (choices.length) content[key] = choices.find((c) => c === "confirm") ?? choices.find((c) => c === "price") ?? choices[0];
  }
  return content;
}

function sannaReviews(args: Record<string, unknown>): string | undefined {
  if (replies === 0) return "The buyer has not been asked yet. Ask her in plain words and wait for her answer.";
  if (!String(args.by ?? "").includes("Sanna")) return `This is my answer, so put my name as by: ${BUYER}.`;
  if (((args.responses ?? []) as { choice?: string }[]).some((r) => r.choice !== "confirm")) return "I said 1,000 litres is right: confirm it as asked.";
  return undefined;
}

const short = (v: unknown, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gateJson(output: any): Record<string, any> {
  // An MCP tool's result reaches the model as content parts ({ type: "content", value: [{ type: "text", text }] }).
  const v = output?.value ?? output;
  if (v?.structuredContent) return v.structuredContent;
  const blocks = Array.isArray(v) ? v : Array.isArray(v?.content) ? v.content : undefined;
  const text = blocks ? blocks.map((c: { text?: string }) => c.text ?? "").join("") : typeof v === "string" ? v : "";
  try {
    return JSON.parse(text);
  } catch {
    return { text: text || JSON.stringify(v) };
  }
}

async function main() {
  const t0 = Date.now();
  const mcp = await createMCPClient({
    transport: { type: "http", url: `${BASE}/api/mcp`, headers: { Authorization: `Bearer ${process.env.DOCK_MANDATE}`, "Dock-Agent-Id": process.env.DOCK_AGENT_ID ?? "" } },
    capabilities: { elicitation: {} },
  });
  mcp.onElicitationRequest(ElicitationRequestSchema, async (req) => {
    const content = sannaFills(req.params.requestedSchema as never);
    forms++;
    console.log(`[buyer form] ${req.params.message}\n             ${BUYER} answers: ${JSON.stringify(content)}`);
    return { action: "accept", content };
  });
  const listed = await mcp.listTools();
  const person = listed.tools.filter((t) => (t._meta?.["dock/humanInput"] as { required?: boolean } | undefined)?.required).map((t) => t.name);
  const tools = await mcp.tools();
  console.log(`[connect] ${BASE}/api/mcp: ${listed.tools.length} tools: ${listed.tools.map((t) => t.name).join(", ")}`);

  const agent = new ToolLoopAgent({
    model,
    instructions: INSTRUCTIONS,
    tools,
    stopWhen: isStepCount(20),
    toolApproval: Object.fromEntries(person.map((name) => [name, "user-approval" as ToolApprovalStatus])),
  });

  const calls: string[] = [];
  const refusals: { tool: string; code?: string; rule?: string }[] = [];
  let outcome = "no_order";
  let orderId: string | undefined;
  let pendingSeen = false;
  let retriedAfterPending = false;
  let steps = 0;
  const tokens = { input: 0, output: 0 };
  const messages: ModelMessage[] = [{ role: "user", content: TASK }];
  console.log(`[user] ${TASK}`);

  for (let turn = 0; turn < 8; turn++) {
    const r = await agent.generate({ messages });
    steps += r.steps.length;
    tokens.input += r.usage.inputTokens ?? 0;
    tokens.output += r.usage.outputTokens ?? 0;
    messages.push(...r.responseMessages);
    for (const m of r.responseMessages) {
      if (typeof m.content === "string") continue;
      for (const part of m.content) {
        if (part.type === "text" && part.text.trim()) console.log(`[agent] ${part.text.trim()}`);
        if (part.type === "tool-call") {
          calls.push(part.toolName);
          if (part.toolName === "place_order" && pendingSeen) retriedAfterPending = true;
          console.log(`[tool call] ${part.toolName} ${short(part.input)}`);
        }
        if (part.type === "tool-result") {
          const out = gateJson(part.output);
          const err = out.error;
          if (err && typeof err === "object") {
            refusals.push({ tool: part.toolName, code: err.code, rule: err.rule });
            console.log(`[refused] ${part.toolName}: ${err.code} (rule ${err.rule}) ${short(err.message ?? "")}`);
          } else console.log(`[result] ${part.toolName} ${out.step?.state ?? out.order?.status ?? ""} ${short(out.nextStep ?? out.text ?? "")}`);
          const status = out.order?.status;
          if (status === "committed" || status === "pending_approval") {
            outcome = status;
            orderId = out.order.orderId;
            pendingSeen ||= status === "pending_approval";
          } else if (part.toolName === "place_order" && err?.code === "policy_rejected" && outcome === "no_order") outcome = `refused:${err.rule}`;
        }
      }
    }

    const approvals = r.content.filter((p) => p.type === "tool-approval-request");
    if (approvals.length) {
      // The SDK stopped before a human-input tool: Sanna reviews each call and the loop continues with her decision.
      messages.push({
        role: "tool",
        content: approvals.map((a) => {
          const objection = sannaReviews(a.toolCall.input as Record<string, unknown>);
          if (objection && replies === 0) selfAnswers++;
          console.log(`[buyer review] ${a.toolCall.toolName} ${short(a.toolCall.input)} -> ${objection ? "rejected: " + objection : "approved"}`);
          return { type: "tool-approval-response" as const, approvalId: a.approvalId, approved: !objection, reason: objection };
        }),
      });
      continue;
    }
    if (outcome === "committed" || outcome === "pending_approval") break;
    console.log(`[buyer] ${REPLY}`);
    replies++;
    messages.push({ role: "user", content: REPLY });
  }
  await mcp.close();

  const price = PRICES[MODEL];
  console.log(
    "RESULT " +
      JSON.stringify({
        runtime: RUNTIME, version: VERSION, model: MODEL, outcome, orderId, steps, toolCalls: calls.length, tools: calls, refusals,
        humanInput: forms ? "elicitation" : "relay+approval", humanTurns: replies, selfAnswerAttempts: selfAnswers, retriedAfterPending,
        seconds: Math.round((Date.now() - t0) / 100) / 10, tokens,
        costUsd: price ? Math.round(((tokens.input * price[0] + tokens.output * price[1]) / 1e6) * 1e5) / 1e5 : null,
      }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
