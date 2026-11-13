import { canonicalJson, sha256Hex } from "@/core/util";
import { Aliaser } from "./alias";
import { InfraError, type AgentRunInfo, type CrashAgent, type Harness } from "./agents/types";
import { CrashEnv, TOOL_SPECS } from "./env";
import { licenceFor, type Licence, type SuiteResult } from "./licence";
import { SUITE, SUITE_VERSION } from "./scenarios";
import { scoreRun } from "./score";
import type { RunRecord, Scenario, ScoreBreakdown, Topic } from "./types";

/**
 * Running: one episode (agent x scenario x seed x repeat) is isolated in its own CrashEnv; a suite run is the
 * thirteen scenarios for one agent, seed and repeat. Results are plain JSON in the documented trajectory format.
 */

export const TRAJECTORY_SCHEMA = "dock-crash-trajectory/1";

export type Trajectory = {
  schema: typeof TRAJECTORY_SCHEMA;
  suite: string;
  scenario: { id: string; version: number; title: string; decision: string };
  seed: number;
  repeat: number;
  agent: { name: string; kind: CrashAgent["kind"]; model: string | null };
  /** What the agent was given before its first call. */
  observation: { briefing: string; task: string; structuredTask: unknown; tools: { name: string; description: string; inputSchema: unknown }[] };
  /** Tool calls with their results, scripted events, faults, human exchanges and gate decisions, in order. */
  steps: RunRecord["steps"];
  /** Dock's hash-chained audit trail for the episode, and whether it verified. */
  ledger: { verified: boolean; entries: unknown[] };
  facts: Omit<RunRecord, "steps">;
  score: ScoreBreakdown;
  /** Model runs only: the runner's transcript (model turns, tokens, cost), aliased like the rest. */
  agentInfo: AgentRunInfo | null;
  /** sha256 of this object without repeat, agentInfo and fingerprint: equal for equal behaviour on the same world. */
  fingerprint: string;
};

export type EpisodeResult = {
  scenario: string;
  seed: number;
  repeat: number;
  agent: string;
  score: ScoreBreakdown;
  fingerprint: string;
  trajectory: Trajectory;
  costUsd: number | null;
  /** False when the model provider kept failing: the episode says nothing about the agent and is not scored. */
  valid: boolean;
  invalidReason?: string;
  attempts: number;
};

export type RunOptions = { timeoutMs?: number; infraRetries?: number; retryDelayMs?: number };

/** Run one episode; when the provider fails (not the agent), start again on a fresh world. */
export async function runEpisode(agent: CrashAgent, scenario: Scenario, seed: number, repeat: number, opts: RunOptions = {}): Promise<EpisodeResult> {
  const retries = opts.infraRetries ?? 3;
  let last: EpisodeResult | undefined;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    last = await attemptEpisode(agent, scenario, seed, repeat, opts, attempt);
    if (last.valid) return last;
    if (attempt <= retries) await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 15_000) * attempt));
  }
  return last!;
}

async function attemptEpisode(agent: CrashAgent, scenario: Scenario, seed: number, repeat: number, opts: RunOptions, attempt: number): Promise<EpisodeResult> {
  const env = await CrashEnv.create(scenario, seed);
  const harness: Harness = {
    start: env.built.world.start,
    recordIntake: (p, asked, answer) => env.recordIntake(p, asked, answer),
    noteAnsweredForHuman: (n) => env.noteAnsweredForHuman(n),
    reportFromText: (r) => env.reportFromText(r),
    orderIds: async () => (await env.record()).orders.map((o) => o.orderId),
    intakeAnswer: (p) => {
      const topic = p.kind === "questions" ? "product" : intakeTopic(p.codes);
      if (!env.built.human.intakeRefuses?.includes(topic)) return { refuse: false };
      return { refuse: true, text: env.built.human.answer(topic, p.messages.join(" "), { asked: [] }).text };
    },
  };
  let info: AgentRunInfo | null = null;
  let infra: string | undefined;
  try {
    const timeout = opts.timeoutMs ?? (agent.kind === "model" ? 300_000 : 30_000);
    let timer: NodeJS.Timeout | undefined;
    const out = await Promise.race([agent.run(env, harness), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`agent timed out after ${timeout} ms`)), timeout)))]).finally(() => clearTimeout(timer));
    info = out ?? null;
    env.agentReturned();
  } catch (err) {
    if (err instanceof InfraError) infra = err.message;
    env.fail(err);
  }
  const record = await env.record();
  const score = scoreRun(env.built, record, env.outcomeContext());
  const trajectory = buildTrajectory(agent, scenario, seed, repeat, env, record, score, info);
  return { scenario: scenario.id, seed, repeat, agent: agent.name, score: trajectory.score, fingerprint: trajectory.fingerprint, trajectory, costUsd: info?.costUsd ?? null, valid: !infra, invalidReason: infra, attempts: attempt };
}

/** What a Dock intake concern is about, as a buyer topic. */
function intakeTopic(codes: string[]): Topic {
  if (codes.some((c) => c.startsWith("delivery_"))) return "delivery";
  if (codes.some((c) => c.startsWith("quantity_") || c.startsWith("unit_"))) return "quantity";
  if (codes.some((c) => c === "contradicts_preference")) return "product";
  return "other";
}

function buildTrajectory(agent: CrashAgent, scenario: Scenario, seed: number, repeat: number, env: CrashEnv, record: RunRecord, score: ScoreBreakdown, info: AgentRunInfo | null): Trajectory {
  const alias = new Aliaser();
  const { steps, ...facts } = record;
  const body = {
    schema: TRAJECTORY_SCHEMA,
    suite: SUITE_VERSION,
    scenario: { id: scenario.id, version: scenario.version, title: scenario.title, decision: scenario.decision },
    seed,
    repeat,
    agent: { name: agent.name, kind: agent.kind, model: info?.model ?? null },
    observation: { briefing: env.briefing, task: env.task.text, structuredTask: env.task.structured, tools: TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
    steps: alias.value(steps),
    ledger: { verified: env.ledgerVerified(), entries: alias.value(env.ledgerEntries()) },
    facts: alias.value(facts),
    score: alias.value(score),
  };
  const { repeat: _r, ...behaviour } = body; // the repeat number is the only thing that should differ between repeats
  void _r;
  const fingerprint = sha256Hex(canonicalJson(behaviour)).slice(0, 16);
  return { ...(body as Omit<Trajectory, "agentInfo" | "fingerprint">), agentInfo: info && alias.value(info), fingerprint };
}

export type SuiteRun = {
  agent: string;
  seed: number;
  repeat: number;
  overall: number;
  results: EpisodeResult[];
  /** Episodes the provider kept failing; left out of `overall`. A suite with any is not licensed. */
  invalid: number;
  summary: SuiteResult;
  costUsd: number;
};

/** Run scenarios for one agent, seed and repeat. `concurrency` episodes at a time (they share nothing). */
export async function runSuite(agent: CrashAgent, opts: { seed: number; repeat: number; scenarios?: Scenario[]; concurrency?: number; onEpisode?: (r: EpisodeResult) => void } & RunOptions): Promise<SuiteRun> {
  const scenarios = opts.scenarios ?? SUITE;
  const results: EpisodeResult[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    while (next < scenarios.length) {
      const i = next++;
      results[i] = await runEpisode(agent, scenarios[i], opts.seed, opts.repeat, opts);
      opts.onEpisode?.(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, worker));
  return suiteFromResults(agent.name, opts.seed, opts.repeat, results);
}

/**
 * A suite run from its episode results, in suite order. runSuite uses it; so does the Modal fan-out
 * (scripts/crash-collect.ts), which runs every episode in its own container and assembles them here.
 */
export function suiteFromResults(agent: string, seed: number, repeat: number, results: EpisodeResult[]): SuiteRun {
  const valid = results.filter((r) => r.valid);
  const scores = valid.map((r) => r.score.score);
  const overall = scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : 0;
  const findings = valid.flatMap((r) => r.score.safety);
  return {
    agent,
    seed,
    repeat,
    overall,
    results,
    invalid: results.length - valid.length,
    summary: { overall, scenarioScores: scores, unsafeAttempts: findings.length, committedUnsafe: findings.filter((f) => f.committed).length },
    costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
  };
}

/** A licence needs the full suite; partial runs get none. */
export function licenceOf(runs: SuiteRun[]): Licence | null {
  if (!runs.length || runs.some((r) => r.results.length !== SUITE.length || r.invalid > 0)) return null;
  return licenceFor(runs.map((r) => r.summary));
}
