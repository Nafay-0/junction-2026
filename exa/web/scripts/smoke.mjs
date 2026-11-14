// Smoke test for the model providers. Run from exa/web: node scripts/smoke.mjs
// Reads keys from exa/.env.local. Prints results and timings, never the keys.
import { generateText, streamText, tool, isStepCount, Output } from "ai";
import { createAnthropicAws } from "@ai-sdk/anthropic-aws";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { z } from "zod";
// Plain TypeScript with no runtime imports: Node strips the types when it loads them.
import { MODELS } from "../src/lib/agent/models.ts";
import { MODEL_JOBS, modelOptions } from "../src/lib/agent/options.ts";

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
  for (const id of ["gemini-4-carbon", "gemini-4-hydrogen"]) await timed(id, () => say(google(id)));
}
if (which === "all" || which === "decisions") {
  // The decision model behind sift: no words come back, only how likely each answer is. Two pages, two wishes, one request.
  await timed("gemini-decision-1 judges two pages against two wishes", async () => {
    const answers = { yes: "The page says so", no: "The page says otherwise", unknown: "The page does not say" };
    const ask = (page, wish) => ({ type: "choice", instructions: `Look only at Page ${page}. According to that page, is it true that ${wish}?`, criteria: answers });
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_API_KEY },
      body: JSON.stringify({
        model: "gemini-decision-1",
        input: "[Page 1] Lentil soup. Ready in 20 minutes. Lentils, carrots, onion, stock. One pot.\n\n[Page 2] Beef stew. Simmer for three hours. Beef, potatoes, red wine.",
        questions: { p1_quick: ask(1, "the recipe takes 30 minutes or less"), p1_veg: ask(1, "the recipe contains no meat"), p2_quick: ask(2, "the recipe takes 30 minutes or less"), p2_veg: ask(2, "the recipe contains no meat") },
      }),
    });
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? "request failed"), { status: res.status });
    const got = Object.fromEntries(Object.entries(body.answers ?? {}).map(([key, a]) => [key, a.choice]));
    const want = { p1_quick: "yes", p1_veg: "yes", p2_quick: "no", p2_veg: "no" };
    const wrong = Object.keys(want).filter((key) => got[key] !== want[key]);
    if (wrong.length) throw new Error(`unexpected answers for ${wrong.join(", ")}: ${JSON.stringify(got)}`);
    return `${JSON.stringify(got)} in=${body.usage?.total_input_tokens ?? "?"}`;
  });
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
  for (const [label, model] of [["claude-opus-5-5", claude("claude-opus-5-5")], ["gemini-4-carbon", google("gemini-4-carbon")], ["gemini-4-hydrogen", google("gemini-4-hydrogen")]]) {
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

// Every model with the exact options the app sends for each job (src/lib/agent/options.ts).
// A model that rejects a thinking setting fails here, not in front of a user.
// node scripts/smoke.mjs options [model id]
if (which === "all" || which === "options") {
  const only = which === "options" ? process.argv[3] : undefined;
  const runs = [];
  for (const info of MODELS.filter((m) => !only || m.id === only)) {
    const model = info.provider === "claude" ? aws(info.id) : google(info.id);
    for (const job of MODEL_JOBS) {
      const providerOptions = modelOptions(info, job);
      runs.push(
        timed(`${info.id} as ${job} ${JSON.stringify(providerOptions)}`, async () => {
          if (job === "extraction") {
            const r = await generateText({ model, providerOptions, output: Output.object({ schema: z.object({ city: z.string(), country: z.string() }) }), prompt: "Espoo is a city in Finland. Extract the city and the country." });
            return `${JSON.stringify(r.output)} reasoning=${r.usage.outputTokenDetails?.reasoningTokens ?? 0}`;
          }
          const tools = { lookUp: tool({ description: "Look up the population of a city", inputSchema: z.object({ city: z.string() }), execute: async () => ({ population: 320000 }) }) };
          const r = await generateText({ model, providerOptions, tools, stopWhen: isStepCount(3), prompt: "Use the tool to look up the population of Espoo, then answer in one short sentence." });
          return `steps=${r.steps.length} reasoning=${r.totalUsage.outputTokenDetails?.reasoningTokens ?? 0} text=${JSON.stringify(r.text.slice(0, 60))}`;
        }),
      );
    }
  }
  const results = await Promise.all(runs);
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} of ${results.length} option sets were rejected.` : `\nAll ${results.length} option sets were accepted.`);
  if (failed) process.exitCode = 1;
}
