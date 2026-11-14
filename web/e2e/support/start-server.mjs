#!/usr/bin/env node
/**
 * Start a hermetic production Dock for the browser suite: `next start` from the existing `.next` build, with an
 * environment this script controls completely, so a laptop run is the same as a CI run.
 *
 *   - `__NEXT_PROCESSED_ENV=true` stops Next reading `.env*`; `web/.env.local` (shared secrets) never reaches it.
 *   - every variable name in `.env.example` is set to "" unless set below or by E2E_SERVER_ENV.
 *   - seed catalogue, no model, no partner, no Aiven, no voice, no radar polling; demo passcode `e2e-ops`.
 *
 * Usage: node e2e/support/start-server.mjs <port>     (Playwright's webServer runs it; see playwright.config.ts)
 * Extra variables: E2E_SERVER_ENV='{"DOCK_RATE_LIMITS":"on"}'. A server you start yourself: E2E_BASE_URL instead.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.argv[2] ?? process.env.E2E_PORT ?? "4601";

export const E2E_OPS_PASSCODE = "e2e-ops";

const env = {};
for (const k of ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "LANG", "PNPM_HOME", "NODE_PATH", "CI"]) if (process.env[k]) env[k] = process.env[k];
for (const line of readFileSync(path.join(web, ".env.example"), "utf8").split("\n")) {
  const m = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
  if (m) env[m[1]] = "";
}
for (const k of ["CONTEXT_DEV_API_KEY", "EXA_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENSEARCH_URI", "CLOUDINARY_URL"]) env[k] = "";
Object.assign(env, {
  __NEXT_PROCESSED_ENV: "true",
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DOCK_CATALOG: "seed",
  DOCK_LLM: "off",
  DOCK_VOICE: "off",
  RADAR_POLL: "off",
  RADAR_STATE_FILE: "off",
  DOCK_RATE_LIMITS: "off",
  DOCK_OPS_PASSCODE: E2E_OPS_PASSCODE,
  DOCK_CONNECTOR_SECRET: "e2e-connector-secret-not-a-real-one-0123456789",
  DOCK_GIT_COMMIT: "e2e",
  DOCK_LICENCES_FILE: path.join(web, ".data/e2e-licences.json"),
});
if (process.env.E2E_SERVER_ENV) Object.assign(env, JSON.parse(process.env.E2E_SERVER_ENV));

const child = spawn(path.join(web, "node_modules/.bin/next"), ["start", "-p", String(port)], { cwd: web, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
