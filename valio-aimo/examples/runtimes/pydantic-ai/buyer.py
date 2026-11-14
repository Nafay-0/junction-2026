# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic-ai-slim[mcp,anthropic,openai]==2.68.0"]
# ///
"""A purchasing agent on Pydantic AI that orders through any MCP server it is pointed at.

    DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> uv run buyer.py

Nothing here knows the gate beyond its address and the mandate: the agent discovers the tools over MCP
(Streamable HTTP) and follows the gate's own descriptions. The buyer is a scripted person, Sanna, never the
model: Pydantic AI declares MCP elicitation, so the gate asks her directly through the client
(`elicitation_handler`), and her text replies come back as user turns when the agent stops to ask.
"""

import asyncio
import json
import os
import time
import warnings
from datetime import date
from importlib.metadata import version

from pydantic_ai import Agent, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.mcp import MCPToolset

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
# Pydantic AI warns that the elicitation handler "will never be called" on a 2026-07-28 session. It is called: the
# MCP SDK answers `input_required` tool results through it. Silenced so the transcript stays readable.
warnings.filterwarnings("ignore", message=".*will never be called.*")

RUNTIME, PACKAGE = "pydantic-ai", "pydantic-ai-slim"
BASE = os.environ.get("DOCK_URL", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("MODEL", "anthropic:claude-haiku-5-5")
PRICES = {"anthropic:claude-haiku-5-5": (0.10, 0.50), "openai:gpt-6-luna": (0.10, 0.50)}  # USD per million tokens, in/out

TASK = "Order 1,000 litres of lactose-free milk for delivery on Monday for this kitchen; ask me if something needs my decision."
INSTRUCTIONS = (
    f"You are the purchasing agent of a restaurant kitchen. Today is {date.today():%A %d %B %Y}. "
    "Use the tools you have to carry out the buyer's request. When something needs the buyer's decision, "
    "stop and ask them in plain words; never answer on their behalf."
)

# ---- the human buyer, scripted. She answers the gate's forms and the agent's questions; the model never does. ----
BUYER = "Sanna Koskinen"
REPLY = (
    "Yes, 1,000 litres is right: we have a wedding this week. If something has to be chosen, take the cheapest "
    "option that meets our requirements; delivery any day up to Monday is fine. Go ahead and place the order. "
    "- Sanna Koskinen, head chef"
)


def sanna_fills(schema: dict) -> dict:
    """Her answer to a form the gate sends: keep the quantity as asked, and price matters most."""
    content: dict = {"by": BUYER}
    for key, field in (schema.get("properties") or {}).items():
        choices = [c["const"] for c in field.get("oneOf", [])]
        if choices:
            content[key] = next((c for c in ("confirm", "price") if c in choices), choices[0])
    return content


human_log: list[str] = []


async def elicitation_handler(message, response_type, params, context):
    content = sanna_fills(params.requested_schema)
    print(f"[buyer form] {message}\n             {BUYER} answers: {json.dumps(content)}")
    human_log.append("form")
    return content


# ---- transcript helpers ----
def short(value, n=160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def as_dict(content) -> dict:
    if isinstance(content, dict):
        return content
    try:
        return json.loads(content)
    except (TypeError, ValueError):
        return {"text": str(content)}


async def main() -> None:
    t0 = time.time()
    dock = MCPToolset(
        f"{BASE}/api/mcp",
        id="dock",
        headers={"Authorization": f"Bearer {os.environ['DOCK_MANDATE']}", "Dock-Agent-Id": os.environ["DOCK_AGENT_ID"]},
        elicitation_handler=elicitation_handler,
        include_instructions=True,  # pass the server's own instructions to the model (off by default)
        tool_error_behavior="failed",  # show refusals to the model as failed results, not "retry" prompts
    )
    agent = Agent(MODEL, toolsets=[dock], instructions=INSTRUCTIONS)

    calls, refusals, outcome, order_id, pending_seen, retried_after_pending = [], [], "no_order", None, False, False
    usage_in = usage_out = requests = 0
    async with agent:
        tools = await dock.list_tools()
        print(f"[connect] {BASE}/api/mcp: {dock.server_info.name} {dock.server_info.version}, {len(tools)} tools: {', '.join(t.name for t in tools)}")
        prompt, history = TASK, None
        print(f"[user] {TASK}")
        for turn in range(5):
            result = await agent.run(prompt, message_history=history)
            u = result.usage
            usage_in, usage_out, requests = usage_in + u.input_tokens, usage_out + u.output_tokens, requests + u.requests
            for msg in result.new_messages():
                for part in msg.parts:
                    if isinstance(msg, ModelResponse) and isinstance(part, ToolCallPart):
                        calls.append(part.tool_name)
                        if part.tool_name == "place_order" and pending_seen:
                            retried_after_pending = True
                        print(f"[tool call] {part.tool_name} {short(part.args_as_dict())}")
                    elif isinstance(msg, ModelResponse) and isinstance(part, TextPart) and part.content.strip():
                        print(f"[agent] {part.content.strip()}")
                    elif isinstance(msg, ModelRequest) and isinstance(part, ToolReturnPart):
                        r = as_dict(part.content)
                        err = r.get("error") or {}
                        if err:
                            refusals.append({"tool": part.tool_name, "code": err.get("code"), "rule": err.get("rule")})
                            print(f"[refused] {part.tool_name}: {err.get('code')} (rule {err.get('rule')}) {short(err.get('message', ''))}")
                        else:
                            state = (r.get("step") or {}).get("state") or (r.get("order") or {}).get("status") or ""
                            print(f"[result] {part.tool_name} {state} {short(r.get('nextStep', r.get('text', '')))}")
                        order = r.get("order") or {}
                        if part.tool_name in ("place_order", "get_order") and order.get("status") in ("committed", "pending_approval"):
                            outcome, order_id = order["status"], order.get("orderId")
                            pending_seen = pending_seen or order["status"] == "pending_approval"
                        elif part.tool_name == "place_order" and err.get("code") == "policy_rejected" and outcome == "no_order":
                            outcome = f"refused:{err.get('rule')}"
            if outcome in ("committed", "pending_approval"):
                break
            # The agent stopped without an order: it is asking the buyer something. Sanna answers.
            print(f"[buyer] {REPLY}")
            human_log.append("reply")
            prompt, history = REPLY, result.all_messages()

    price = PRICES.get(MODEL)
    cost = round((usage_in * price[0] + usage_out * price[1]) / 1e6, 5) if price else None
    print("RESULT " + json.dumps({
        "runtime": RUNTIME, "version": version(PACKAGE), "model": MODEL, "outcome": outcome, "orderId": order_id,
        "steps": requests, "toolCalls": len(calls), "tools": calls, "refusals": refusals,
        "humanInput": "elicitation" if "form" in human_log else "relay", "humanTurns": human_log.count("reply"),
        "retriedAfterPending": retried_after_pending, "seconds": round(time.time() - t0, 1),
        "tokens": {"input": usage_in, "output": usage_out}, "costUsd": cost,
    }))


if __name__ == "__main__":
    asyncio.run(main())
