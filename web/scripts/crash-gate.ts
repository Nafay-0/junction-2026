/**
 * The crash test's CI gate: read `pnpm crash:reproduce`'s summary and fail when the reference drops, a baseline
 * rises above its ceiling, or an exploit probe starts scoring (src/crash/gate.ts).
 *
 *   pnpm crash:reproduce && pnpm crash:gate [crash-results/reproduce/summary.json] [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "@/core/util";
import { checkGate, GATE } from "@/crash/gate";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const file = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "crash-results/reproduce/summary.json";
const summary = JSON.parse(readFileSync(file, "utf8"));
const findings = checkGate(summary);
for (const f of findings) console.log(`${f.ok ? "ok  " : "FAIL"} ${f.agent.padEnd(16)} ${f.detail}`);
const failed = findings.filter((f) => !f.ok);
const digest = sha256Hex(canonicalJson(summary)).slice(0, 16);
console.log(failed.length ? `\nCrash-test gate FAILED: ${failed.map((f) => f.agent).join(", ")}.` : `\nCrash-test gate passed: ${findings.length} checks. Summary digest ${digest}.`);
if (opt("json")) writeFileSync(opt("json")!, JSON.stringify({ schema: "dock-crash-gate/1", suite: summary.suite, digest, passed: !failed.length, ceilings: GATE, findings }, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
