#!/usr/bin/env node
/**
 * Deploy a git ref to the Aiven Runtime app dock-app, wait until it serves, and smoke-test it over HTTPS.
 *
 *   node infra/aiven-deploy.mjs                    deploy origin/main
 *   node infra/aiven-deploy.mjs origin/claude/x    deploy another ref (branch, tag or commit)
 *   node infra/aiven-deploy.mjs --config-only      only bring the app's settings up to date (no new build)
 *   node infra/aiven-deploy.mjs --smoke-only       only run the smoke test against what is live
 *   node infra/aiven-deploy.mjs --dry-run          show what would change, change nothing
 *
 * How: Runtime clones the repo with a read-only deploy key and builds the head of one branch; it cannot pin a
 * commit without the GitHub App. So the script makes a deploy commit on top of the ref that adds only
 * web/.build-info.json (the source commit, shown by /api/health), force-pushes it to the branch deploy/aiven,
 * points the app at that branch, sets the app's environment (below) and redeploys. It then polls /api/health
 * until the new commit answers and runs `pnpm smoke` against the public URL. Exit 0 only on PASS.
 *
 * Settings come from web/.env.local (the shared secrets file) and the constants below. A PUT replaces the
 * whole environment list, so this script is the one place that list is defined. Values are never printed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const web = join(repo, "web");
const ENV_FILE = join(web, ".env.local");
const SERVICE = process.env.AIVEN_APP_SERVICE ?? "dock-app";
const DEPLOY_BRANCH = "deploy/aiven";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const ref = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const dryRun = has("--dry-run");

if (!existsSync(ENV_FILE)) fail(`no ${ENV_FILE}`);
process.loadEnvFile(ENV_FILE);
const env = (k) => (process.env[k]?.trim() ? process.env[k].trim() : undefined);
const token = env("AIVEN_API_TOKEN");
const project = env("AIVEN_PROJECT");
if (!token || !project) fail("AIVEN_API_TOKEN and AIVEN_PROJECT must be set in web/.env.local");

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}
const log = (s = "") => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

async function api(method, path, body) {
  const res = await fetch(`https://api.aiven.io/v1/project/${project}${path}`, {
    method,
    headers: { authorization: `aivenv1 ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ---------- the app's environment ----------

/** Which settings the app gets. `kind: "secret"` values are write-only in the Console and API. */
function desiredEnvironment(publicUrl) {
  const host = new URL(publicUrl).hostname;
  const vars = [
    ["NODE_ENV", "production"],
    // Links, QR codes and passkeys are bound to this host. Keep the app (and so the host name) as it is.
    ["DOCK_PUBLIC_URL", publicUrl],
    ["DOCK_WEBAUTHN_RP_ID", host],
    ["DOCK_WEBAUTHN_ORIGINS", publicUrl],
    ["DOCK_WEBAUTHN_RP_NAME", "Dock"],
    // The partner's real catalogue (index loaded from PostgreSQL at start) and its live price API.
    ["DOCK_CATALOG", "valio"],
    ["VALIO_API_BASE", env("VALIO_API_BASE") ?? "https://junction26.valioaimo.fi"],
    // Public demo caps (web/src/server/limits.ts). DOCK_LLM=off switches model calls off entirely.
    ["DOCK_LLM", env("DOCK_DEPLOY_LLM") ?? "on"],
    ["DOCK_LLM_DAILY_USD", env("DOCK_DEPLOY_LLM_DAILY_USD") ?? "5"],
    ["DOCK_LLM_DAILY_CALLS", env("DOCK_DEPLOY_LLM_DAILY_CALLS") ?? "500"],
    ["DOCK_LIVE_DAILY_CALLS", env("DOCK_DEPLOY_LIVE_DAILY_CALLS") ?? "3000"],
    ["DOCK_TRUSTED_PROXY_HOPS", env("DOCK_DEPLOY_TRUSTED_PROXY_HOPS") ?? "1"],
  ];
  for (const k of ["DOCK_INTERPRET_MODEL", "DOCK_AGENT_MODEL", "VALIO_CUSTOMER"]) if (env(k)) vars.push([k, env(k)]);

  const secrets = [
    // Fixed keys: quotes and receipts stay verifiable across restarts; the demo orgs' keys are not the public dev ones.
    "DOCK_WHOLESALER_JWK",
    "DOCK_DEMO_ORG_JWK",
    "DOCK_DEMO_KITCHEN_JWK",
    "VALIO_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    // Set explicitly: the application_service_credential integrations stay in state "starting" and do not
    // deliver these. PEM values are one line with \n escapes (Runtime values cannot hold newlines).
    "DATABASE_URL",
    "OPENSEARCH_URL",
    "VALKEY_URL",
    "KAFKA_BOOTSTRAP_SERVERS",
    "KAFKA_SECURITY_PROTOCOL",
    "KAFKA_ACCESS_KEY",
    "KAFKA_ACCESS_CERT",
    "KAFKA_CA_CERT",
  ];
  const required = ["DOCK_WHOLESALER_JWK", "DOCK_DEMO_ORG_JWK", "DOCK_DEMO_KITCHEN_JWK", "VALIO_API_KEY", "DATABASE_URL"];
  for (const k of required) if (!env(k)) fail(`${k} is not set in web/.env.local`);
  const out = vars.map(([key, value]) => ({ key, value, kind: "variable" }));
  for (const key of secrets) {
    const v = env(key);
    if (v) out.push({ key, value: v.replace(/\r?\n/g, "\\n"), kind: "secret" });
  }
  for (const e of out) if (e.value.length > 4096) fail(`${e.key} is longer than Runtime's 4096 characters`);
  return out;
}

function diffEnvironment(current, desired) {
  const cur = new Map(current.map((e) => [e.key, e]));
  const des = new Map(desired.map((e) => [e.key, e]));
  const lines = [];
  for (const e of desired) {
    const c = cur.get(e.key);
    lines.push([e.key, e.kind, !c ? "added" : c.value !== e.value || c.kind !== e.kind ? "changed" : "same"]);
  }
  for (const e of current) if (!des.has(e.key)) lines.push([e.key, e.kind, "removed"]);
  return lines;
}

// ---------- deploy commit ----------

function deployCommit(sha) {
  const dir = mkdtempSync(join(tmpdir(), "dock-deploy-"));
  const indexFile = join(dir, "index");
  const genv = { ...process.env, GIT_INDEX_FILE: indexFile };
  const run = (a, input) => execFileSync("git", a, { cwd: repo, env: genv, encoding: "utf8", input }).trim();
  try {
    run(["read-tree", sha]);
    const info = JSON.stringify({ commit: sha, ref, deployedAt: new Date().toISOString() }, null, 2) + "\n";
    const blob = run(["hash-object", "-w", "--stdin"], info);
    run(["update-index", "--add", "--cacheinfo", `100644,${blob},web/.build-info.json`]);
    const tree = run(["write-tree"]);
    return run(["commit-tree", tree, "-p", sha, "-m", `Deploy ${sha.slice(0, 12)} (${ref}) to Aiven Runtime\n\nAdds web/.build-info.json only.`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- waiting and checking ----------

async function health(publicUrl) {
  try {
    const res = await fetch(`${publicUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : { status: `HTTP ${res.status}` };
  } catch (err) {
    return { status: err?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

async function waitForCommit(publicUrl, sha, timeoutMs = 15 * 60_000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    const svc = (await api("GET", `/service/${SERVICE}`)).service;
    const h = await health(publicUrl);
    const live = h.version?.commit ?? "-";
    const line = `build ${svc.metadata?.application_build_status ?? "?"}, deployment ${svc.metadata?.application_deployment_status ?? "?"}, live commit ${String(live).slice(0, 12)}`;
    if (line !== last) log(`  [${Math.round((Date.now() - t0) / 1000)} s] ${line}`);
    last = line;
    if (live === sha) return h;
    if (svc.metadata?.application_build_status === "FAILED") fail("the build failed; see the build log: POST /project/<p>/service/dock-app/logs {\"log_type\":\"application-build\"}");
    await sleep(10_000);
  }
  fail(`commit ${sha.slice(0, 12)} was not serving after ${Math.round(timeoutMs / 60_000)} minutes`);
}

function smoke(publicUrl, sha) {
  log(`\nSmoke test (pnpm smoke) against ${publicUrl}`);
  const r = spawnSync("pnpm", ["-s", "smoke", "--url", publicUrl, ...(sha ? ["--commit", sha] : [])], { cwd: web, stdio: "inherit" });
  return r.status === 0;
}

// ---------- main ----------

const svc = (await api("GET", `/service/${SERVICE}?include_secrets=true`)).service;
const host = svc.components?.find((c) => c.component === "http")?.host;
if (!host) fail(`${SERVICE} has no http component`);
const publicUrl = `https://${host}`;
if (svc.plan !== "startup-50-1024") log(`note: ${SERVICE} is on plan ${svc.plan} (this script never changes plans)`);
log(`${SERVICE}: ${svc.state}, ${publicUrl}`);

if (has("--smoke-only")) process.exit(smoke(publicUrl) ? 0 : 1);

const app = svc.user_config.application;
const desiredEnv = desiredEnvironment(publicUrl);
const changes = diffEnvironment(app.environment_variables ?? [], desiredEnv);
log("\nEnvironment (names only):");
for (const [k, kind, what] of changes) log(`  ${what.padEnd(7)} ${kind.padEnd(8)} ${k}`);
const envChanged = changes.some(([, , w]) => w !== "same");

let sha;
let commit;
if (!has("--config-only")) {
  git("fetch", "--quiet", "origin");
  sha = git("rev-parse", "--verify", `${ref}^{commit}`);
  log(`\nDeploying ${ref} = ${sha} (${git("log", "-1", "--format=%s", sha)})`);
  commit = deployCommit(sha);
  log(`  deploy commit ${commit.slice(0, 12)} -> branch ${DEPLOY_BRANCH}`);
}
const branchChanged = !has("--config-only") && app.source.branch !== DEPLOY_BRANCH;

if (dryRun) {
  log(`\nDry run: ${envChanged ? "environment would change; " : ""}${branchChanged ? `source branch ${app.source.branch} -> ${DEPLOY_BRANCH}; ` : ""}nothing changed.`);
  process.exit(0);
}

if (commit) execFileSync("git", ["push", "--quiet", "--force", "origin", `${commit}:refs/heads/${DEPLOY_BRANCH}`], { cwd: repo, stdio: "inherit" });

if (envChanged || branchChanged) {
  // The whole application object goes back (deploy key included), or the PUT would drop what it omits.
  const next = { ...app, source: { ...app.source, ...(branchChanged ? { branch: DEPLOY_BRANCH } : {}) }, environment_variables: desiredEnv };
  delete next.source.commit_sha;
  await api("PUT", `/service/${SERVICE}`, { user_config: { application: next } });
  log(`\nUpdated ${SERVICE}: ${[envChanged && "environment", branchChanged && `branch ${DEPLOY_BRANCH}`].filter(Boolean).join(", ")}.`);
}

if (!has("--config-only") || envChanged) {
  // A settings change starts a deployment by itself; if none starts within 30 s, ask for one.
  let started = false;
  if (envChanged || branchChanged) {
    for (let i = 0; i < 6 && !started; i++) {
      await sleep(5_000);
      const s = (await api("GET", `/service/${SERVICE}`)).service.metadata?.application_deployment_status;
      started = s !== "COMPLETED";
    }
  }
  if (!started) {
    await api("POST", `/service/${SERVICE}/application/redeploy`);
    log("Redeploy requested.");
  }
}

if (has("--config-only")) {
  log("\nSettings updated. The app restarts with them; run with --smoke-only to check.");
  process.exit(0);
}

log(`\nWaiting for ${sha.slice(0, 12)} to serve at ${publicUrl}/api/health`);
const h = await waitForCommit(publicUrl, sha);
log(`  live: commit ${h.version.commit.slice(0, 12)}, catalogue ${h.catalog.source} (${h.catalog.products} products)`);
const ok = smoke(publicUrl, sha);
log(`\n${ok ? "PASS" : "FAIL"}: ${ref} (${sha.slice(0, 12)}) is live at ${publicUrl}${ok ? " and passed the smoke test" : ", but the smoke test failed"}.`);
process.exit(ok ? 0 : 1);
