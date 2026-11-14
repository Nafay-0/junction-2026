/**
 * One autonomous buyer-agent run: a model drives Dock through its MCP tools until the order is committed,
 * waits for sign-off, is refused, or the agent gives up. Prints a readable transcript.
 *
 *   pnpm agent "I need 1,000 litres of lactose-free milk by Monday" --model anthropic:claude-haiku-5-5
 *
 *   --model provider:model-id   default DOCK_AGENT_MODEL, else the cheap model of the first provider with a key
 *   --url http://localhost:3000 against a running Dock instead of in-process
 *   --mandate demo|kitchen      whose mandate the agent presents (default demo: Laakso Catering)
 *   --human auto|ask|none       who answers Dock's questions: a stand-in (default), you at the terminal, or nobody
 *   --max-steps N --max-cost USD --max-tokens N --max-seconds N
 *   --reasoning low|medium|...  portable reasoning effort (default: the provider's)
 *   --json file.json            also write the full transcript as JSON
 *
 * Keys come from .env.local and are never printed.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { autoHuman, absentHuman, type Human } from "@/server/agent/human";
import { defaultModel } from "@/server/agent/models";
import { demoCredentials, runBuyerAgent, type RunOptions } from "@/server/agent/runner";
import { formatTranscript } from "@/server/agent/transcript";
import { flag, loadLocalEnv } from "./lib/agent-cli";

const terminalHuman: Human = async (p) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const by = (await rl.question("\n  AimoPilot has a question for the buyer. Your name: ")).trim() || "Buyer";
    if (p.kind === "confirmation") {
      const responses = [];
      for (const c of p.concerns) {
        console.log(`\n  ! ${c.message}`);
        const choices = [...(c.confirmable ? [{ id: "confirm", label: "Yes, that is what I meant" }] : []), ...c.corrections.map((x) => ({ id: x.id, label: x.label }))];
        choices.forEach((x, i) => console.log(`    ${i + 1}) ${x.label}`));
        const n = Number(await rl.question("  choose: ")) || 1;
        responses.push({ key: c.key, choice: choices[Math.min(choices.length, Math.max(1, n)) - 1].id });
      }
      return { by, responses };
    }
    const answers = [];
    for (const q of p.questions) {
      console.log(`\n  ? ${q.text}`);
      q.options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
      const n = Number(await rl.question("  choose: ")) || 1;
      answers.push({ questionId: q.id, optionId: q.options[Math.min(q.options.length, Math.max(1, n)) - 1].id });
    }
    return { by, answers };
  } finally {
    rl.close();
  }
};

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const task = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!task) throw new Error('Usage: pnpm agent "<task>" --model provider:model-id');
  const model = flag(args, "--model") ?? defaultModel("DOCK_AGENT_MODEL");
  if (!model) throw new Error("No model: pass --model provider:model-id or set a provider API key in .env.local.");
  const num = (name: string) => (flag(args, name) === undefined ? undefined : Number(flag(args, name)));
  const humanFlag = flag(args, "--human") ?? "auto";
  const url = flag(args, "--url");
  const opts: RunOptions = {
    model,
    task,
    credentials: await demoCredentials(flag(args, "--mandate") === "kitchen" ? "kitchen" : "demo"),
    human: humanFlag === "ask" ? terminalHuman : humanFlag === "none" ? absentHuman : autoHuman(),
    dock: url ? { baseUrl: url } : undefined,
    reasoning: flag(args, "--reasoning") as RunOptions["reasoning"],
    caps: Object.fromEntries(
      Object.entries({ maxSteps: num("--max-steps"), maxCostUsd: num("--max-cost"), maxTotalTokens: num("--max-tokens"), maxWallMs: num("--max-seconds") && num("--max-seconds")! * 1000 }).filter(([, v]) => v !== undefined),
    ),
    onEvent: (e) => {
      if (e.type === "model") process.stderr.write(`  step ${e.step}: ${e.toolCalls.map((c) => c.name).join(", ") || "(reply)"}\n`);
    },
  };
  console.error(`Running ${model} against ${url ?? "AimoPilot in-process"}...`);
  const result = await runBuyerAgent(opts);
  console.log("\n" + formatTranscript(result));
  const out = flag(args, "--json");
  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`\nTranscript written to ${out}`);
  }
  if (result.outcome === "error") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
