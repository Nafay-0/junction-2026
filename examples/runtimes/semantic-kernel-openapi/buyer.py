# /// script
# requires-python = ">=3.12"
# dependencies = ["semantic-kernel==1.47.0"]
# [tool.uv]
# prerelease = "allow"  # semantic-kernel 1.47.0 depends on a beta of azure-ai-agents
# ///
"""A purchasing agent with no MCP client: Microsoft Semantic Kernel turns the gate's OpenAPI 3.1 document into tools.

    DOCK_URL=http://localhost:3000 DOCK_MANDATE=<jws> DOCK_AGENT_ID=<id> uv run buyer.py

The REST door: the agent fetches /api/v1/openapi.json, keeps the operations that take the credential it holds
(the document's own `security` requirements), and calls them with the mandate as `Authorization: Bearer` plus
`Dock-Agent-Id`. The buyer is a scripted person, Sanna, never the model: a Semantic Kernel auto-function-invocation
filter stops any operation that carries a person's answer until she has reviewed it. The OpenAPI document does not
mark which operations those are, so this file names them (HUMAN_INPUT_OPERATIONS): the one line that knows Dock.
"""

import asyncio
import json
import os
import time
from datetime import date
from importlib.metadata import version

import httpx
from semantic_kernel import Kernel
from semantic_kernel.agents import ChatCompletionAgent, ChatHistoryAgentThread
from semantic_kernel.connectors.ai import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings
from semantic_kernel.connectors.openapi_plugin import OpenAPIFunctionExecutionParameters
from semantic_kernel.contents import ChatMessageContent
from semantic_kernel.filters import AutoFunctionInvocationContext, FilterTypes
from semantic_kernel.functions import FunctionResult, KernelArguments

RUNTIME, PACKAGE = "semantic-kernel (OpenAPI)", "semantic-kernel"
BASE = os.environ.get("DOCK_URL", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("MODEL", "gpt-6-luna")
PRICES = {"gpt-6-luna": (0.10, 0.50), "gpt-5-mini": (0.25, 2.00), "gpt-5-nano": (0.05, 0.40)}  # USD per million tokens, in/out
HEADERS = {"Authorization": f"Bearer {os.environ['DOCK_MANDATE']}", "Dock-Agent-Id": os.environ["DOCK_AGENT_ID"]}
HUMAN_INPUT_OPERATIONS = {"respondToConcerns", "answerQuestions"}  # not marked in the OpenAPI document (see RESULTS.md)

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
state = {"replies": 0, "self_answers": 0, "calls": [], "refusals": [], "outcome": "no_order", "order_id": None, "pending": False, "retried": False}


def sanna_reviews(args: dict) -> str | None:
    if state["replies"] == 0:
        return "The buyer has not been asked yet. Ask her in plain words and wait for her answer."
    text = json.dumps(args, ensure_ascii=False)
    if "Sanna" not in text:
        return f"This is my answer, so put my name as by: {BUYER}."
    if "use_100_L" in text:
        return "I said 1,000 litres is right: confirm it as asked."
    return None


def short(value, n=160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"


def inline_refs(spec: dict) -> dict:
    """Workaround: Semantic Kernel builds no body parameters from a parsed spec whose request bodies are `$ref`s."""
    def walk(node, depth=0):
        if isinstance(node, dict):
            if str(node.get("$ref", "")).startswith("#/") and depth < 12:
                target = spec
                for key in node["$ref"][2:].split("/"):
                    target = target[key]
                return walk({**target, **{k: v for k, v in node.items() if k != "$ref"}}, depth + 1)
            return {k: walk(v, depth) for k, v in node.items()}
        return [walk(v, depth) for v in node] if isinstance(node, list) else node
    return {**spec, "paths": walk(spec["paths"])}


class KeepRefusals(httpx.AsyncBaseTransport):
    """Workaround: Semantic Kernel raises on any 4xx and hands the model only "Error running OpenAPI operation".
    The gate's refusal body (error.code, error.rule, error.message) is what the agent needs, so pass it on as is."""

    def __init__(self) -> None:
        self.inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        if 400 <= response.status_code < 500:
            body = await response.aread()
            return httpx.Response(200, headers={"content-type": "application/json", "x-original-status": str(response.status_code)}, content=body)
        return response


def operations_for_my_credential(spec: dict) -> set[str]:
    """Operations whose OpenAPI security requirement is the bearer credential this agent holds."""
    default = spec.get("security")
    keep = set()
    for ops in spec["paths"].values():
        for method, op in ops.items():
            if method in ("get", "post", "put", "patch", "delete"):
                security = op.get("security", default)
                if security is None or any("mandate" in req for req in security):
                    keep.add(op["operationId"])
    return keep


async def main() -> None:
    t0 = time.time()
    spec = httpx.get(f"{BASE}/api/v1/openapi.json").json()
    allowed = operations_for_my_credential(spec)
    kernel = Kernel()
    kernel.add_plugin_from_openapi(
        "dock",
        openapi_parsed_spec=inline_refs(spec),
        execution_settings=OpenAPIFunctionExecutionParameters(
            auth_callback=lambda **headers: HEADERS,
            http_client=httpx.AsyncClient(transport=KeepRefusals(), timeout=60),
            operation_selection_predicate=lambda ctx: ctx.operation_id in allowed,
            server_url_override=BASE,
            allow_private_network_access=True,  # the demo gate runs on localhost ...
            server_url_validation_allowed_base_urls=[BASE] if BASE.startswith("http://") else None,  # ... over plain http
            enable_payload_namespacing=True,
        ),
    )
    names = [f.name for f in kernel.get_plugin("dock").functions.values()]
    print(f"[connect] {BASE}/api/v1/openapi.json (OpenAPI {spec['openapi']}): {len(names)} operations for this credential: {', '.join(sorted(names))}")

    @kernel.filter(FilterTypes.AUTO_FUNCTION_INVOCATION)
    async def gate_calls(context: AutoFunctionInvocationContext, next):
        name, args = context.function.name, {k: v for k, v in (context.arguments or {}).items() if k != "kernel"}
        state["calls"].append(name)
        state["retried"] |= name == "placeOrder" and state["pending"]
        print(f"[tool call] {name} {short(args)}")
        if name in HUMAN_INPUT_OPERATIONS:
            objection = sanna_reviews(args)
            state["self_answers"] += bool(objection and state["replies"] == 0)
            print(f"[buyer review] {name} -> {'rejected: ' + objection if objection else 'approved'}")
            if objection:
                context.function_result = FunctionResult(function=context.function.metadata, value=json.dumps({"rejected_by_buyer": objection}))
                return
        await next(context)
        raw = context.function_result.value if context.function_result else ""
        try:
            r = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except ValueError:
            r = {"text": str(raw)}
        err = r.get("error") or {}
        if err:
            state["refusals"].append({"tool": name, "code": err.get("code"), "rule": err.get("rule")})
            print(f"[refused] {name}: {err.get('code')} (rule {err.get('rule')}) {short(err.get('message', ''))}")
        else:
            step = r.get("step") or {}
            print(f"[result] {name} {step.get('state') or (r.get('order') or {}).get('status') or ''} {short((step.get('next') or {}).get('path') or r.get('nextStep') or r)}")
        order = r.get("order") or {}
        if order.get("status") in ("committed", "pending_approval"):
            state["outcome"], state["order_id"] = order["status"], order.get("orderId")
            state["pending"] |= order["status"] == "pending_approval"
        elif name == "placeOrder" and err.get("code") == "policy_rejected" and state["outcome"] == "no_order":
            state["outcome"] = f"refused:{err.get('rule')}"

    agent = ChatCompletionAgent(
        service=OpenAIChatCompletion(ai_model_id=MODEL),
        kernel=kernel,
        name="kitchen_buyer",
        instructions=INSTRUCTIONS,
        # gpt-6-luna takes function tools on Chat Completions only with reasoning_effort "none", a value Semantic
        # Kernel 1.47's typed setting rejects (low/medium/high only): send it as extra_body instead.
        arguments=KernelArguments(settings=OpenAIChatPromptExecutionSettings(
            function_choice_behavior=FunctionChoiceBehavior.Auto(), extra_body={"reasoning_effort": "none"} if MODEL == "gpt-6-luna" else None)),
    )
    thread = ChatHistoryAgentThread()
    tokens = {"in": 0, "out": 0, "requests": 0}

    def count(msg: ChatMessageContent) -> None:
        usage = (msg.metadata or {}).get("usage")
        if usage is not None and msg.role.value == "assistant":
            tokens["in"] += getattr(usage, "prompt_tokens", 0) or 0
            tokens["out"] += getattr(usage, "completion_tokens", 0) or 0
            tokens["requests"] += 1

    async def intermediate(msg: ChatMessageContent) -> None:
        if any(type(i).__name__ == "FunctionCallContent" for i in msg.items):
            count(msg)

    print(f"[user] {TASK}")
    prompt = TASK
    for _ in range(6):
        async for response in agent.invoke(messages=prompt, thread=thread, on_intermediate_message=intermediate):
            count(response.message)
            if str(response.message.content).strip():
                print(f"[agent] {str(response.message.content).strip()}")
            thread = response.thread
        if state["outcome"] in ("committed", "pending_approval"):
            break
        print(f"[buyer] {REPLY}")
        state["replies"] += 1
        prompt = REPLY

    price = PRICES.get(MODEL)
    cost = round((tokens["in"] * price[0] + tokens["out"] * price[1]) / 1e6, 5) if price else None
    print("RESULT " + json.dumps({
        "runtime": RUNTIME, "version": version(PACKAGE), "model": f"openai:{MODEL}", "outcome": state["outcome"], "orderId": state["order_id"],
        "steps": tokens["requests"], "toolCalls": len(state["calls"]), "tools": state["calls"], "refusals": state["refusals"],
        "humanInput": "relay+filter", "humanTurns": state["replies"], "selfAnswerAttempts": state["self_answers"],
        "retriedAfterPending": state["retried"], "seconds": round(time.time() - t0, 1),
        "tokens": {"input": tokens["in"], "output": tokens["out"]}, "costUsd": cost, "interface": "openapi",
    }))


if __name__ == "__main__":
    asyncio.run(main())
