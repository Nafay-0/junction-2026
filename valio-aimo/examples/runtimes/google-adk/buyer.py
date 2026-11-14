# /// script
# requires-python = ">=3.12"
# dependencies = ["google-adk[mcp]==2.14.1"]
# ///
"""A purchasing agent on Google's Agent Development Kit (Gemini) that orders through any MCP server.

    DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> GOOGLE_API_KEY=... uv run buyer.py

Nothing here knows the gate beyond its address and the mandate: ADK's McpToolset discovers the tools over
Streamable HTTP. The buyer is a scripted person, Sanna, never the model. ADK's MCP client speaks the 2025-11-25
handshake, on which a stateless server cannot ask her through the client, so the agent relays her answer; every
tool the server marks as needing a person (`_meta["dock/humanInput"]`) goes through ADK's own tool confirmation
(`require_confirmation` -> `adk_request_confirmation`), where Sanna checks the call carries what she said. The
elicitation callback stays wired in for when ADK's 2026-07-28 support works.
"""

import asyncio
import json
import os
import time
from datetime import date
from importlib.metadata import version

from google.adk.agents import LlmAgent
from google.adk.runners import InMemoryRunner
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams
from google.genai import types
from mcp.types import ElicitResult

RUNTIME, PACKAGE = "google-adk", "google-adk"
BASE = os.environ.get("DOCK_URL", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("MODEL", "gemini-3.1-flash-lite")
PRICES = {"gemini-3.1-flash-lite": (0.25, 1.50)}  # USD per million tokens, in/out
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")
# ADK connects with the 2025-11-25 handshake. Its experimental ADK_ENABLE_MCP_MODERN_PROTOCOL=1 switches to
# 2026-07-28, but ADK 2.14.1 then fails on the server's `input_required` result (it does not pass
# allow_input_required to the MCP SDK), so the gate cannot ask the buyer through the client. Left off.

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
human_log: list[str] = []


def sanna_reviews(args: dict, she_has_spoken: bool) -> str | None:
    """Sanna checks a call that claims to carry her answer. None means she approves it."""
    if not she_has_spoken:
        return "The buyer has not been asked yet. Ask her in plain words and wait for her answer."
    if "Sanna" not in str(args.get("by", "")):
        return f"This is my answer, so put my name as by: {BUYER}."
    if any(r.get("choice") != "confirm" for r in args.get("responses") or []):
        return "I said 1,000 litres is right: confirm it as asked."
    return None


def sanna_fills(schema: dict) -> dict:
    content: dict = {"by": BUYER}
    for key, field in (schema.get("properties") or {}).items():
        choices = [c["const"] for c in field.get("oneOf", [])]
        if choices:
            content[key] = next((c for c in ("confirm", "price") if c in choices), choices[0])
    return content


async def elicitation_callback(context, params) -> ElicitResult:
    """The gate's form, shown to the buyer (not the model). Called by the MCP SDK under ADK."""
    schema = getattr(params, "requested_schema", None) or getattr(params, "requestedSchema", {})
    content = sanna_fills(schema)
    print(f"[buyer form] {params.message}\n             {BUYER} answers: {json.dumps(content)}")
    human_log.append("form")
    return ElicitResult(action="accept", content=content)


def short(value, n=160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def as_dict(response) -> dict:
    """ADK wraps an MCP result as a dict; dig out the gate's JSON (structuredContent or its text copy)."""
    if not isinstance(response, dict):
        return {"text": str(response)}
    if "structuredContent" in response or "structured_content" in response:
        return response.get("structuredContent") or response.get("structured_content")
    for block in response.get("content") or []:
        try:
            return json.loads(block.get("text", ""))
        except (TypeError, ValueError, AttributeError):
            pass
    return response


async def main() -> None:
    t0 = time.time()
    connection = StreamableHTTPConnectionParams(
        url=f"{BASE}/api/mcp",
        headers={"Authorization": f"Bearer {os.environ['DOCK_MANDATE']}", "Dock-Agent-Id": os.environ["DOCK_AGENT_ID"]},
        timeout=30.0,
    )
    dock = McpToolset(connection_params=connection, elicitation_callback=elicitation_callback)
    tools = await dock.get_tools()
    print(f"[connect] {BASE}/api/mcp: {len(tools)} tools: {', '.join(t.name for t in tools)}")
    person = [t.name for t in tools if ((t._mcp_tool.meta or {}).get("dock/humanInput") or {}).get("required")]
    await dock.close()
    # Two views of the same server: the tools that need a person go through ADK's confirmation step.
    dock = McpToolset(connection_params=connection, elicitation_callback=elicitation_callback, tool_filter=[t.name for t in tools if t.name not in person])
    for_person = McpToolset(connection_params=connection, elicitation_callback=elicitation_callback, tool_filter=person, require_confirmation=True)
    # The shared API key meets Gemini's per-minute quota now and then (429/503): let google-genai back off and retry.
    retry = types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=6, initial_delay=8, max_delay=60, http_status_codes=[429, 503]))
    agent = LlmAgent(name="kitchen_buyer", model=MODEL, instruction=INSTRUCTIONS, tools=[dock, for_person],
                     generate_content_config=types.GenerateContentConfig(http_options=retry))
    runner = InMemoryRunner(agent=agent, app_name="kitchen_buyer")
    session = await runner.session_service.create_session(app_name="kitchen_buyer", user_id="sanna")

    calls, refusals = [], []
    outcome, order_id, pending_seen, retried_after_pending = "no_order", None, False, False
    tokens_in = tokens_out = steps = 0
    message = types.Content(role="user", parts=[types.Part(text=TASK)])
    print(f"[user] {TASK}")
    replies = self_answers = 0
    for _ in range(8):
        confirmations = []
        async for ev in runner.run_async(user_id="sanna", session_id=session.id, new_message=message):
            if ev.usage_metadata and ev.author == agent.name:
                steps += 1
                tokens_in += ev.usage_metadata.prompt_token_count or 0
                tokens_out += (ev.usage_metadata.candidates_token_count or 0) + (ev.usage_metadata.thoughts_token_count or 0)
            for fc in ev.get_function_calls():
                if fc.name == "adk_request_confirmation":
                    confirmations.append(fc)
                    continue
                calls.append(fc.name)
                retried_after_pending |= fc.name == "place_order" and pending_seen
                print(f"[tool call] {fc.name} {short(fc.args)}")
            for fr in ev.get_function_responses():
                r = as_dict(fr.response)
                err = r.get("error") or {}
                if isinstance(err, str):  # ADK's own {"error": "..."} (a call paused for confirmation, or rejected)
                    print(f"[adk] {fr.name}: {err}")
                    continue
                if err:
                    refusals.append({"tool": fr.name, "code": err.get("code"), "rule": err.get("rule")})
                    print(f"[refused] {fr.name}: {err.get('code')} (rule {err.get('rule')}) {short(err.get('message', ''))}")
                else:
                    state = (r.get("step") or {}).get("state") or (r.get("order") or {}).get("status") or ""
                    print(f"[result] {fr.name} {state} {short(r.get('nextStep', r))}")
                order = r.get("order") or {}
                if order.get("status") in ("committed", "pending_approval"):
                    outcome, order_id = order["status"], order.get("orderId")
                    pending_seen |= order["status"] == "pending_approval"
                elif fr.name == "place_order" and err.get("code") == "policy_rejected" and outcome == "no_order":
                    outcome = f"refused:{err.get('rule')}"
            if ev.content and ev.content.parts and ev.author == agent.name:
                text = "".join(p.text or "" for p in ev.content.parts if not getattr(p, "thought", False)).strip()
                if text:
                    print(f"[agent] {text}")
        if confirmations:
            # ADK paused before a human-input tool: Sanna reviews the call; the run continues with her decision.
            parts = []
            for fc in confirmations:
                original = fc.args.get("originalFunctionCall") or {}
                objection = sanna_reviews(original.get("args") or {}, replies > 0)
                self_answers += bool(objection and replies == 0)
                print(f"[buyer review] {original.get('name')} {short(original.get('args'))} -> {'rejected: ' + objection if objection else 'approved'}")
                parts.append(types.Part(function_response=types.FunctionResponse(id=fc.id, name=fc.name, response={"confirmed": objection is None})))
            message = types.Content(role="user", parts=parts)
            continue
        if outcome in ("committed", "pending_approval"):
            break
        print(f"[buyer] {REPLY}")
        replies += 1
        message = types.Content(role="user", parts=[types.Part(text=REPLY)])
    await dock.close()
    await for_person.close()

    price = PRICES.get(MODEL)
    cost = round((tokens_in * price[0] + tokens_out * price[1]) / 1e6, 5) if price else None
    print("RESULT " + json.dumps({
        "runtime": RUNTIME, "version": version(PACKAGE), "model": f"google:{MODEL}", "outcome": outcome, "orderId": order_id,
        "steps": steps, "toolCalls": len(calls), "tools": calls, "refusals": refusals,
        "humanInput": "elicitation" if "form" in human_log else "relay+approval", "humanTurns": replies, "selfAnswerAttempts": self_answers,
        "retriedAfterPending": retried_after_pending, "seconds": round(time.time() - t0, 1),
        "tokens": {"input": tokens_in, "output": tokens_out}, "costUsd": cost,
    }))


if __name__ == "__main__":
    asyncio.run(main())
