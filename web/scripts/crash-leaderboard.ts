/**
 * The crash-test leaderboard as Markdown, from an export summary (`pnpm crash:export`).
 *
 *   pnpm crash:leaderboard [crash-results/export/summary.json] [--out src/crash/LEADERBOARD.md] [--preamble file.md]
 *
 * One row per agent: rating (mean of repeats), worst repeat, licence, unsafe attempts, questions to the buyer per
 * suite run, seconds per episode, model spend, and every scenario under 70 with the reason from its trajectory's own
 * score. The recommendation for Dock's own agent follows a fixed rule, stated in the output: among models with no
 * unsafe attempt on any repeat, the highest worst repeat; then the fewest questions to the buyer; then speed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { SUITE } from "@/crash/scenarios";

type Agent = {
  agent: string;
  model: string | null;
  harness?: string;
  ratingMean?: number | null;
  overall: number;
  worstRepeat: number;
  repeats: number;
  licence: { level: string; name: string; why: string } | null;
  unsafeAttempts: number;
  invalid: number;
  costUsd: number | null;
  secondsPerEpisode?: number | null;
  questionsPerSuite?: number | null;
  failures?: { scenario: string; repeat: number; score: number; reason: string }[];
};

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const file = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "crash-results/export/summary.json";
const summary = JSON.parse(readFileSync(file, "utf8")) as { suite: string; generatedAt: string; agents: Agent[] };
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toFixed(1));
const usd = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `$${x.toFixed(2)}`);
const isModel = (a: Agent) => a.agent.startsWith("model:") || a.agent.startsWith("featherless:");
const complete = (a: Agent) => !!a.licence && a.invalid === 0;

function failed(a: Agent): string {
  const by = new Map<string, { scores: number[]; reason: string }>();
  for (const f of a.failures ?? []) {
    const e = by.get(f.scenario) ?? { scores: [], reason: f.reason };
    e.scores.push(f.score);
    by.set(f.scenario, e);
  }
  const order = new Map(SUITE.map((s, i) => [s.id, i]));
  return (
    [...by.entries()]
      .sort((x, y) => order.get(x[0])! - order.get(y[0])!)
      .map(([s, e]) => `**${s}** (${e.scores.map((x) => Math.round(x)).join(", ")}${e.scores.length < a.repeats ? `; ${a.repeats - e.scores.length} of ${a.repeats} repeats passed` : ""}): ${e.reason.split(" | ").slice(0, 1).join("").replace(/\|/g, "/")}`)
      .join("<br>") || "none"
  );
}

const rows = [...summary.agents].sort((a, b) => Number(complete(b)) - Number(complete(a)) || b.worstRepeat - a.worstRepeat || (b.ratingMean ?? b.overall) - (a.ratingMean ?? a.overall));
const table = [
  "| Agent | Rating (mean) | Worst repeat | Licence | Unsafe attempts | Questions / suite | Seconds / episode | Model spend (all repeats) | Scenarios under 70, with the reason from the trajectory |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((a) => `| \`${a.agent}\`${a.repeats !== 3 ? ` (${a.repeats} repeat${a.repeats === 1 ? "" : "s"})` : ""} | ${n1(a.ratingMean ?? a.overall)} | ${n1(a.worstRepeat)} | ${a.licence ? `${a.licence.level} ${a.licence.name}` : `none${a.invalid ? ` (${a.invalid} episode(s) unscored: provider failure)` : " (incomplete)"}`} | ${a.unsafeAttempts} | ${n1(a.questionsPerSuite)} | ${n1(a.secondsPerEpisode)} | ${isModel(a) ? (a.agent.startsWith("featherless:") ? "flat subscription" : usd(a.costUsd)) : "-"} | ${failed(a)} |`),
];

const candidates = rows.filter((a) => isModel(a) && complete(a) && a.unsafeAttempts === 0);
candidates.sort((a, b) => b.worstRepeat - a.worstRepeat || (a.questionsPerSuite ?? 99) - (b.questionsPerSuite ?? 99) || (a.secondsPerEpisode ?? 999) - (b.secondsPerEpisode ?? 999));
const pick = candidates[0];
const rec = pick
  ? [
      `**Recommended for Dock's own agent: \`${pick.model}\`** (worst repeat ${n1(pick.worstRepeat)}, mean ${n1(pick.ratingMean)}, ${pick.licence?.level} ${pick.licence?.name}, no unsafe attempt, ${n1(pick.questionsPerSuite)} questions to the buyer per suite, ${n1(pick.secondsPerEpisode)} s per episode).`,
      "",
      "Rule, fixed before reading the table: among models with no unsafe attempt on any repeat and a complete suite, the highest worst repeat; then the fewest questions to the buyer; then speed.",
      "",
      "Next in line: " + candidates.slice(1, 4).map((a) => `\`${a.model}\` (worst ${n1(a.worstRepeat)}, ${n1(a.questionsPerSuite)} questions, ${n1(a.secondsPerEpisode)} s)`).join("; ") + ".",
    ].join("\n")
  : "No model met the rule (complete suite, no unsafe attempt).";

const preamble = opt("preamble") ? readFileSync(opt("preamble")!, "utf8").trim() + "\n\n" : "";
const md = `# Crash-test leaderboard

Suite \`${summary.suite}\` (${SUITE.length} scenarios), seed 1, generated ${summary.generatedAt.slice(0, 10)} at commit \`${commit}\`. Every model ran through Dock's own buyer-agent harness (\`src/server/agent/runner.ts\`) with the crash adapter (\`src/crash/agents/model.ts\`); each episode in its own Modal Sandbox. Rating is the mean of the repeats; the licence is judged on the worst repeat (\`src/crash/licence.ts\`).

${rec}

${preamble}${table.join("\n")}
`;
const out = opt("out");
if (out) writeFileSync(out, md);
else process.stdout.write(md);
