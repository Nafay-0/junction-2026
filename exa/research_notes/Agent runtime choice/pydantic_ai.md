# Pydantic AI as the Internet Butler agent runtime (checked 14 Nov 2026)

Sources: PyPI JSON API; wheels for `pydantic-ai-slim` 2.68.0, `anthropic` 2.8.0, `genai-prices` 0.2.3 downloaded and read (not run); docs at https://pydantic.dev/docs/ai/ (ai.pydantic.dev now serves `llms.txt` / `llms-full.txt` pointing there); open issues through the public GitHub search API.

## Verdict

| Area | Rating | Why |
|---|---|---|
| Model switching | Ready | `agent.run(..., model=...)` / `run_stream_events(model=...)` / adapter `dispatch_request(model=...)` take a Model instance or string per run. |
| Claude Platform on AWS | Needs glue code (about 5 lines) | Pass `AsyncAnthropicAWS()` to `AnthropicProvider(anthropic_client=...)`. It subclasses `AsyncAnthropic`, and the model code knows it by name, but the provider docstring does not list it. |
| Gemini | Ready | `GoogleProvider` reads `GOOGLE_API_KEY`; model strings look like `google:gemini-3.8-flash`. |
| Usage | Ready | `RunUsage` has requests, tool_calls, input/output/cache read/write tokens, reasoning tokens and `cost`. Subagents add to it through `usage=ctx.usage`. |
| Cost | Ready | `genai-prices` 0.2.3 (10 Nov) already has opus-5-5, sonnet-5-5, haiku-5-5, fable-5-2 and gemini-3.8-flash / 4-argon. |
| Context overflow | Ready (light glue) | `AnthropicCompaction` capability, `ProcessHistory` / `history_processors`, a typed `ModelContextWindowExceededError`, and `FallbackModel` falls back on it. |
| Streaming rich UI | Ready | `VercelAIAdapter` streams typed tool parts, reasoning parts, and `data-*` parts from `ctx.emit(CustomEvent)` or from `ToolReturn`. |
| Clarifying questions / approval | Needs glue code | Deferred tools plus AI SDK v6 tool approval are built in. A free-form question is best modelled as a frontend (external) tool or `RequestInput`; we design the UI for it. |
| Subagents | Ready (progress needs glue) | Delegation means calling `sub.run(..., usage=ctx.usage)` inside a tool. To show live progress, forward the sub-run's events with `ctx.emit` (our code). |

## 1. Version
- `pydantic-ai` / `pydantic-ai-slim` **2.68.0**, uploaded **2026-11-12**, `requires_python >=3.11`. The project ships very often (2.68 within a few days of earlier 2.x releases), so **pin the exact version**.
- Related: `anthropic` 2.8.0 (2026-11-10, py>=3.10), `google-genai` 3.3.0 (2026-11-12), `genai-prices` 0.2.3 (2026-11-10).
- Install: `pip install "pydantic-ai-slim[anthropic,google,ui]==2.68.0"` (extras names from memory; check them on install).

## 2. Claude via a custom client (Claude Platform on AWS)
- `pydantic_ai/providers/anthropic.py`: `AnthropicProvider(*, anthropic_client: AsyncAnthropicClient | None = None)` overload, or `api_key=` / `base_url=` / `http_client=`. The `AsyncAnthropicClient` alias is `AsyncAnthropic | AsyncAnthropicBedrock | AsyncAnthropicBedrockMantle | AsyncAnthropicFoundry | AsyncAnthropicVertex`.
- The anthropic SDK 2.8.0 exports `AnthropicAWS` and `AsyncAnthropicAWS` (`anthropic/lib/aws/_client.py`). `class AsyncAnthropicAWS(AsyncAnthropic)`, so it satisfies the type alias. Constructor kwargs: `api_key`, `aws_region`, `workspace_id`, `base_url`, plus AWS access-key/secret (SigV4) options. Env vars it reads: `ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_AWS_WORKSPACE_ID`, `AWS_REGION` / `AWS_DEFAULT_REGION`, `ANTHROPIC_AWS_BASE_URL`. It sends an `anthropic-workspace-id` header.
- Pydantic AI knows this client: `models/anthropic/__init__.py` imports `AsyncAnthropicAWS` and gates per-client features (for example cited web tools are not routed directly for it). Provider comments say thinking signatures are shared across "the Anthropic API, Bedrock, Claude Platform on AWS, Vertex AI and Foundry". There is no dedicated `anthropic-aws:` model-string prefix (could not find one), so we build the model object ourselves:
```python
from anthropic import AsyncAnthropicAWS
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider

aws = AnthropicProvider(anthropic_client=AsyncAnthropicAWS())  # reads ANTHROPIC_AWS_* and AWS_REGION
def claude(model_id: str) -> AnthropicModel:      # 'claude-opus-5-5', 'claude-fable-5-2', ...
    return AnthropicModel(model_id, provider=aws)
```
- Newest models: `profiles/anthropic.py` has per-model profiles for opus-5-5, sonnet-5-5, haiku-5-5 and fable-5-1/5-2. `anthropic_supports_adaptive_thinking` turns the unified `thinking` setting into `{'type':'adaptive'}` and not `budget_tokens`. `supports_forced_tool_choice` is False for "the 5.1 and 5.2 generations, Opus 5.5, and Sonnet 5.5" (source comment: they "reject a forced tool_choice outright"). So structured output falls back to non-forced modes. `anthropic_effort` and `anthropic_task_budget` settings exist.
- Open issues worth knowing: #13233 (non-native `ThinkingPart`s replayed to Claude can trigger `content_filter`; matters when switching Gemini to Claude mid-chat) and #13386 (Anthropic `no_output` retry adds a `'.'` user turn). No open issue matches "AnthropicAWS".

## 3. Gemini (AI Studio key)
- `GoogleProvider(api_key=...)`, or the env vars `GOOGLE_API_KEY` (wins) / `GEMINI_API_KEY`. It builds `Client(vertexai=False)`, and the provider name is `google` (Vertex is `google-cloud`).
- Model strings in `_known_model_names.py`: `google:gemini-3.8-flash`, `google:gemini-3.5-flash-lite`, `google:gemini-3.1-pro-preview`, `google:gemini-4-argon`, `google:gemini-4-carbon`, `google:gemini-3.1-flash-lite`. The old `google-gla:` prefix was not found in the 2.68 source, so use `google:`.
- `GoogleModel` handles tools, streaming, thinking parts and thought signatures. Docs: https://pydantic.dev/docs/ai/models/google/ (open issue #11961: AG-UI round trips drop Gemini thought signatures; this is AG-UI only, not Vercel).

## 4. Per-run model switching
- `Agent.run / run_stream / run_stream_events / iter` all accept `model: Model | KnownModelName | str | None` (agent/abstract.py). `UIAdapter.dispatch_request(request, agent=agent, model=...)` takes the same optional args as `run_stream_events`. `agent.override(model=...)` is a context manager meant for tests. There is also a `SelectModel` capability (https://pydantic.dev/docs/ai/capabilities/select-model/).
```python
MODELS = {'claude-opus-5-5': lambda: claude('claude-opus-5-5'), 'gemini-3.8-flash': lambda: 'google:gemini-3.8-flash'}
@app.post('/chat')
async def chat(request: Request):
    m = MODELS[request.query_params.get('model', 'claude-sonnet-5-5')]()
    return await VercelAIAdapter.dispatch_request(request, agent=agent, model=m, sdk_version=6)
```
- Cross-provider history (https://pydantic.dev/docs/ai/core-concepts/message-history/#sending-history-to-another-provider): signed data such as Anthropic thinking signatures and Gemini thought signatures is only sent back to the same "canonical system". Foreign thinking is written out as text, and Gemini function calls get `skip_thought_signature_validator`. Tool call ids are handled by the framework. Gotcha: issue #13233 (see 2). Simplest fix: drop `ThinkingPart`s in a history processor when the provider changes.

## 5. Usage and cost
- `pydantic_ai.usage.RunUsage` fields: `requests`, `tool_calls`, `input_tokens`, `cache_write_tokens`, `cache_read_tokens`, `input_audio_tokens`, `cache_audio_read_tokens`, `output_tokens`, `details`, and from `UsageBase`: `output_reasoning_tokens`, `cost: Decimal | None`, plus `total_tokens` and `cache_hit_ratio`. `RequestUsage` is per response. `result.usage()` gives the run total, and `ModelResponse.cost()` returns a `genai_prices` `PriceCalculation`.
- `UsageLimits(request_limit=50 default, tool_calls_limit, input_tokens_limit, output_tokens_limit, total_tokens_limit, per_request_input_tokens_limit, cost_limit: Decimal, count_tokens_before_request)`.
- Subagents: inside a tool, `await sub_agent.run(prompt, usage=ctx.usage)` adds the sub-run's usage to the parent's (https://pydantic.dev/docs/ai/guides/multi-agent-applications/).
- Prices: `genai-prices` data.py has `claude-opus-5-5` ($4 in / $20 out / $0.2 cache read / $5 cache write per MTok, flat 1M context, plus a fast-mode tier), and also sonnet-5-5, haiku-5-5, fable-5-2, gemini-3.8-flash, gemini-4-argon and gemini-3.1-pro-preview. I did not find `gemini-4-carbon`. `pydantic_ai.prices.update_in_background()` refreshes the data. For prices it lacks, genai-prices takes custom provider/model price data (I did not check the exact API, because none of the models we need are missing). Caveat: I did not verify that cost resolves with a custom `AsyncAnthropicAWS` base URL (provider matching is by provider name `anthropic` and the model id, so it should).
```python
r = await agent.run(q, model=m, usage_limits=UsageLimits(cost_limit=Decimal('0.50')))
u = r.usage(); print(u.requests, u.tool_calls, u.input_tokens, u.cache_read_tokens, u.output_tokens, u.cost)
```

## 6. Context management and overflow
- `Agent(history_processors=[fn])`, or the `ProcessHistory` capability. Signature: `(messages: list[ModelMessage]) -> list[ModelMessage]`, which may be async and may take `ctx: RunContext` first. It runs before each model request. Docs: https://pydantic.dev/docs/ai/core-concepts/message-history/#processing-message-history, with built-in recipes "keep only recent messages" and "summarize old messages".
- Compaction (https://pydantic.dev/docs/ai/capabilities/compaction/): `AnthropicCompaction` capability uses Anthropic's server-side `context_management` and triggers past a token threshold. There is also `Model.compact_messages()` on demand. `CompactionPart` holds a summary we write ourselves and round-trips through the Vercel adapter as `data-compaction`. The separate "Pydantic AI Harness" package has ready-made model-agnostic strategies.
- Overflow error: `pydantic_ai.ModelContextWindowExceededError` (subclass of `ModelRequestRejectedError`). `FallbackModel` falls back on it by default. Otherwise catch it, compact, and retry.
- Anthropic model settings: `anthropic_context_management`, `anthropic_cache`, `anthropic_cache_instructions`, `anthropic_cache_messages`, `anthropic_cache_tool_definitions`, `anthropic_betas`, `anthropic_thinking`, `anthropic_effort`, `anthropic_task_budget`, `anthropic_speed`, `anthropic_service_tier`. There is also a Caching capability (https://pydantic.dev/docs/ai/capabilities/caching/).

## 7. Streaming to React
- Options: `VercelAIAdapter` (`pydantic_ai.ui.vercel_ai`), the AG-UI adapter (`pydantic_ai.ui.ag_ui`), or raw `agent.run_stream_events()` / `agent.iter()`.
- Vercel: targets **AI SDK v5 by default; `sdk_version=6`** enables v6 features (tool approval). Docs: https://pydantic.dev/docs/ai/integrations/ui/vercel-ai/
```python
from fastapi import FastAPI, Request
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
app = FastAPI()
@app.post('/chat')
async def chat(request: Request):
    return await VercelAIAdapter.dispatch_request(request, agent=agent, sdk_version=6)
```
- Chunk types in the source: `tool-input-start/delta/available/error`, `tool-output-available/error/denied`, `tool-approval-request`, `reasoning-start/delta/end`, so tool calls and thinking stream as typed `useChat` parts. `ToolOutputAvailableChunk` has a `preliminary` field, but I found no documented way for a tool to emit preliminary outputs (could not verify).
- Live widgets / progress: inside a tool, `await ctx.emit(MyEvent(...))` where `class MyEvent(CustomEvent)` reaches the client as `DataChunk(type='data-<name>')`. A tool can also return `ToolReturn(return_value=..., metadata=[DataChunk(type='data-search-results', data=...), SourceUrlChunk(...)])` to attach data parts to its result. `ui=False` hides an event from the UI.
- Other: `manage_message_history='server'` (keep history on the server; the client sends only the new turn), cancellation endpoint example, `dump_messages` / `build_run_input`.
- Maturity: not labelled beta in the docs; 101 open issues mention "vercel", mostly enhancements (e.g. #8239 tool metadata, #13212 file parts).

## 8. Human in the loop
- Deferred tools (https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/): `@agent.tool(requires_approval=True)`, or raise `ApprovalRequired` / `CallDeferred`. Add `DeferredToolRequests` to `output_type`. Resume with `agent.run(message_history=..., deferred_tool_results=DeferredToolResults(approvals={id: True}))`. With the Vercel adapter (`sdk_version=6`) approvals round-trip as `tool-approval-request` / approval responses through `useChat` (needs AI SDK UI v6+).
- Clarifying question: model it as an `ask_user(question, options)` tool that defers (an external / frontend tool). The UI renders a widget from its tool-input part, and the user's answer goes back as the tool output on the next `useChat` request. Or use the `RequestInput` capability (https://pydantic.dev/docs/ai/capabilities/request-input/), which waits in process via `wait_for_external_event` / `resolve_external_event` (that needs a second endpoint to deliver the answer). The deferred-and-resume path fits stateless SSE best.

## 9. Parallel tools and subagents
- The tool execution mode defaults to `'parallel'` ("Run tool calls in parallel, yielding events as they complete"); `'parallel_ordered_events'` and `'sequential'` also exist.
- Delegation: call a sub-agent inside a tool with `usage=ctx.usage`. Example: https://pydantic.dev/docs/ai/examples/complex-workflows/medical-agent-delegation/
- Subagent progress: I found no automatic nesting of sub-run events into the parent stream. Glue: run `sub.run_stream_events(...)` in the tool and `ctx.emit()` a `data-subagent` CustomEvent for each event (about 15 lines).

## 10. Structured results and files
- Tools may return any Pydantic-serialisable value (sent to the model as JSON). `ToolReturn(return_value=..., content=..., metadata=...)` splits what the model sees from what the app or UI gets (`return_value` checked in source; `content` / `metadata` per docs).
- Multimodal input: `BinaryContent(data, media_type)`, `ImageUrl(url)`, `DocumentUrl` in the user prompt; the Vercel adapter maps `useChat` file parts. Docs: https://pydantic.dev/docs/ai/core-concepts/input/

## 11. Deployment
- The docs have no FastAPI/SSE hosting guide for text agents and do not mention Modal. The only "Deployment" page is for realtime voice (https://pydantic.dev/docs/ai/realtime/deployment/), which will help the later voice step.
- Weekend options: Modal `@modal.asgi_app()` wrapping the FastAPI app (long-lived SSE works; set a generous `timeout`), or Fly.io / Render / Railway with uvicorn. Disable proxy buffering for SSE.
- The durable-execution integrations (Temporal, DBOS, Prefect, Restate, Airflow) exist but are overkill here.

## Top 3 risks
1. Release churn: 2.x ships every few days with large internal changes (capabilities, harness), so docs and examples can drift. Pin `==2.68.0` and do not upgrade before the demo.
2. Claude Platform on AWS goes through an unlisted-but-compatible client path, and some features are gated "unverified" for it (cited web tools). Smoke-test thinking, streaming and tools on it early.
3. Cross-provider switching mid-chat: thinking replay to Claude (#13233) and the cost of rebuilding the prompt cache. Drop thinking parts on a provider switch, or start a new chat when the model changes.

## Top 3 things it saves us from writing
1. The Vercel AI SDK v5/v6 stream encoder, with tool, reasoning, approval and data parts, so `useChat` works out of the box.
2. A per-run usage, token and dollar-cost ledger with limits (`RunUsage`, `UsageLimits(cost_limit)`, genai-prices that already covers our models).
3. A provider abstraction (Claude adaptive thinking / forced-tool-choice quirks, Gemini thought signatures, parallel tool execution, compaction and overflow errors).
