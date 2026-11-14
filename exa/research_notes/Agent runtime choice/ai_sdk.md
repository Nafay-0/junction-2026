# Vercel AI SDK as the agent runtime (checked 13-14 Nov 2026)

Sources: npm registry (`npm view`), package tarballs read in the scratchpad (`ai@7.0.172`, `@ai-sdk/anthropic@4.0.104`,
`@ai-sdk/google@4.0.120`, `@ai-sdk/react@4.0.176`, `@ai-sdk/anthropic-aws@2.0.97`, `@anthropic-ai/aws-sdk@1.1.2`), and
https://ai-sdk.dev/llms.txt (the full docs, 5.5 MB). "Unverified" means this pass did not confirm it in the docs or the source.

## Verdict

| Area | Rating | Why |
|---|---|---|
| Model switching | Ready | Plain model objects or `createProviderRegistry`, chosen per request. |
| Claude Platform on AWS | Ready (needs a smoke test) | There is an official `@ai-sdk/anthropic-aws` provider (API key or SigV4, workspace header). Its auth header differs from the official client's, so test it in the first hour. |
| Gemini | Ready | `@ai-sdk/google`. Gemini 3.x ids are in the types; `thinkingConfig.thinkingLevel` is supported. The env var name differs from ours. |
| Usage | Ready | `usage` per step and `totalUsage` per run, with cache-read, cache-write and reasoning details. `messageMetadata` sends them to the UI. |
| Cost | Needs glue code | The SDK has no dollar-cost function. Add a small price table, or use `tokenlens@1.3.1`. |
| Context overflow | Needs glue code | `prepareStep` + `pruneMessages` is the documented compaction pattern. Anthropic `contextManagement`/`compaction` are provider options. There is no automatic retry when the context is too long. |
| Streaming rich UI | Ready | Typed `tool-<name>` parts with states, `data-*` parts, `createUIMessageStream`, preliminary results. |
| Clarifying questions / approval | Ready | `needsApproval` + `addToolApprovalResponse`; client tools + `addToolOutput` + `sendAutomaticallyWhen`. |
| Subagents | Ready | Documented: a tool's `execute` runs a `ToolLoopAgent`, as an async generator yielding preliminary results, with `toModelOutput`. |

## 1. Versions (npm `latest`)
- `ai` 7.0.172; `@ai-sdk/anthropic` 4.0.104; `@ai-sdk/google` 4.0.120; `@ai-sdk/react` 4.0.176; `@ai-sdk/anthropic-aws` 2.0.97 (created 2026-05-20, depends on `@ai-sdk/anthropic` 4.0.104).
- **AI SDK 7 is the current major.** v6 and v5 are maintenance tags (`ai-v6` 6.0.331, `ai-v5` 5.0.289). A v7 migration guide exists (https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0). v7 changes we hit: ESM only; `stepCountIs` is now `isStepCount` (the old name stays as an alias); `createGoogleGenerativeAI` is now `createGoogle` (alias kept). Most tutorials online are for v5 or v6, so check names against the v7 docs.

## 2. Claude Platform on AWS
**What the official client `@anthropic-ai/aws-sdk@1.1.2` does** (read in `src/client.ts` and `src/core/auth.ts`):
- Base URL: `opts.baseURL ?? ANTHROPIC_AWS_BASE_URL ?? https://aws-external-anthropic.${region}.api.aws`. The region comes from `awsRegion`, `AWS_REGION`, `AWS_DEFAULT_REGION` or `~/.aws/config`. The client adds `/v1/messages` itself.
- API key: `apiKey` arg, else `ANTHROPIC_AWS_API_KEY`. It is sent as **`Authorization: Bearer <key>`** (base `@anthropic-ai/sdk` 1.x `apiKeyAuth`). It deliberately ignores `ANTHROPIC_API_KEY`.
- Workspace: `workspaceId` arg, else `ANTHROPIC_AWS_WORKSPACE_ID`. It is required and sent as the **`anthropic-workspace-id`** header on every request.
- SigV4 is used when there is no API key: `@smithy/signature-v4`, service `aws-external-anthropic`, credentials from the args, `awsProfile` or the default AWS chain. It signs the final request in middleware (host header added, `connection` header not signed).

**Official AI SDK provider: `@ai-sdk/anthropic-aws`** (https://ai-sdk.dev/providers/ai-sdk-providers/anthropic-aws). It wraps `@ai-sdk/anthropic`, so it inherits every Anthropic option.
```ts
import { createAnthropicAws } from '@ai-sdk/anthropic-aws';
const claude = createAnthropicAws({
  region: process.env.AWS_REGION,                       // required, no default
  workspaceId: process.env.ANTHROPIC_AWS_WORKSPACE_ID,  // sent as anthropic-workspace-id
  apiKey: process.env.ANTHROPIC_AWS_API_KEY,            // takes precedence over SigV4
});                                                     // default baseURL https://aws-external-anthropic.{region}.api.aws/v1
const model = claude('claude-opus-5-5');
```
**Header mismatch to test first.** The provider docs say `apiKey` is sent as `x-api-key`, and `x-api-key` appears in the provider's dist. The official client sends `Authorization: Bearer`. If the gateway rejects `x-api-key`, use plain `@ai-sdk/anthropic` instead:
```ts
import { createAnthropic } from '@ai-sdk/anthropic';
const claude = createAnthropic({
  baseURL: `https://aws-external-anthropic.${process.env.AWS_REGION}.api.aws/v1`,
  authToken: process.env.ANTHROPIC_AWS_API_KEY,   // sent as Authorization: Bearer (do not also set apiKey)
  headers: { 'anthropic-workspace-id': process.env.ANTHROPIC_AWS_WORKSPACE_ID! },
});
```
The `createAnthropic` path supports API-key auth only; SigV4 needs `@ai-sdk/anthropic-aws` or a custom `fetch`. The AI Gateway (`providerOptions.gateway.order: ['claudeaws']`) is a third option, but it needs a Vercel key and does not use our workspace.

**Newest-model constraints in `@ai-sdk/anthropic@4.0.104`** (read in dist):
- The model-id union includes `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2` (and `claude-fable-5-1`).
- Budget thinking (`thinking.type 'enabled'`) on models that reject it becomes `{type:'adaptive'}`, with a warning.
- `thinking: disabled` on always-adaptive models (Opus 5.5 / Fable 5.x) is removed, with a warning.
- Forced `toolChoice 'required'` becomes `'auto'` with a warning on models that reject it.
- `effort` (`low` to `max`) and `taskBudget` are mapped to `output_config`.
- `thinking` options: `adaptive` (with `display: 'omitted' | 'summarized' | 'updates'`), `enabled` (with `budgetTokens`), `disabled`, `between_tools`.
- Options are passed as `providerOptions: { anthropic: { effort: 'high', thinking: { type: 'adaptive', display: 'summarized' }, cacheControl, contextManagement, compaction, disableParallelToolUse, anthropicBeta: [...] } }`.
- Open GitHub issues: not checked (out of tool budget).

## 3. Gemini
```ts
import { createGoogle } from '@ai-sdk/google';
const gemini = createGoogle({ apiKey: process.env.GOOGLE_API_KEY }); // default env is GOOGLE_GENERATIVE_AI_API_KEY
streamText({ model: gemini('gemini-3.5-flash'), tools, providerOptions: {
  google: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } } } });
```
- Model ids in the types include `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-2.5-pro`/`-flash` (list truncated).
- `thinkingConfig`: `thinkingLevel` (`minimal` to `xhigh`), `thinkingBudget`, `includeThoughts`.
- Tool calling with streaming uses the same `streamText` API as Claude.

## 4. Agent loop
- `new ToolLoopAgent({ model, instructions, tools, stopWhen: isStepCount(20), prepareStep })`, then `agent.stream({ messages, abortSignal })`, or `createAgentUIStreamResponse`. `Experimental_Agent` is now an alias of `ToolLoopAgent`.
- The same loop is available as `streamText({ model, tools, stopWhen, prepareStep, abortSignal, timeout })`.
- Stop conditions: `isStepCount`, `hasToolCall`, `isLoopFinished`.
- `prepareStep({ stepNumber, messages, steps })` can return `model`, `messages`, `activeTools`, `toolChoice`, `providerOptions`.
- When the model emits several tool calls in one step, their `execute` functions run concurrently.
- `abortSignal` is passed to every tool's `execute(input, { abortSignal })`.
- Docs: https://ai-sdk.dev/docs/agents/loop-control

## 5. Per-request model switching
- Use `createProviderRegistry({ anthropic: claude, google: gemini })` and `registry.languageModel('anthropic:claude-opus-5-5')`, or a plain map from the UI value to a model object. Send the choice in the `useChat` request `body`.
- Replaying history from one provider to another is only partly verified:
  - Reasoning parts carry provider metadata (Anthropic signatures, Gemini thought signatures). The other provider ignores or drops them.
  - When switching to Anthropic, use `sendReasoning: false`, or strip reasoning parts in `prepareStep`.
  - Tool call ids are SDK-normalised, so they survive.
  - Test a mid-conversation switch early.

## 6. Usage and cost
- `LanguageModelUsage` = `inputTokens`, `inputTokenDetails{noCacheTokens, cacheReadTokens, cacheWriteTokens}`, `outputTokens`, `outputTokenDetails{textTokens, reasoningTokens}`, `totalTokens`.
- Per step: `onStepFinish` / `step.usage`. Per run: `totalUsage`.
- Sending usage to the UI: `toUIMessageStream({ messageMetadata: ({ part }) => part.type === 'finish' ? { usage: part.totalUsage, model } : undefined })`, typed as the 2nd generic of `InferAgentUIMessage` (https://ai-sdk.dev/cookbook/next/track-agent-token-usage).
- The SDK has no dollar-cost helper (only the AI Gateway reports cost). Use `tokenlens` 1.3.1 (models.dev data), or a 4-row price table, which is simpler and safer for brand-new model ids.

## 7. Context management and overflow
- Documented pattern (https://ai-sdk.dev/cookbook/guides/agent-context-compaction): `prepareStep: ({ messages }) => ({ messages: pruneMessages({ messages, reasoning: 'before-last-message', toolCalls: 'before-last-5-messages' }) })`, triggered by token count. Returned messages persist to later steps.
- There is no built-in summariser and no automatic recovery from a context-length error. The error surfaces as an `APICallError`; catch it, compact, and retry.
- Anthropic server-side features through `providerOptions.anthropic`:
  - `contextManagement.edits` (`clear_tool_uses_20250919`, `compact_20260112`, ...)
  - `compaction: { type: 'summarize' }`
  - `cacheControl` (also per message part)
  - `anthropicBeta`
  - The beta headers (`context-management-2025-06-27`, `compact-2026-09-04`, ...) are added automatically.

## 8. Streaming rich UI
- Tool parts are typed `tool-<name>`, with states `input-streaming` → `input-available` → `output-available` | `output-error`, plus `approval-requested` / `approval-responded` / `output-denied`.
- Custom `data-<name>` parts are written with `writer.write({ type: 'data-map', id, data })`; reusing an `id` updates the part in place. `transient: true` sends a part to the client without saving it to message history.
- `createUIMessageStream({ execute: ({ writer }) => writer.merge(result.toUIMessageStream()) })` + `createUIMessageStreamResponse`.
- An `async function*` tool `execute` yields preliminary results. Reasoning arrives as `reasoning` parts.
```ts
// app/api/chat/route.ts
export const maxDuration = 300;
export async function POST(req: Request) {
  const { messages, modelId } = await req.json();
  const result = streamText({ model: pick(modelId), messages: await convertToModelMessages(messages),
    tools: { searchPlaces }, stopWhen: isStepCount(15), abortSignal: req.signal });
  return result.toUIMessageStreamResponse({ messageMetadata: ({ part }) => part.type==='finish' ? { usage: part.totalUsage } : undefined });
}
// client
{m.parts.map(p => p.type === 'tool-searchPlaces'
  ? (p.state === 'output-available' ? <MapWidget data={p.output}/> : <Skeleton label="Searching places"/>)
  : p.type === 'text' ? <Markdown>{p.text}</Markdown> : null)}
```

## 9. Human in the loop
- Approval: set `needsApproval: true` (or a function) on a tool, or `toolApproval` on the agent. The part reaches `approval-requested`, the client calls `addToolApprovalResponse({ id, approved, reason })`, and `useChat({ sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })` resumes the run (https://ai-sdk.dev/docs/agents/tool-approvals).
- Clarifying question: a tool with no `execute` (e.g. `askUser`) renders a form. Submit it with `addToolOutput({ tool:'askUser', toolCallId, output })` and set `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` (https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage).

## 10. Subagents (https://ai-sdk.dev/docs/agents/subagents)
```ts
const research = tool({ inputSchema: z.object({ task: z.string() }),
  async *execute({ task }, { abortSignal }) {
    const r = await subAgent.stream({ prompt: task, abortSignal });
    for await (const msg of readUIMessageStream({ stream: r.toUIMessageStream() })) yield msg; // preliminary
  },
  toModelOutput: ({ output }) => ({ type: 'text', value: lastText(output) }) }); // parent sees a summary only
```

## 11. Deployment
- The docs use `export const maxDuration = 30 / 60 / 300 / 600` in route handlers.
- Use the Node runtime, not edge: the AWS SigV4 deps, `@smithy/*` and long runs need Node. Fluid compute allows long durations.
- The exact Vercel plan limits for Nov 2026 were not checked. Set `maxDuration = 300` (or higher on Pro) and confirm on the deploy. For a local demo this does not matter.
- WorkflowAgent (durable) exists, but it is overkill here.

## Top 3 risks
1. The Claude Platform on AWS auth header (`x-api-key` in the AI SDK provider vs `Bearer` in the official client), plus the account prerequisites (outbound web identity federation must be enabled). Smoke-test it first.
2. v7 is new, and most examples online are v5/v6 (renamed APIs, ESM only). Agents writing code from memory will get names wrong.
3. Cross-provider history replay (reasoning signatures) and new model ids missing from price data.

## Top 3 things it saves us from writing
1. The multi-step tool loop with parallel tools, abort, stop conditions and per-step model/tool switching.
2. The streaming protocol and typed client state for text, reasoning, tool states, data parts, approvals and client-side tools (`useChat`).
3. Provider adapters that already know the Claude 5.x constraints (adaptive thinking, effort, forced `tool_choice`, beta headers), and Gemini thinking.
