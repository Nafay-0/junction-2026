#!/usr/bin/env node
/**
 * Start a hermetic production Dock for the browser suite: `next start` from the existing `.next` build, with an
 * environment this script controls completely, so a laptop run is the same as a CI run.
 *
 *   - `__NEXT_PROCESSED_ENV=true` stops Next reading `.env*`; `web/.env.local` (shared secrets) never reaches it.
 *   - every variable name in `.env.example` is set to "" unless set below or by E2E_SERVER_ENV.
 *   - seed catalogue, no partner, no Aiven, no radar polling; demo passcode `e2e-ops`.
 *   - models: no provider key at all. The request reader and the store's agent are the scripted provider
 *     (`scripted:e2e`, src/server/agent/scripted.ts) answering from e2e/fixtures/recordings.json, so the thread runs
 *     end to end with zero spend and the same result every time; every other model (photo reader, assistant, memory
 *     writer, second reader, menu planner) has none and says so.
 *   - voice: on, with test-only scripted tokens (DOCK_VOICE_SCRIPTED=1, src/server/channels/voice/live.ts): the
 *     server reserves the line and "mints" a token without Google; the browser's Gemini Live socket is answered by
 *     the test (page.routeWebSocket). The call caps are lifted so a full run never meets them.
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
  // Scripted models only (no key is set, so nothing else can answer): the reader and the agent from recordings.
  DOCK_LLM: "",
  DOCK_LLM_DAILY_CALLS: "1000000",
  DOCK_LLM_DAILY_USD: "1000000", // an estimate only (voice minutes are priced at hang-up); nothing is paid
  DOCK_SCRIPTED_MODELS: "1",
  DOCK_SCRIPTED_RECORDINGS: path.join(web, "e2e/fixtures/recordings.json"),
  DOCK_INTERPRET_MODEL: "scripted:e2e",
  DOCK_AGENT_MODEL: "scripted:e2e",
  DOCK_INTERPRET_FALLBACK_MODEL: "off",
  DOCK_MEMORY_LLM: "off",
  // Voice on, tokens scripted (refused if DOCK_PUBLIC_URL were set), caps lifted for a whole run.
  DOCK_VOICE: "on",
  DOCK_VOICE_SCRIPTED: "1",
  DOCK_VOICE_CALLS_PER_KITCHEN_HOUR: "100",
  DOCK_VOICE_CALLS_PER_HOUR: "1000",
  DOCK_VOICE_CALLS_PER_KITCHEN_DAY: "200",
  DOCK_VOICE_CALLS_PER_DAY: "2000",
  RADAR_POLL: "off",
  // No sample activity (src/server/alive): the browser suite starts from an empty store.
  DOCK_SAMPLE_ACTIVITY: "off",
  RADAR_STATE_FILE: "off",
  DOCK_RATE_LIMITS: "off",
  DOCK_OPS_PASSCODE: E2E_OPS_PASSCODE,
  // The stage kitchens (kaari, laakso) are private to their accounts; these are their test passwords.
  DOCK_KAARI_PASSWORD: "e2e-stage-kaari",
  DOCK_LAAKSO_PASSWORD: "e2e-stage-laakso",
  DOCK_CONNECTOR_SECRET: "e2e-connector-secret-not-a-real-one-0123456789",
  DOCK_GIT_COMMIT: "e2e",
  DOCK_LICENCES_FILE: path.join(web, ".data/e2e-licences.json"),
});
if (process.env.E2E_SERVER_ENV) Object.assign(env, JSON.parse(process.env.E2E_SERVER_ENV));

// E2E_NOW=<ISO time with offset> (opt-in): the server's clock starts there and runs on (e2e/support/fixed-clock.cjs),
// so cut-offs, delivery days and "today" are those of that moment whatever day the suite runs (e2e/README.md).
if (process.env.E2E_NOW) {
  env.DOCK_FAKE_NOW = process.env.E2E_NOW;
  if (process.env.E2E_NOW_OFFSET_MS) env.DOCK_FAKE_OFFSET_MS = process.env.E2E_NOW_OFFSET_MS;
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require ${path.join(web, "e2e/support/fixed-clock.cjs")}`.trim();
}

// E2E_MODEL=1 (opt-in, never in a default run): real models instead of the recordings, with the provider keys and
// model names from web/.env.local (copied into the server's environment, never printed) and a hard cap of $0.50 and
// 60 calls for the run.
if (process.env.E2E_MODEL) {
  Object.assign(env, { DOCK_SCRIPTED_MODELS: "", DOCK_SCRIPTED_RECORDINGS: "", DOCK_VOICE_SCRIPTED: "", DOCK_INTERPRET_MODEL: "", DOCK_AGENT_MODEL: "" });
  const names = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DOCK_INTERPRET_MODEL", "DOCK_ASSISTANT_MODEL", "DOCK_MEMORY_MODEL"];
  try {
    for (const line of readFileSync(path.join(web, ".env.local"), "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && names.includes(m[1])) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch {
    console.error("E2E_MODEL=1 but web/.env.local is not readable: the model stays off.");
  }
  Object.assign(env, { DOCK_LLM: "", DOCK_LLM_DAILY_USD: "0.5", DOCK_LLM_DAILY_CALLS: "60" });
}

const child = spawn(path.join(web, "node_modules/.bin/next"), ["start", "-p", String(port)], { cwd: web, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
