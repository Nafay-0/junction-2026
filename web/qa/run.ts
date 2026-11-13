 
/**
 * Dock QA harness. Re-runs every automated probe against a running server with a fixed seed, checks the global
 * invariants on every response, prints a summary, writes a dated results file and exits non-zero on any
 * invariant violation or failed probe.
 *
 *   pnpm qa                                   # http://localhost:4311 (a server started with DOCK_CATALOG=seed)
 *   pnpm qa --url https://host:port           # any address; or QA_URL=...
 *   pnpm qa --real-url http://localhost:4310  # also run the few probes that need the partner's real catalogue
 *   pnpm qa --only gate,intake                # areas or probe-id prefixes
 *   pnpm qa --seed 7                          # another fixed seed (default 20261113)
 *   pnpm qa --corpus                          # also replay the cached interpreter corpus (paid model calls)
 *   pnpm qa --regen-corpus                    # regenerate the corpus with a model first (see qa/corpus/README.md)
 *   pnpm qa --list                            # list probes and exit
 *
 * The server must be one you run yourself. Never point this at a shared or public deployment: it places
 * orders, joins visitor kitchens and fills the in-memory ledger.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../scripts/lib/env";
loadLocalEnv();

import { Checks } from "./lib/invariants";
import { Http, Recorder } from "./lib/http";
import { AREAS, KINDS, rngFrom, type ProbeCtx } from "./lib/probe";
import { laaksoAgent } from "./lib/actors";
import { allProbes } from "./probes";

type Result = { id: string; area: string; kind: string; title: string; status: "pass" | "fail" | "skip" | "error"; cases: number; failures: string[]; notes: string[]; violations: number; ms: number; findings?: string[]; skip?: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const url = arg("url") ?? process.env.QA_URL ?? "http://localhost:4311";
  const realUrl = arg("real-url") ?? process.env.QA_REAL_URL;
  const seed = Number(arg("seed") ?? process.env.QA_SEED ?? 20261113);
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const probes = (await allProbes({ corpus: !!arg("corpus") || !!arg("regen-corpus"), regen: !!arg("regen-corpus") })).filter(
    (p) => !only || only.some((o) => p.area === o || p.id.startsWith(o)),
  );
  if (arg("list")) {
    for (const p of probes) console.log(`${p.id.padEnd(44)} ${p.area.padEnd(12)} ${p.kind.padEnd(13)} ${p.title}`);
    return;
  }

  const rec = new Recorder();
  const http = new Http(url, rec);
  const ping = await http.get("/api/v1");
  if (ping.status !== 200) {
    console.error(`No Dock at ${url} (GET /api/v1 -> ${ping.status}). Start one: DOCK_CATALOG=seed pnpm start -p 4311`);
    process.exit(2);
  }
  // Do locally minted mandates verify here (same demo org keys)?
  const probeAgent = await laaksoAgent(http);
  const keysMatch = (await probeAgent.post("/api/v1/requests", { text: "qa: key check" })).status === 201;
  const realHttp = realUrl ? new Http(realUrl, rec) : undefined;
  const live = { used: 0, budget: Number(process.env.QA_LIVE_BUDGET ?? 40) };

  console.log(`Dock QA: ${probes.length} probes against ${url}${realUrl ? ` (+ real catalogue at ${realUrl})` : ""}, seed ${seed}, keys ${keysMatch ? "match" : "DO NOT match (mandate probes skipped)"}`);
  const results: Result[] = [];
  for (const p of probes) {
    rec.current = p.id;
    rec.allow5xx.clear();
    rec.allowCodes = new Set();
    const check = new Checks();
    const before = rec.violations.length;
    const t0 = Date.now();
    const ctx: ProbeCtx = { http, rec, check, rng: rngFrom(seed ^ hash(p.id)), seed, realHttp, live, keysMatch };
    let status: Result["status"] = "pass";
    let skip: string | undefined;
    let cases = p.cases ?? 1;
    if (p.needs?.includes("real") && !realHttp) [status, skip] = ["skip", "needs --real-url"];
    else if (p.needs?.includes("keys") && !keysMatch) [status, skip] = ["skip", "demo org keys do not match the server"];
    else {
      try {
        const out = await p.run(ctx);
        if (out?.skip) [status, skip] = ["skip", out.skip];
        if (out?.cases) cases = out.cases;
      } catch (err) {
        status = "error";
        check.failures.push(`probe threw: ${(err as Error).stack?.split("\n").slice(0, 3).join(" | ")}`);
      }
    }
    if (rec.rateLimited) {
      status = "error";
      check.failures.unshift(`the server rate-limited this address ${rec.rateLimited} time(s): start it with DOCK_RATE_LIMITS=off (qa/bin/fresh-server.sh does) for the full run`);
      rec.rateLimited = 0;
    }
    const violations = rec.violations.length - before;
    if (status === "pass" && (check.failures.length || violations)) status = "fail";
    const r: Result = { id: p.id, area: p.area, kind: p.kind, title: p.title, status, cases, failures: check.failures, notes: check.notes, violations, ms: Date.now() - t0, findings: p.findings, skip };
    results.push(r);
    const mark = { pass: "PASS", fail: "FAIL", skip: "skip", error: "ERR " }[status];
    console.log(`${mark} ${p.id} (${r.ms} ms)${skip ? ` - ${skip}` : ""}`);
    for (const f of check.failures) console.log(`       x ${f}`);
    for (const v of rec.violations.slice(before)) console.log(`       ! ${v.invariant}: ${v.detail}`);
    for (const n of check.notes) console.log(`       . ${n}`);
  }

  // Final global check: the ledger still verifies after everything above.
  rec.current = "(final ledger)";
  const final = await http.get("/api/v1/ledger");
  const ledgerOk = final.body?.verification?.ok === true;
  if (!ledgerOk) rec.violations.push({ invariant: "ledger_verifies", probe: "(final)", detail: JSON.stringify(final.body?.verification).slice(0, 300) });

  const by = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of AREAS) matrix[a] = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const r of results) if (r.status !== "skip") matrix[r.area][r.kind] += r.cases;
  const failedFindings = [...new Set(results.filter((r) => r.status === "fail").flatMap((r) => r.findings ?? []))];
  const summary = {
    at: new Date().toISOString(),
    url,
    realUrl,
    seed,
    probes: results.length,
    cases: results.reduce((s, r) => s + (r.status === "skip" ? 0 : r.cases), 0),
    pass: by("pass"),
    fail: by("fail"),
    error: by("error"),
    skip: by("skip"),
    httpCalls: rec.calls.length,
    invariantViolations: rec.violations.length,
    ledgerVerifies: ledgerOk,
    liveLookupsOnRealServer: live.used,
    openFindings: failedFindings,
  };
  console.log("\n" + "-".repeat(72));
  console.log(`probes ${summary.probes}  cases ${summary.cases}  pass ${summary.pass}  fail ${summary.fail}  error ${summary.error}  skip ${summary.skip}`);
  console.log(`http calls ${summary.httpCalls}  invariant violations ${summary.invariantViolations}  ledger ${ledgerOk ? "verifies" : "DOES NOT VERIFY"}  live lookups (real) ${live.used}`);
  if (failedFindings.length) console.log(`findings reproduced: ${failedFindings.join(", ")}`);

  const dir = path.join(process.cwd(), "qa", "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${summary.at.slice(0, 16).replace(/[:T]/g, "-")}-seed${seed}.json`);
  writeFileSync(file, JSON.stringify({ summary, matrix, results, violations: rec.violations }, null, 2));
  console.log(`results: ${path.relative(process.cwd(), file)}`);
  process.exit(summary.fail + summary.error + summary.invariantViolations > 0 ? 1 : 0);
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
