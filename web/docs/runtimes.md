# Agent runtimes that buy through Dock

Buyers built on today's popular agent runtimes order through Dock unchanged: each one knows the address and the
mandate, finds the tools over MCP (or the OpenAPI document), and orders 1,000 L of lactose-free milk until the order
is committed or waits for a person's sign-off. The code is in [`examples/runtimes/`](../../examples/runtimes/), one
file per runtime, with the results of the last live run in
[`RESULTS.md`](../../examples/runtimes/RESULTS.md) and what each runtime showed up in
[`GAPS.md`](../../examples/runtimes/GAPS.md).

Every quick start assumes a running Dock and a mandate in the environment:

```bash
export DOCK_URL=http://localhost:3000 DOCK_MANDATE=$(cd web && pnpm -s dev:mandate) DOCK_AGENT_ID=agent_laakso_buyer_01
```

The examples default to the demo kitchen (Ravintola Kaari), whose order history makes Dock question the 1,000 L;
`examples/runtimes/run-all --url $DOCK_URL` mints that mandate and runs them all.

Two tools, `respond_to_concerns` and `answer_questions`, carry the human buyer's own answer (they are marked
`_meta["dock/humanInput"]` in `tools/list`). A client on MCP 2026-07-28 that declares elicitation lets Dock ask the
person directly; on any other client, route those two tools through the runtime's approval step, as each example does.

## Pydantic AI (Python)

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset
dock = MCPToolset(f"{url}/api/mcp", headers={"Authorization": f"Bearer {mandate}", "Dock-Agent-Id": agent_id},
                  elicitation_handler=ask_the_buyer, tool_error_behavior="failed", include_instructions=True)
print((await Agent("anthropic:claude-haiku-5-5", toolsets=[dock]).run("Order 1,000 L of lactose-free milk for Monday")).output)
```

`uv run examples/runtimes/pydantic-ai/buyer.py`. Elicitation works (MCP 2026-07-28). Use `tool_error_behavior="failed"`:
the default turns Dock's refusals into retry prompts.

## OpenAI Agents SDK (Python)

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp
async with MCPServerStreamableHttp(name="dock", params={"url": f"{url}/api/mcp", "headers": {"Authorization": f"Bearer {mandate}", "Dock-Agent-Id": agent_id}},
                                   require_approval=lambda ctx, agent, tool: bool((tool.meta or {}).get("dock/humanInput"))) as dock:
    result = await Runner.run(Agent(name="buyer", model="gpt-6-luna", mcp_servers=[dock]), "Order 1,000 L of lactose-free milk for Monday")
```

`uv run examples/runtimes/openai-agents/buyer.py`. No elicitation: answer `result.interruptions` with
`state.approve()` / `state.reject()` after the buyer has spoken.

## Google Agent Development Kit (Python, Gemini)

```python
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams
conn = StreamableHTTPConnectionParams(url=f"{url}/api/mcp", headers={"Authorization": f"Bearer {mandate}", "Dock-Agent-Id": agent_id})
agent = LlmAgent(name="buyer", model="gemini-3.1-flash-lite", tools=[McpToolset(connection_params=conn, tool_filter=everyday),
                 McpToolset(connection_params=conn, tool_filter=["respond_to_concerns", "answer_questions"], require_confirmation=True)])
```

`GOOGLE_API_KEY=... uv run examples/runtimes/google-adk/buyer.py`. Answer the `adk_request_confirmation` call with a
`FunctionResponse` once the buyer has spoken.

## Claude Agent SDK (TypeScript)

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const m of query({ prompt: "Order 1,000 L of lactose-free milk for Monday", options: {
  model: "claude-haiku-5-5", tools: [], settingSources: [], strictMcpConfig: true, onElicitation: askTheBuyer, canUseTool,
  mcpServers: { dock: { type: "http", url: `${url}/api/mcp`, headers: { Authorization: `Bearer ${mandate}`, "Dock-Agent-Id": agentId } } } } })) console.log(m);
```

`cd examples/runtimes/claude-agent-sdk && npm ci && node buyer.ts`. Elicitation works (MCP 2026-07-28).

## Vercel AI SDK (TypeScript, `ToolLoopAgent`)

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import { ToolLoopAgent } from "ai";
const mcp = await createMCPClient({ transport: { type: "http", url: `${url}/api/mcp`, headers: { Authorization: `Bearer ${mandate}`, "Dock-Agent-Id": agentId } }, capabilities: { elicitation: {} } });
mcp.onElicitationRequest(ElicitationRequestSchema, askTheBuyer);
const r = await new ToolLoopAgent({ model: openai("gpt-6-luna"), tools: await mcp.tools(), toolApproval: { respond_to_concerns: "user-approval", answer_questions: "user-approval" } }).generate({ prompt });
```

`cd examples/runtimes/vercel-ai-sdk && npm ci && node buyer.ts`. Elicitation works (MCP 2026-07-28).

## LangGraph (Python, LangChain v1 `create_agent`)

```python
from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain_mcp_adapters.client import MultiServerMCPClient
tools = await MultiServerMCPClient({"dock": {"transport": "streamable_http", "url": f"{url}/api/mcp", "headers": {"Authorization": f"Bearer {mandate}", "Dock-Agent-Id": agent_id}}}).get_tools()
agent = create_agent("anthropic:claude-haiku-5-5", tools=tools, checkpointer=InMemorySaver(), middleware=[HumanInTheLoopMiddleware(interrupt_on={"respond_to_concerns": True, "answer_questions": True})])
```

`uv run examples/runtimes/langgraph/buyer.py`. Resume an interrupt with `Command(resume={"decisions": [{"type": "approve"}]})`.

## Semantic Kernel, through the OpenAPI document (Python, no MCP)

```python
spec = httpx.get(f"{url}/api/v1/openapi.json").json()
kernel.add_plugin_from_openapi("dock", openapi_parsed_spec=inline_refs(spec), execution_settings=OpenAPIFunctionExecutionParameters(
    auth_callback=lambda **h: {"Authorization": f"Bearer {mandate}", "Dock-Agent-Id": agent_id}, server_url_override=url,
    operation_selection_predicate=lambda ctx: ctx.operation_id in agent_operations, enable_payload_namespacing=True))
agent = ChatCompletionAgent(service=OpenAIChatCompletion(ai_model_id="gpt-6-luna"), kernel=kernel, instructions="...")
```

`uv run examples/runtimes/semantic-kernel-openapi/buyer.py`. The example shows the workarounds Semantic Kernel 1.47
needs (inline `$ref`s, keep 4xx bodies, allow an http base URL).
