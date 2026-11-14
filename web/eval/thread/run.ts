/**
 * Buyer-experience eval for the store: the same scenarios through today's store flows (`legacy`) or the agent
 * thread (`thread`), over HTTP against a running server (build it for production first; never against a dev
 * server if you want the timings to mean anything).
 *
 *   pnpm tsx eval/thread/run.ts --url http://localhost:4521 --driver legacy
 *   pnpm tsx eval/thread/run.ts --url http://localhost:4521 --driver thread --only partner-en,followup-second
 *   pnpm tsx eval/thread/run.ts --url ... --driver thread --repeat 2 --out eval/thread/results/after.json
 *   pnpm tsx eval/thread/run.ts --list                 the scenarios, no server needed
 *   pnpm tsx eval/thread/run.ts --merge a.json,b.json --out all.json [--recheck --url ...]   runs as one report
 *
 * Per scenario it records: pass/fail against the expected end state (scenarios.ts), the buyer's actions after the
 * first message (taps + typed turns; the "manual corrections" the partner's rubric counts), and milliseconds from
 * the first submit to each milestone:
 *   first_sign   legacy: first response byte of the first call; thread: the first `step` event of the agent turn
 *   understood   legacy: the interpret reply; thread: the `understood` card
 *   options      options with live prices on screen (intake step with options / `options` card)
 *   placed       order committed or waiting for sign-off (order reply / `gate` placed_alone|waiting, `order` card)
 *   answered     a records answer (assistant panel reply / `records` card)
 *   total        the scenario's last reply
 * The buyer is a script: there is no think time between a reply and the next tap, in either driver.
 *
 * Model spend: every scenario reads at least one request with the configured model. The server counts it against
 * its daily limits (server/limits.ts); the run prints the spend the server reports (/api/health demoLimits) before
 * and after. Orders left waiting for sign-off are withdrawn after each scenario so the next one does not see a
 * duplicate. The interpret cache answers the same words for the same kitchen on the same day for free: restart the
 * server between repeats when the timings of the model reading matter (each reply's `cached` flag is recorded).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runLegacy, type RunResult } from "./legacy";
import { Browser, Catalogue, MILESTONES, quantile, signInAs, type Milestone } from "./lib";
import { SCENARIOS, type Scenario } from "./scenarios";
import { runThread } from "./thread";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

type Row = {
  id: string;
  title: string;
  tag: string;
  kitchen: string;
  lang: string;
  repeat: number;
  pass: boolean;
  checks: { name: string; ok: boolean; why?: string }[];
  corrections: number;
  actions: RunResult["actions"];
  ms: Partial<Record<Milestone, number>>;
  serverMarks?: Record<string, unknown>;
  streamed?: boolean;
  cached: boolean[];
  calls: number;
  limitation?: string;
  outcome: RunResult["outcome"];
  error?: string;
};

async function main() {
  if (args.includes("--list")) {
    for (const s of SCENARIOS) console.log(`${s.id.padEnd(18)} ${s.kitchen.padEnd(7)} ${s.lang}  ${s.goal.padEnd(7)} ${s.title}`);
    return;
  }
  const url = opt("--url");
  if (opt("--merge")) return merge(opt("--merge")!.split(","), opt("--out"), args.includes("--recheck") ? url : undefined);
  const driver = opt("--driver") ?? "legacy";
  if (!url || (driver !== "legacy" && driver !== "thread")) {
    console.error("usage: pnpm tsx eval/thread/run.ts --url http://localhost:PORT --driver legacy|thread [--only id,...] [--repeat N] [--out file.json]");
    process.exit(2);
  }
  const only = opt("--only")?.split(",").map((s) => s.trim());
  const repeat = Math.max(1, Number(opt("--repeat") ?? 1));
  const out = opt("--out");
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  if (only && scenarios.length !== only.length) console.error(`unknown scenario id(s): ${only.filter((i) => !SCENARIOS.some((s) => s.id === i)).join(", ")}`);

  const health = async () => (await new Browser(url).get("/api/health")).body?.demoLimits?.llm;
  const before = await health();
  const startedAt = new Date().toISOString();
  console.log(`driver ${driver} against ${url}; ${scenarios.length} scenarios x ${repeat}; model spend so far today ${before ? `$${before.usd} in ${before.calls} calls` : "unknown"}\n`);

  const rows: Row[] = [];
  for (let r = 1; r <= repeat; r++) {
    for (const sc of scenarios) {
      const row = await runOne(url, driver, sc, r);
      rows.push(row);
      const t = (m: Milestone) => (row.ms[m] === undefined ? "    -" : `${(row.ms[m]! / 1000).toFixed(1).padStart(5)}`);
      console.log(`${row.pass ? "PASS" : "FAIL"} ${sc.id.padEnd(18)} corr ${String(row.corrections).padStart(2)}  sign ${t("first_sign")} und ${t("understood")} opt ${t("options")} placed ${t("placed")} ans ${t("answered")} total ${t("total")}`);
      for (const c of row.checks.filter((x) => !x.ok)) console.log(`       x ${c.name}: ${c.why}`);
      if (row.error) console.log(`       ! ${row.error}`);
      if (row.actions.list.length) console.log(`       buyer: ${row.actions.list.join(" | ")}`);
    }
  }
  const after = await health();

  const summary = summarise(rows);
  console.log(`\n${summary.passed}/${summary.runs} passed. Corrections per run: median ${summary.corrections.median}, mean ${summary.corrections.mean}.`);
  for (const m of MILESTONES) {
    const s = summary.milestones[m];
    if (s.n) console.log(`  ${m.padEnd(11)} n=${String(s.n).padStart(2)}  median ${fmt(s.median)}  p90 ${fmt(s.p90)}`);
  }
  if (before && after) console.log(`model spend this run (server's count): $${(after.usd - before.usd).toFixed(4)} in ${after.calls - before.calls} calls`);

  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ driver, url, startedAt, finishedAt: new Date().toISOString(), repeat, spend: before && after ? { usd: Math.round((after.usd - before.usd) * 10_000) / 10_000, calls: after.calls - before.calls } : null, summary, rows }, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
}

async function runOne(url: string, driver: string, sc: Scenario, repeat: number): Promise<Row> {
  const base = { id: sc.id, title: sc.title, tag: sc.tag, kitchen: sc.kitchen, lang: sc.lang, repeat, limitation: sc.limitation };
  let res: RunResult;
  try {
    res = driver === "thread" ? await runThread(url, sc) : await runLegacy(url, sc);
  } catch (err) {
    return { ...base, pass: false, checks: [], corrections: 0, actions: { taps: 0, typed: 0, extraTyped: 0, list: [] }, ms: {}, cached: [], calls: 0, outcome: undefined as never, error: (err as Error).stack?.slice(0, 600) };
  }
  const checks = await evaluate(url, sc, res.outcome);
  const a = res.actions;
  const errors = res.outcome.notices.filter((n) => n.kind === "error").map((n) => n.message);
  return {
    ...(errors.length ? { error: errors.join("; ") } : {}),
    ...base,
    pass: checks.every((c) => c.ok),
    checks,
    corrections: a.taps + a.typed + a.extraTyped,
    actions: a,
    ms: res.marks.at,
    serverMarks: res.serverMarks,
    streamed: res.streamed,
    cached: res.cached,
    calls: res.calls,
    outcome: res.outcome,
  };
}

/** The scenario's expected end state, checked against what the driver saw. Reads master data and the kitchen's history
 * through the store's own read routes (no live calls, no model). */
async function evaluate(url: string, sc: Scenario, outcome: RunResult["outcome"]): Promise<Row["checks"]> {
  const b = new Browser(url);
  await signInAs(b, sc.kitchen);
  const overview = (await b.get(`/ui-api/kitchens/${sc.kitchen}/portal`)).body;
  const ctx = { catalogue: new Catalogue(b, sc.kitchen), today: helsinkiToday(), kitchen: sc.kitchen, overview, lang: sc.lang };
  const checks: Row["checks"] = [];
  for (const c of sc.expect) {
    try {
      const r = await c.run(outcome, ctx);
      checks.push(r === true ? { name: c.name, ok: true } : { name: c.name, ok: false, why: r });
    } catch (err) {
      checks.push({ name: c.name, ok: false, why: `check threw: ${(err as Error).message}` });
    }
  }
  return checks;
}

/** Several result files as one (e.g. two runs on fresh servers); with --recheck --url, the checks are run again on the saved outcomes. */
async function merge(files: string[], out: string | undefined, recheckUrl: string | undefined) {
  const docs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const rows: Row[] = docs.flatMap((d, i) => (d.rows as Row[]).map((r) => ({ ...r, repeat: i + 1 })));
  if (recheckUrl)
    for (const r of rows) {
      const sc = SCENARIOS.find((s) => s.id === r.id);
      if (!sc || !r.outcome) continue;
      r.checks = await evaluate(recheckUrl, sc, r.outcome);
      r.pass = r.checks.every((c) => c.ok);
    }
  const summary = summarise(rows);
  console.log(`${summary.passed}/${summary.runs} passed over ${files.length} file(s).`);
  for (const m of MILESTONES) {
    const x = summary.milestones[m];
    if (x.n) console.log(`  ${m.padEnd(11)} n=${String(x.n).padStart(2)}  median ${fmt(x.median)}  p90 ${fmt(x.p90)}`);
  }
  const spend = docs.reduce((s, d) => ({ usd: s.usd + (d.spend?.usd ?? 0), calls: s.calls + (d.spend?.calls ?? 0) }), { usd: 0, calls: 0 });
  if (out) {
    writeFileSync(out, `${JSON.stringify({ driver: docs[0]?.driver, url: docs[0]?.url, merged: files, runs: docs.map((d) => ({ startedAt: d.startedAt, finishedAt: d.finishedAt, spend: d.spend })), spend, summary, rows }, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
}

function summarise(rows: Row[]) {
  const milestones = Object.fromEntries(
    MILESTONES.map((m) => {
      const xs = rows.map((r) => r.ms[m]).filter((x): x is number => typeof x === "number");
      return [m, { n: xs.length, median: quantile(xs, 0.5), p90: quantile(xs, 0.9) }];
    }),
  ) as Record<Milestone, { n: number; median: number | null; p90: number | null }>;
  const corr = rows.map((r) => r.corrections);
  const byScenario = Object.fromEntries(
    [...new Set(rows.map((r) => r.id))].map((id) => {
      const rs = rows.filter((r) => r.id === id);
      return [id, { runs: rs.length, passed: rs.filter((r) => r.pass).length, corrections: rs.map((r) => r.corrections), taps: rs.map((r) => r.actions.taps), typed: rs.map((r) => r.actions.typed + r.actions.extraTyped) }];
    }),
  );
  return {
    runs: rows.length,
    passed: rows.filter((r) => r.pass).length,
    corrections: { median: quantile(corr, 0.5), mean: corr.length ? Math.round((corr.reduce((s, x) => s + x, 0) / corr.length) * 100) / 100 : null, total: corr.reduce((s, x) => s + x, 0) },
    milestones,
    byScenario,
  };
}

const fmt = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(2)} s`);

function helsinkiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

void main();
