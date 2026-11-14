#!/usr/bin/env node
/**
 * The operations copilot's database user on dock-pg: create it (once), apply infra/copilot.sql, and put its
 * connection string into web/.env.local as DOCK_COPILOT_PG_URL. Free: a service user, not a service.
 *
 *   node infra/copilot-user.mjs            create if absent, (re)apply the grants, check what it can and cannot do
 *   node infra/copilot-user.mjs --check    only the check
 *
 * Reads AIVEN_API_TOKEN, AIVEN_PROJECT and DATABASE_URL (avnadmin, to apply the grants) from web/.env.local.
 * Prints no secrets. The check proves: it can read telemetry.ops_events; it cannot write, cannot read the raw
 * telemetry table, the app's schema or partner data; statements stop at 3 s.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../web/.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const require = createRequire(resolve(here, "../web/package.json"));
const { Client } = require("pg");

const USER = "dock_copilot";
const SERVICE = process.env.AIVEN_PG_SERVICE ?? "dock-pg";
const CHECK_ONLY = process.argv.includes("--check");
const must = (k) => {
  const v = process.env[k]?.trim();
  if (!v) {
    console.error(`${k} is not set`);
    process.exit(1);
  }
  return v;
};

async function api(method, path, body) {
  const r = await fetch(`https://api.aiven.io/v1/project/${must("AIVEN_PROJECT")}/service/${SERVICE}${path}`, {
    method,
    headers: { authorization: `aivenv1 ${must("AIVEN_API_TOKEN")}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const lib = (url) => {
  const u = new URL(url);
  u.searchParams.set("uselibpqcompat", "true");
  return u.toString();
};

async function ensureUser() {
  if (process.env.DOCK_COPILOT_PG_URL?.trim()) return;
  let user;
  try {
    user = (await api("GET", `/user/${USER}?include_secrets=true`)).user;
  } catch {
    user = (await api("POST", "/user", { username: USER })).user;
    console.log(`created service user ${USER} on ${SERVICE}`);
  }
  if (!user?.password) throw new Error("the API did not return the new user's password");
  const base = new URL(must("DATABASE_URL"));
  base.username = USER;
  base.password = encodeURIComponent(user.password);
  const real = realpathSync(envFile);
  let txt = readFileSync(real, "utf8");
  if (!txt.endsWith("\n")) txt += "\n";
  writeFileSync(real, `${txt}DOCK_COPILOT_PG_URL=${base.toString()}\n`);
  process.env.DOCK_COPILOT_PG_URL = base.toString();
  console.log("wrote DOCK_COPILOT_PG_URL to web/.env.local");
}

async function applyGrants() {
  const c = new Client({ connectionString: lib(must("DATABASE_URL")), application_name: "copilot-user" });
  await c.connect();
  try {
    await c.query(readFileSync(resolve(here, "copilot.sql"), "utf8"));
    console.log("applied infra/copilot.sql");
  } finally {
    await c.end();
  }
}

async function check() {
  const c = new Client({ connectionString: lib(must("DOCK_COPILOT_PG_URL")), application_name: "copilot-check" });
  await c.connect();
  const expect = async (label, sql, wantOk) => {
    try {
      await c.query(sql);
      console.log(`${wantOk ? "PASS" : "FAIL"} ${label}: allowed`);
      return wantOk;
    } catch (err) {
      console.log(`${wantOk ? "FAIL" : "PASS"} ${label}: refused (${String(err.message).slice(0, 80)})`);
      return !wantOk;
    }
  };
  const results = [
    await expect("read telemetry.ops_events", "select count(*) from telemetry.ops_events", true),
    await expect("write telemetry.events", "insert into telemetry.events (source, kind) values ('copilot', 'x')", false),
    await expect("read raw telemetry.events", "select attrs from telemetry.events limit 1", false),
    await expect("read the app schema", "select count(*) from dock.docs", false),
    await expect("read partner data", "select count(*) from partner_data.catalog_index", false),
    await expect("create a table", "create table telemetry.x (a int)", false),
    await expect("run longer than 3 s", "select pg_sleep(4)", false),
  ];
  await c.end();
  const ok = results.every(Boolean);
  console.log(ok ? "copilot user: every check as expected" : "copilot user: SOME CHECKS FAILED");
  if (!ok) process.exit(1);
}

if (!CHECK_ONLY) {
  await ensureUser();
  await applyGrants();
}
await check();
