# /// script
# requires-python = ">=3.12"
# dependencies = ["openai-agents==0.24.0"]
# ///
"""A purchasing agent on the OpenAI Agents SDK that orders through any MCP server it is pointed at.

    DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> uv run buyer.py

Nothing here knows the gate beyond its address and the mandate. The SDK's MCP client does not declare
elicitation, so the gate cannot ask the buyer directly; the agent relays her answer instead. To keep that answer
hers, every tool the server marks as needing a person (`_meta["dock/humanInput"]` in tools/list) goes through the
SDK's own approval step (`require_approval` -> `result.interruptions` -> `state.approve/reject`), where the
scripted buyer, Sanna, checks the call carries what she said. The model never approves anything.
"""

import asyncio
import json
import os
import time
from datetime import date
from importlib.metadata import version

from agents import Agent, ItemHelpers, MessageOutputItem, Runner, ToolCallItem, ToolCallOutputItem, set_tracing_disabled
from agents.mcp import MCPServerStreamableHttp

RUNTIME, PACKAGE = "openai-agents", "openai-agents"
BASE = os.environ.get("DOCK_URL", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("MODEL", "gpt-6-luna")
PRICES = {"gpt-6-luna": (0.10, 0.50)}  # USD per million tokens, in/out
set_tracing_disabled(True)  # nothing leaves this machine except the model calls

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


def needs_person(run_context, agent, tool) -> bool:
    """The SDK asks this per MCP tool: route the server's human-input tools to the buyer."""
    return bool((tool.meta or {}).get("dock/humanInput", {}).get("required"))


def short(value, n=160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def as_dict(output) -> dict:
    if isinstance(output, dict):
        output = output.get("text", json.dumps(output))
    try:
        return json.loads(output)
    except (TypeError, ValueError):
        return {"text": str(output)}


async def main() -> None:
    t0 = time.time()
    calls, refusals, notes = [], [], []
    outcome, order_id, pending_seen, retried_after_pending = "no_order", None, False, False
    replies = self_answers = 0
    usage, seen_responses, names = {"in": 0, "out": 0, "requests": 0}, set(), {}

    async with MCPServerStreamableHttp(
        name="dock",
        params={
            "url": f"{BASE}/api/mcp",
            "headers": {"Authorization": f"Bearer {os.environ['DOCK_MANDATE']}", "Dock-Agent-Id": os.environ["DOCK_AGENT_ID"]},
            "timeout": 30,
        },
        cache_tools_list=True,
        client_session_timeout_seconds=60,
        require_approval=needs_person,
    ) as dock:
        tools = await dock.list_tools()
        print(f"[connect] {BASE}/api/mcp: {len(tools)} tools: {', '.join(t.name for t in tools)}")
        agent = Agent(name="kitchen-buyer", instructions=INSTRUCTIONS, model=MODEL, mcp_servers=[dock])

        print(f"[user] {TASK}")
        run_input = TASK
        for _ in range(8):
            result = await Runner.run(agent, run_input, max_turns=20)
            for resp in result.raw_responses:  # count each model response once, across resumes
                if resp.response_id not in seen_responses:
                    seen_responses.add(resp.response_id)
                    usage = {"in": usage["in"] + resp.usage.input_tokens, "out": usage["out"] + resp.usage.output_tokens, "requests": usage["requests"] + 1}
            for item in result.new_items:
                if isinstance(item, ToolCallItem):
                    name, call_id = getattr(item.raw_item, "name", "?"), getattr(item.raw_item, "call_id", None)
                    if call_id in names:  # a call that waited for approval shows up again after the resume
                        continue
                    names[call_id] = name
                    calls.append(name)
                    retried_after_pending |= name == "place_order" and pending_seen
                    print(f"[tool call] {name} {short(getattr(item.raw_item, 'arguments', ''))}")
                elif isinstance(item, ToolCallOutputItem):
                    raw = item.raw_item
                    name = names.get(raw.get("call_id") if isinstance(raw, dict) else getattr(raw, "call_id", None), "?")
                    r = as_dict(item.output)
                    err = r.get("error") or {}
                    if err:
                        refusals.append({"tool": name, "code": err.get("code"), "rule": err.get("rule")})
                        print(f"[refused] {name}: {err.get('code')} (rule {err.get('rule')}) {short(err.get('message', ''))}")
                    else:
                        state = (r.get("step") or {}).get("state") or (r.get("order") or {}).get("status") or ""
                        print(f"[result] {name} {state} {short(r.get('nextStep', r.get('text', '')))}")
                    order = r.get("order") or {}
                    if order.get("status") in ("committed", "pending_approval"):
                        outcome, order_id = order["status"], order.get("orderId")
                        pending_seen |= order["status"] == "pending_approval"
                    elif name == "place_order" and err.get("code") == "policy_rejected" and outcome == "no_order":
                        outcome = f"refused:{err.get('rule')}"
                elif isinstance(item, MessageOutputItem):
                    print(f"[agent] {ItemHelpers.text_message_output(item).strip()}")

            if result.interruptions:
                # The SDK paused before a human-input tool: Sanna reviews each call, the run resumes from its state.
                state = result.to_state()
                for item in result.interruptions:
                    args = json.loads(item.raw_item.arguments or "{}")
                    objection = sanna_reviews(args, replies > 0)
                    if objection and replies == 0:
                        self_answers += 1
                    print(f"[buyer review] {item.tool_name} {short(args)} -> {'rejected: ' + objection if objection else 'approved'}")
                    state.approve(item) if objection is None else state.reject(item, rejection_message=objection)
                run_input = state
                continue
            if outcome in ("committed", "pending_approval"):
                break
            print(f"[buyer] {REPLY}")
            replies += 1
            run_input = result.to_input_list() + [{"role": "user", "content": REPLY}]

    if self_answers:
        notes.append(f"model tried to answer a human-input step itself {self_answers}x (rejected by the buyer)")
    price = PRICES.get(MODEL)
    cost = round((usage["in"] * price[0] + usage["out"] * price[1]) / 1e6, 5) if price else None
    print("RESULT " + json.dumps({
        "runtime": RUNTIME, "version": version(PACKAGE), "model": f"openai:{MODEL}", "outcome": outcome, "orderId": order_id,
        "steps": usage["requests"], "toolCalls": len(calls), "tools": calls, "refusals": refusals,
        "humanInput": "relay+approval", "humanTurns": replies, "selfAnswerAttempts": self_answers,
        "retriedAfterPending": retried_after_pending, "seconds": round(time.time() - t0, 1),
        "tokens": {"input": usage["in"], "output": usage["out"]}, "costUsd": cost, "notes": notes,
    }))


if __name__ == "__main__":
    asyncio.run(main())
