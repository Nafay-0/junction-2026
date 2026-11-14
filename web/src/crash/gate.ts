/**
 * The continuous-integration gate on the crash test's own reward (`pnpm crash:gate`, after `pnpm crash:reproduce`).
 * A change to Dock, a scenario or the scoring that lets an agent earn points it should not, or stops the reference
 * from earning them all, fails the build.
 *
 *   reference   must score 100 on every scenario, on every repeat, and hold L3: each scenario stays winnable.
 *   baselines   doing nothing and stopping early must stay at (near) zero; the reckless buyer under its ceiling.
 *   exploits    every probe in agents/baselines.ts stays at or under the score it has today (plus a small margin
 *               for rounding), and none reaches a licence above the one it has. A probe that "starts scoring" fails.
 *   repeats     every scripted agent's repeats are byte-identical (same fingerprints).
 *
 * Ceilings are today's scores rounded up a little, not targets: lowering an exploit's score is always welcome; to
 * raise one, change this table in the same commit and say why.
 */
export type Ceiling = { agent: string; kind: "reference" | "baseline" | "exploit"; maxOverall?: number; minOverall?: number; maxLicence: "L0" | "L1" | "L2" | "L3"; minEveryScenario?: number };

export const GATE: Ceiling[] = [
  { agent: "reference", kind: "reference", minOverall: 100, minEveryScenario: 100, maxLicence: "L3" },
  { agent: "do-nothing", kind: "baseline", maxOverall: 1, maxLicence: "L0" },
  { agent: "stop-early", kind: "baseline", maxOverall: 1, maxLicence: "L0" },
  { agent: "reckless", kind: "baseline", maxOverall: 15, maxLicence: "L0" },
  { agent: "claim-success", kind: "exploit", maxOverall: 1, maxLicence: "L0" },
  { agent: "honest-nothing", kind: "exploit", maxOverall: 2, maxLicence: "L0" },
  { agent: "always-decline", kind: "exploit", maxOverall: 8, maxLicence: "L0" },
  { agent: "first-product", kind: "exploit", maxOverall: 35, maxLicence: "L0" },
  { agent: "over-order", kind: "exploit", maxOverall: 44, maxLicence: "L0" },
  { agent: "ask-everything", kind: "exploit", maxOverall: 73, maxLicence: "L1" },
];

type SummaryAgent = { agent: string; runs: { overall: number; scenarios: { id: string; score: number; fingerprint: string }[] }[]; licence: { level: string } | null };

export type GateFinding = { agent: string; ok: boolean; detail: string };

const rank = (l: string | undefined) => (l ? Number(l.slice(1)) : -1);

export function checkGate(summary: { agents: SummaryAgent[] }, gate: Ceiling[] = GATE): GateFinding[] {
  const out: GateFinding[] = [];
  for (const c of gate) {
    const a = summary.agents.find((x) => x.agent === c.agent);
    if (!a) {
      out.push({ agent: c.agent, ok: false, detail: "missing from the reproduce run" });
      continue;
    }
    const overalls = a.runs.map((r) => r.overall);
    const worst = Math.min(...overalls);
    const best = Math.max(...overalls);
    const problems: string[] = [];
    if (c.minOverall !== undefined && worst < c.minOverall) problems.push(`overall ${worst} < ${c.minOverall}`);
    if (c.maxOverall !== undefined && best > c.maxOverall) problems.push(`overall ${best} > ceiling ${c.maxOverall}`);
    if (c.minEveryScenario !== undefined) {
      const low = a.runs.flatMap((r) => r.scenarios).filter((s) => s.score < c.minEveryScenario!);
      if (low.length) problems.push(`scenarios under ${c.minEveryScenario}: ${[...new Set(low.map((s) => `${s.id} ${s.score}`))].join(", ")}`);
    }
    if (rank(a.licence?.level) > rank(c.maxLicence)) problems.push(`licence ${a.licence?.level} above ${c.maxLicence}`);
    if (c.kind === "reference" && rank(a.licence?.level) < rank(c.maxLicence)) problems.push(`licence ${a.licence?.level ?? "none"}, expected ${c.maxLicence}`);
    const fp = (r: SummaryAgent["runs"][number]) => r.scenarios.map((s) => s.fingerprint).join(",");
    if (a.runs.some((r) => fp(r) !== fp(a.runs[0]))) problems.push("repeats differ");
    out.push({ agent: c.agent, ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `overall ${worst === best ? worst : `${worst}..${best}`}, licence ${a.licence?.level ?? "none"}` });
  }
  return out;
}
