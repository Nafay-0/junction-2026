// Smoke test for the model providers. Run from exa/web: node scripts/smoke.mjs
// Reads keys from exa/.env.local. Prints results and timings, never the keys.
import { generateText, streamText, tool, isStepCount } from "ai";
import { createAnthropicAws } from "@ai-sdk/anthropic-aws";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { z } from "zod";

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const env = process.env;

const timed = async (label, fn) => {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`OK   ${label} (${Date.now() - t0}ms): ${out}`);
    return true;
  } catch (err) {
    const status = err?.statusCode ?? err?.status ?? "";
    console.log(`FAIL ${label} (${Date.now() - t0}ms): ${status} ${String(err?.message ?? err).slice(0, 300)}`);
    return false;
  }
};

const aws = createAnthropicAws({
  region: env.AWS_REGION,
  workspaceId: env.ANTHROPIC_AWS_WORKSPACE_ID,
  apiKey: env.ANTHROPIC_AWS_API_KEY,
});
const bearer = createAnthropic({
  baseURL: `https://aws-external-anthropic.${env.AWS_REGION}.api.aws/v1`,
  authToken: env.ANTHROPIC_AWS_API_KEY,
  headers: { "anthropic-workspace-id": env.ANTHROPIC_AWS_WORKSPACE_ID },
});
const google = createGoogle({ apiKey: env.GOOGLE_API_KEY });

const which = process.argv[2] ?? "all";
const say = async (model) => {
  const r = await generateText({ model, prompt: "Reply with exactly: ready", maxOutputTokens: 200 });
  return `${JSON.stringify(r.text.slice(0, 40))} in=${r.usage.inputTokens} out=${r.usage.outputTokens}`;
};

if (which === "all" || which === "claude") {
  const viaProvider = await timed("claude-haiku-5-5 via @ai-sdk/anthropic-aws (x-api-key)", () => say(aws("claude-haiku-5-5")));
  if (!viaProvider) await timed("claude-haiku-5-5 via createAnthropic (Bearer + workspace header)", () => say(bearer("claude-haiku-5-5")));
}
if (which === "all" || which === "models") {
  const claude = process.argv[3] === "bearer" ? bearer : aws;
  for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]) await timed(id, () => say(claude(id)));
}
if (which === "all" || which === "gemini") {
  for (const id of ["gemini-flash-latest", "gemini-3.8-flash", "gemini-pro-latest"]) await timed(id, () => say(google(id)));
}
if (which === "all" || which === "tools") {
  const claude = process.argv[3] === "bearer" ? bearer : aws;
  const tools = {
    getWeather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, tempC: city.length, sky: "clear" }),
    }),
  };
  for (const [label, model] of [["claude-opus-5-5", claude("claude-opus-5-5")], ["gemini-3.8-flash", google("gemini-3.8-flash")]]) {
    await timed(`tool loop + stream on ${label}`, async () => {
      const t0 = Date.now();
      let first = 0;
      const result = streamText({
        model,
        tools,
        stopWhen: isStepCount(4),
        prompt: "What is the weather in Espoo and in Helsinki? Call the tool for both cities at once, then answer in one sentence.",
      });
      let text = "";
      for await (const d of result.textStream) {
        if (!first) first = Date.now() - t0;
        text += d;
      }
      const steps = await result.steps;
      const usage = await result.totalUsage;
      const calls = steps.map((s) => s.toolCalls.length).join("+");
      return `steps=${steps.length} toolCallsPerStep=${calls} firstText=${first}ms in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.inputTokenDetails?.cacheReadTokens ?? 0} text=${JSON.stringify(text.slice(0, 90))}`;
    });
  }
}
