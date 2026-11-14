// End-to-end test of a task that is waiting on the user in the live browser when the desktop app
// is reloaded or closed. Needs the server running.
// Run: pnpm test:waiting [port] [case ...]      cases: approval, reload, handover, left
//
// The live browser is part of the app, so a page does not outlive it. What must hold is that the
// task does: opened again, it is told the page is gone, works its way back, and asks the user
// again for whatever needed them, without anything being approved or sent in between. Each case
// starts the real app (twice, where the app is quit in the middle) on a profile of its own and
// uses the pretend site at /dev/sandbox.html. The cases are described in waiting-cases.cjs.
//
// It takes about ten minutes and costs a few cents in model calls.
// BERYL_TEST_SHOTS=<folder> saves pictures along the way.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const args = process.argv.slice(2);
const port = args.find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const CASES = { approval: ["1", "2"], reload: ["1"], handover: ["1", "2"], left: ["1", "2"] };
const wanted = args.filter((a) => a in CASES);
const cases = wanted.length ? wanted : Object.keys(CASES);

let failed = 0;
for (const name of cases) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `beryl-waiting-${name}-`));
  console.log(`\n${name}`);
  for (const phase of CASES[name]) {
    if (phase === "2") console.log("     the app is closed; opening it again");
    const run = spawnSync(electron, [path.join(here, "waiting-cases.cjs"), port], {
      env: { ...process.env, CASE: name, PHASE: phase, BERYL_WAITING_PROFILE: profile },
      encoding: "utf8",
      timeout: 12 * 60 * 1000,
    });
    const lines = (run.stdout ?? "").split("\n").filter((line) => /^(ok  |FAIL|     )/.test(line));
    console.log(lines.join("\n"));
    if (run.status !== 0) {
      failed += 1;
      if (!lines.some((line) => line.startsWith("FAIL"))) console.log(`FAIL the app ended with ${run.status ?? run.signal}`);
      break;
    }
  }
  fs.rmSync(profile, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} of ${cases.length} cases failed.` : "\nA task that waits on the user survives a reload and a closed app as intended.");
process.exit(failed ? 1 : 0);
