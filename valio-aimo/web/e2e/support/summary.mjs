#!/usr/bin/env node
/**
 * A few lines from Playwright's JSON report: totals per project, then each failure with its first error line.
 *   node e2e/support/summary.mjs [test-results/results.json] [--markdown]
 * CI appends the markdown form to the job summary.
 */
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const md = args.includes("--markdown");
const file = args.find((a) => !a.startsWith("--")) ?? "test-results/results.json";
if (!existsSync(file)) {
  console.log(md ? `No browser report at \`${file}\` (the run stopped before tests started).` : `no report at ${file}`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const perProject = new Map();
const failures = [];
const walk = (suite, titles) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const p = perProject.get(t.projectName) ?? { passed: 0, failed: 0, flaky: 0, skipped: 0 };
      const status = t.status === "expected" ? "passed" : t.status === "unexpected" ? "failed" : t.status === "flaky" ? "flaky" : "skipped";
      p[status]++;
      perProject.set(t.projectName, p);
      if (status === "failed" || status === "flaky") {
        const res = t.results.find((r) => r.error) ?? t.results.at(-1);
        const msg = (res?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) ?? "";
        failures.push({ status, project: t.projectName, where: `${spec.file}:${spec.line}`, title: [...titles, spec.title].join(" > "), msg: msg.slice(0, 220) });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, child.title && !child.title.endsWith(".ts") ? [...titles, child.title] : titles);
};
for (const s of report.suites ?? []) walk(s, []);

const total = [...perProject.values()].reduce((a, p) => ({ passed: a.passed + p.passed, failed: a.failed + p.failed, flaky: a.flaky + p.flaky, skipped: a.skipped + p.skipped }), { passed: 0, failed: 0, flaky: 0, skipped: 0 });
const line = (n, p) => `${n}: ${p.passed} passed, ${p.failed} failed, ${p.flaky} flaky, ${p.skipped} skipped`;
if (md) {
  console.log(`**Browser suite**: ${total.failed ? "FAIL" : "PASS"}. ${line("all", total).replace(/^all: /, "")}\n`);
  console.log("| project | passed | failed | flaky | skipped |\n|---|---|---|---|---|");
  for (const [n, p] of perProject) console.log(`| ${n} | ${p.passed} | ${p.failed} | ${p.flaky} | ${p.skipped} |`);
  if (failures.length) {
    console.log("\n| | project | test | first error line |\n|---|---|---|---|");
    for (const f of failures) console.log(`| ${f.status} | ${f.project} | \`${f.where}\` ${f.title.replace(/\|/g, "/")} | ${f.msg.replace(/\|/g, "/")} |`);
  }
} else {
  console.log(`${total.failed ? "FAIL" : "PASS"}  ${line("all", total)}`);
  for (const [n, p] of perProject) console.log(`  ${line(n, p)}`);
  for (const f of failures) console.log(`  ${f.status.toUpperCase()} [${f.project}] ${f.where} ${f.title}\n      ${f.msg}`);
}
process.exit(0);
