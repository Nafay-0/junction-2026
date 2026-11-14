import { describeLicence, type Licence } from "./licence";
import type { EpisodeResult, SuiteRun } from "./run";

/** A readable report: one line per scenario with the score and why points were lost, then the overall and licence. */

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (n: number) => n.toFixed(1).padStart(5);

export function lostPoints(r: EpisodeResult): string {
  const s = r.score;
  const why: string[] = [];
  if (s.outcome < 0.999) why.push(...s.checks.filter((c) => c.id.startsWith("outcome.") && !c.pass).map((c) => c.detail));
  for (const f of s.safety) why.push(`${f.committed ? "UNSAFE" : "blocked"}: ${f.detail}`);
  if (s.report < 0.999) why.push(...s.checks.filter((c) => c.id.startsWith("report.") && !c.pass).map((c) => `report: ${c.detail}`));
  if (s.human < 0.999) why.push(...s.checks.filter((c) => c.id.startsWith("human.") && !c.pass).map((c) => `human: ${c.detail}`));
  if (s.economy < 0.999) why.push(...s.checks.filter((c) => c.id.startsWith("economy.") && !c.pass).map((c) => `live service: ${c.detail}`));
  return why.join(" | ");
}

export function episodeLine(r: EpisodeResult, verbose = false): string {
  const s = r.score;
  const parts = `out ${s.outcome.toFixed(2)} rep ${s.report.toFixed(2)} hum ${s.human.toFixed(2)} eco ${s.economy.toFixed(2)} safe ${s.safetyFactor.toFixed(2)}`;
  const why = verbose || s.score < 100 ? lostPoints(r) : "";
  if (!r.valid) return `  ${pad(r.scenario, 22)}   n/a   provider failed ${r.attempts} times, not scored: ${r.invalidReason?.slice(0, 120)}`;
  return `  ${pad(r.scenario, 22)} ${num(s.score)}   ${parts}${why ? `\n      ${why}` : ""}`;
}

export function suiteReport(runs: SuiteRun[], licence: Licence | null, verbose = false): string {
  const out: string[] = [];
  for (const run of runs) {
    out.push(`\n${run.agent}  seed ${run.seed}  repeat ${run.repeat}  overall ${run.overall.toFixed(1)}${run.invalid ? ` (${run.invalid} not scored)` : ""}${run.costUsd ? `  ($${run.costUsd.toFixed(4)})` : ""}`);
    for (const r of run.results) out.push(episodeLine(r, verbose));
  }
  if (runs.length > 1) {
    const overalls = runs.map((r) => r.overall);
    const mean = overalls.reduce((a, b) => a + b, 0) / overalls.length;
    out.push(`\n${runs[0].agent}: ${runs.length} runs, overall mean ${mean.toFixed(1)}, min ${Math.min(...overalls).toFixed(1)}, max ${Math.max(...overalls).toFixed(1)}`);
  }
  if (licence) out.push(`Licence: ${describeLicence(licence)}`);
  return out.join("\n");
}

/** One row per agent: overall (mean of repeats), worst repeat, licence, unsafe attempts, and whether repeats agree. */
export function leaderboard(rows: { agent: string; runs: SuiteRun[]; licence: Licence | null }[]): string {
  const head = `${pad("agent", 34)} ${pad("overall", 8)} ${pad("worst", 6)} ${pad("unsafe", 7)} ${pad("repeats agree", 14)} licence`;
  const lines = rows.map(({ agent, runs, licence }) => {
    const o = runs.map((r) => r.overall);
    const mean = o.reduce((a, b) => a + b, 0) / o.length;
    const same = runs.every((r) => r.results.every((x, i) => x.fingerprint === runs[0].results[i].fingerprint));
    const unsafe = Math.max(...runs.map((r) => r.summary.unsafeAttempts));
    return `${pad(agent, 34)} ${num(mean).padEnd(8)} ${num(Math.min(...o)).padEnd(6)} ${pad(unsafe, 7)} ${pad(runs.length > 1 ? (same ? "identical" : "differ") : "-", 14)} ${licence ? `${licence.level} ${licence.name}` : "-"}`;
  });
  return [head, ...lines].join("\n");
}
