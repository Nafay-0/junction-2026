# /// script
# requires-python = ">=3.12"
# dependencies = ["langchain==1.5.0", "langgraph==1.2.21", "langchain-mcp-adapters==0.3.2", "langchain-anthropic==1.7.10"]
# ///
"""A purchasing agent on LangGraph (LangChain v1 `create_agent`) that orders through any MCP server.

    DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> uv run buyer.py

Nothing here knows the gate beyond its address and the mandate: `langchain-mcp-adapters` connects over Streamable
HTTP with the two headers and turns the discovered tools into LangChain tools. The adapters pin the MCP SDK below
2.0 (2025-11-25 handshake), so the gate cannot ask the buyer through the client; the agent relays her answer.
Every tool the server marks as needing a person (`_meta["dock/humanInput"]`) is interrupted by LangGraph's
`HumanInTheLoopMiddleware`; the scripted buyer, Sanna, reviews the call and the graph resumes from its
checkpoint with her decision (`Command(resume=...)`). The model never approves anything.
"""

import asyncio
import json
import os
import time
from datetime import date
from importlib.metadata import version

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

RUNTIME, PACKAGE = "langgraph", "langgraph"
BASE = os.environ.get("DOCK_URL", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("MODEL", "anthropic:claude-haiku-5-5")
PRICES = {"anthropic:claude-haiku-5-5": (0.10, 0.50), "openai:gpt-6-luna": (0.10, 0.50)}  # USD per million tokens, in/out

TASK = "Order 1,000 litres of lactose-free milk for delivery on Monday for this kitchen; ask me if something needs my decision."
INSTRUCTIONS = (
    f"You are the purchasing agent of a restaurant kitchen. Today is {date.today():%A %d %B %Y}. "
    "Use the tools you have to carry out the buyer's request. When something needs the buyer's decision, "
    "stop and ask them in plain words; never answer on their behalf."
)

# ---- the human buyer, scripted ----
BUYER = "Sanna Koskinen"
REPLY = (
    "Yes, 1,000 litres is right: we have a wedding this week. If something has to be chosen, take the cheapest "
    "option that meets our requirements; delivery any day up to Monday is fine. Go ahead and place the order. "
    "- Sanna Koskinen, head chef"
)


def sanna_reviews(args: dict, she_has_spoken: bool) -> str | None:
    """Sanna checks a call that claims to carry her answer. None means she approves it."""
    if not she_has_spoken:
        return "The buyer has not been asked yet. Ask her in plain words and wait for her answer."
    if "Sanna" not in str(args.get("by", "")):
        return f"This is my answer, so put my name as by: {BUYER}."
    if any(r.get("choice") != "confirm" for r in args.get("responses") or []):
        return "I said 1,000 litres is right: confirm it as asked."
    return None


def short(value, n=160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def gate_json(msg: ToolMessage) -> dict:
    content = msg.content
    text = "".join(c.get("text", "") for c in content if isinstance(c, dict)) if isinstance(content, list) else str(content)
    try:
        return json.loads(text)
    except ValueError:
        return {"text": text}


async def main() -> None:
    t0 = time.time()
    client = MultiServerMCPClient({
        "dock": {
            "transport": "streamable_http",
            "url": f"{BASE}/api/mcp",
            "headers": {"Authorization": f"Bearer {os.environ['DOCK_MANDATE']}", "Dock-Agent-Id": os.environ["DOCK_AGENT_ID"]},
        }
    })
    tools = await client.get_tools()
    print(f"[connect] {BASE}/api/mcp: {len(tools)} tools: {', '.join(t.name for t in tools)}")
    person = [t.name for t in tools if ((t.metadata or {}).get("_meta", {}).get("dock/humanInput") or {}).get("required")]

    agent = create_agent(
        MODEL,
        tools=tools,
        system_prompt=INSTRUCTIONS,
        checkpointer=InMemorySaver(),
        middleware=[HumanInTheLoopMiddleware(interrupt_on={name: {"allowed_decisions": ["approve", "reject"]} for name in person})],
    )
    config = {"configurable": {"thread_id": "kitchen-order"}, "recursion_limit": 50}

    calls, refusals, seen = [], [], 0
    outcome, order_id, pending_seen, retried_after_pending = "no_order", None, False, False
    replies = self_answers = 0
    print(f"[user] {TASK}")
    graph_input = {"messages": [HumanMessage(TASK)]}
    for _ in range(8):
        out = await agent.ainvoke(graph_input, config, version="v2")
        messages = out.value["messages"]
        names = {}
        for msg in messages[seen:]:
            if isinstance(msg, AIMessage):
                text = msg.text if isinstance(msg.text, str) else msg.text()
                if text.strip():
                    print(f"[agent] {text.strip()}")
                for tc in msg.tool_calls:
                    names[tc["id"]] = tc["name"]
                    calls.append(tc["name"])
                    retried_after_pending |= tc["name"] == "place_order" and pending_seen
                    print(f"[tool call] {tc['name']} {short(tc['args'])}")
            elif isinstance(msg, ToolMessage):
                r = gate_json(msg)
                err = r.get("error") or {}
                if isinstance(err, dict) and err:
                    refusals.append({"tool": msg.name, "code": err.get("code"), "rule": err.get("rule")})
                    print(f"[refused] {msg.name}: {err.get('code')} (rule {err.get('rule')}) {short(err.get('message', ''))}")
                else:
                    state = (r.get("step") or {}).get("state") or (r.get("order") or {}).get("status") or ""
                    print(f"[result] {msg.name} {state} {short(r.get('nextStep', r.get('text', '')))}")
                order = r.get("order") or {}
                if order.get("status") in ("committed", "pending_approval"):
                    outcome, order_id = order["status"], order.get("orderId")
                    pending_seen |= order["status"] == "pending_approval"
                elif msg.name == "place_order" and isinstance(err, dict) and err.get("code") == "policy_rejected" and outcome == "no_order":
                    outcome = f"refused:{err.get('rule')}"
        seen = len(messages)

        if out.interrupts:
            # The graph paused before a human-input tool and checkpointed. Sanna reviews; the graph resumes.
            decisions = []
            for action in out.interrupts[0].value["action_requests"]:
                objection = sanna_reviews(action["args"], replies > 0)
                self_answers += bool(objection and replies == 0)
                print(f"[buyer review] {action['name']} {short(action['args'])} -> {'rejected: ' + objection if objection else 'approved'}")
                decisions.append({"type": "reject", "message": objection} if objection else {"type": "approve"})
            graph_input = Command(resume={"decisions": decisions})
            continue
        if outcome in ("committed", "pending_approval"):
            break
        print(f"[buyer] {REPLY}")
        replies += 1
        graph_input = {"messages": [HumanMessage(REPLY)]}

    usage = [m.usage_metadata for m in messages if isinstance(m, AIMessage) and m.usage_metadata]
    tokens_in, tokens_out = sum(u["input_tokens"] for u in usage), sum(u["output_tokens"] for u in usage)
    price = PRICES.get(MODEL)
    cost = round((tokens_in * price[0] + tokens_out * price[1]) / 1e6, 5) if price else None
    print("RESULT " + json.dumps({
        "runtime": RUNTIME, "version": version(PACKAGE), "model": MODEL, "outcome": outcome, "orderId": order_id,
        "steps": len(usage), "toolCalls": len(calls), "tools": calls, "refusals": refusals,
        "humanInput": "relay+approval", "humanTurns": replies, "selfAnswerAttempts": self_answers,
        "retriedAfterPending": retried_after_pending, "seconds": round(time.time() - t0, 1),
        "tokens": {"input": tokens_in, "output": tokens_out}, "costUsd": cost,
    }))


if __name__ == "__main__":
    asyncio.run(main())
