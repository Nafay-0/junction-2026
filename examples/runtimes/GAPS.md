# What the runtimes showed up in the gate

Found while building and running the buyers in this folder (2026-11-13/14, seed catalogue, demo kitchen mandate).
Each item says what happened, where, and the smallest change that would fix it.

**Status (14 Nov, branch `claude/integrate`):** 1 fixed (`answerUrl`, a one-time answer page, channel `answer_link`;
relayed answers stay "relayed, unverified"); 2 fixed in the core, so REST too (`POST /api/v1/orders` with only
`requestId`; refusal `no_current_quote` says why when there is none); 3 fixed (`x-dock-human-input`, tags and
`x-dock-audience: approver`, `?audience=agent`); 4 fixed (`nextStep` and `waitingFor` on every REST intake, quote and
order reply; examples hold placeholders, never a pre-filled answer); 5 fixed (`need.deliverOn`, an exact day held by
the gate); 6 fixed (output schemas published shallow: tools/list 129 KB -> 30 KB, output schemas 109 KB -> 11 KB).

## 1. On clients that cannot elicit, the gate cannot tell a buyer's answer from the model's

**Seen with:** OpenAI Agents SDK (no elicitation support at all), Google ADK (2025-11-25 handshake), LangGraph
(`langchain-mcp-adapters` pins `mcp<2`, so 2025-11-25), Semantic Kernel over REST. Only Pydantic AI, the Claude Agent
SDK and the Vercel AI SDK reach MCP 2026-07-28 and let Dock ask the buyer itself.

On every other path `respond_to_concerns` / `answer_questions` (REST `/concerns`, `/answers`) accept whatever `by`
and `choice` the agent sends. In a Semantic Kernel development run, gpt-6-luna called `respondToConcerns` with
`by: "buyer"` before asking anyone; only the runtime-side filter in the example stopped it (and the gate would have
refused the invented choice id `keep_requested_quantity` anyway, but not a plain `"confirm"`). The examples hold the
line with each runtime's approval step; an agent built without one would confirm the 1,000 L itself and the ledger
would record it as the buyer's answer.

**Smallest fix:** when the client cannot elicit (`human.canAsk` false, and always over REST), put a one-time
`answerUrl` on `needs_confirmation` / `needs_input` steps (the same token-in-link mechanism as approval links) and
tell the agent to show it to the buyer; keep accepting relayed answers, but write them to the ledger as
`relayed, unverified` (the entry already carries `relayedBy`). Larger alternative: serve 2025-era `tools/call`
statefully (session id + SSE response stream) so `elicitation/create` can be pushed to the clients that support it
on 2025-11-25 (ADK and LangGraph do).

## 2. The model has to copy a 1 KB signed quote token into `place_order`

**Seen with:** OpenAI Agents SDK + gpt-6-luna: in five runs, three met `quote_signature_invalid` /
`quote_malformed` and two of those never placed the order (five to six mangled copies each, fresh quotes in between,
$0.06-0.10 spent instead of $0.01). Google ADK + gemini-3.1-flash-lite and Vercel AI SDK + gpt-6-luna each mangled it
once in development and then copied it right. Claude Haiku 5.5 copied it every time.

Small models truncate or alter long opaque strings. The gate does the right thing (refuses, rule `quote_signature`),
but the buyer pays in retries, live lookups and sometimes the whole order.

**Smallest fix:** in `place_order`, make `quoteToken` and `lines` optional when `requestId` names an intake in state
`quoted`, and take both from the quote the intake already holds (or accept the short `quoteId`). The JWS stays in the
result for anyone who wants to verify it; the model no longer has to transcribe it.

## 3. The OpenAPI document does not say which operations need a person, and offers approver operations to agents

**Seen with:** Semantic Kernel (any OpenAPI-to-tools converter behaves the same).

- MCP marks the two human-input tools with `_meta["dock/humanInput"]`; `/api/v1/openapi.json` has no equivalent on
  `respondToConcerns` and `answerQuestions`, so the example names them by operationId (its only Dock-specific line).
  **Fix:** add `x-dock-human-input: true` (same content as the MCP `_meta`) to those two operations.
- The same document lists `decideApproval`, `approvalChallenge`, `approvalLink`, `beginJoin`, `completeJoin`,
  `approverDemoOrder`, `sandboxDemoOrder`, `listSandboxes`. A converter that loads every operation offers a buyer agent
  a tool to approve orders. The approval calls are refused without the approver's link token, passkey or session, but
  they invite the attempt and cost tokens. The example keeps only operations whose `security` is the mandate. **Fix:** tag them (for example
  `tags: ["approver"]` plus `x-dock-audience: "approver"`) or serve an agent-only view (`/api/v1/openapi.json?audience=agent`).

## 4. REST intake steps carry less guidance than MCP's

**Seen with:** Semantic Kernel. With gpt-5-mini (development run), at `quoted` it told the buyer four times that it
needed a sign-off before it could place the order, and never placed it. With gpt-6-luna (the recorded run,
`transcripts/semantic-kernel-openapi.txt`) it said the same, called the valid quote expired, and opened a second
intake before ordering. The MCP result for the same step says
"Placing it will ask Jari Mäkelä (owner) to sign off on their own device"; the REST step has only
`next: { method, path, example }`, no `nextStep` sentence and no `waitingFor`.

Also, `next.example` for `needs_confirmation` pre-fills `choice` with the first correction (`use_100_L`): an agent
that copies the example, as it is told to do for `place_order`, silently turns 1,000 L into 100 L.

**Fix:** add the same `nextStep` and `waitingFor` the MCP tools compute (`nextStepForIntake`, `waitingFor` in
`server/mcp/next-step.ts`) to the REST intake responses, and make the concern example a placeholder
(`"choice": "<confirm or a correction id, from the buyer>"`).

## 5. "Delivery on Monday" can only be said as "by Monday"

**Seen with:** every runtime; most visibly OpenAI Agents SDK + gpt-6-luna, which asked the buyer three times whether
a Saturday delivery was acceptable before going on. The need has only `deliverBy`; all three options deliver on the
earliest day (Saturday 14 November). A kitchen asking for Monday usually means Monday.

**Fix:** an optional `deliverOn` in the need (exact day), used to pick the delivery date of each option, falling back
to `deliverBy` behaviour when absent.

## 6. The tools' output schemas are twelve times their input schemas, and some runtimes send them to the model

**Seen with:** Google ADK, which passes each MCP tool's `outputSchema` to Gemini as the function's
`response_json_schema`. `tools/list` carries 118 KB of output schemas against 10 KB of input schemas and 6 KB of
descriptions, so every ADK request starts at about 50,000 prompt tokens (other runtimes: about 12,000-16,000), and
the ADK run costs five to seven times the others on a model with similar prices.

**Smallest fix:** publish the output schemas with shared definitions (`$defs` + `$ref`; zod's `toJSONSchema` with
`reused: "ref"`) and without the field descriptions the input side already explains, or publish a shallow output
schema (`ok`, `step.state`, `nextStep`, `error`) and keep the full shapes in the OpenAPI document.

## 7. Runtime behaviours the gate should keep in mind (no change needed)

- **Server `instructions` rarely reach the model.** Only Pydantic AI has an option to forward them, off by default.
  Dock's guidance survives because tool descriptions and every result's `nextStep` repeat it. Keep it that way.
- **Refusals (`isError` with `structuredContent`) are handled unevenly.** Pydantic AI's default raises `ModelRetry`
  (the model reads "retry" and the run aborts on the second refusal by one tool); Semantic Kernel drops 4xx bodies
  entirely. OpenAI Agents, ADK, LangGraph and the AI SDK pass the text through. Because Dock repeats the JSON as
  text content, the clients that ignore `structuredContent` still see `code`, `rule` and `nextStep`.
- **"Waiting for sign-off, do not retry" was obeyed.** No runtime placed an order again after `pending_approval`;
  when the scripted buyer kept talking, the AI SDK buyer called `get_order` instead.
- **Custom headers were never a problem** for these SDKs. They matter for hosted connectors (ChatGPT, claude.ai,
  OpenAI's hosted MCP tool, which also needs a public URL); that is what the URL-only connector credential on
  `claude/connector` is for.
- **The human-input marker is Dock's own.** MCP has no standard annotation for "needs a person", so every example
  that routes those tools through an approval step reads `_meta["dock/humanInput"]` (the Claude Agent SDK does not
  expose tool `_meta`, so that example sends one plain `tools/list`).

## Design note: waiting hours for a sign-off

Today the buyer agent stops when `place_order` returns `pending_approval`; the gate holds the order, the approver
decides on their phone, and anyone can follow up with `get_order`. What the runtimes offer for pausing and resuming,
from their current documentation:

| Runtime | Pause/resume mechanism | Survives a restart? |
|---|---|---|
| Pydantic AI 2.68 | Deferred tools: a run ends with `DeferredToolRequests`; store the conversation and resume with `DeferredToolResults`. Durable execution through Temporal, DBOS, Prefect, Restate and others. | Yes, if you store the conversation or use a durable engine |
| OpenAI Agents SDK 0.24 | `result.interruptions` + `RunState.to_json()` / `from_json()`; Temporal and DBOS integrations. | Yes, with stored RunState |
| Google ADK 2.14 | `LongRunningFunctionTool` + `ResumabilityConfig` + `DatabaseSessionService` (best effort, at-least-once; tool confirmation is not supported with the database session service). | Partly |
| Claude Agent SDK 0.3 | Session resume by id (local JSONL, cleaned after 30 days); `PreToolUse` hook can `defer` a call (`stop_reason: tool_deferred`) and resume later. | Yes, on the same machine or with a session store |
| LangGraph 1.2 | `interrupt()` + a Postgres or SQLite checkpointer; resume with the same `thread_id`, hours or days later. | Yes |
| Vercel AI SDK 7 | `WorkflowAgent` (`@ai-sdk/workflow`, Workflow DevKit 5): durable steps, `createHook` / `createWebhook`, `sleep("1d")`. Outside Vercel: Local World (development) or Postgres World (reference implementation, routes unauthenticated). | Yes, with a Workflow world |

All of these pause the agent **before one of its own tool calls runs**, for the agent's human to approve it. Dock's
sign-off has a different shape: the tool call has already run, the order exists, and a different person decides on
the gate. The state that matters (the order, the approval, the ledger) already lives in the gate and survives
restarts; the agent has nothing worth keeping while it waits. A durable runtime would add two things only: resuming
the agent automatically when the decision lands, and keeping its conversation across a restart.

Recommendation: keep the current design. If the agent must act on the decision (tell the kitchen, or re-plan after a
decline), have the gate push the decision (it already streams `/api/v1/events`) and resume the agent from its stored
messages; a `WorkflowAgent` with a hook keyed by `orderId` is the natural fit on the AI SDK if durability is needed in
production, but it adds a workflow backend for no visible gain in the demo.
