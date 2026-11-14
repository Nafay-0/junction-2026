#!/usr/bin/env node
/**
 * Fill web/.env.local with connection settings for the Aiven services, straight from the Aiven API.
 *
 *   node infra/aiven-env.mjs                        OpenSearch, Valkey, Kafka keys
 *   node infra/aiven-env.mjs --include-database-url also rewrite DATABASE_URL from dock-pg
 *   node infra/aiven-env.mjs --env path/to/.env.local
 *
 * Reads AIVEN_API_TOKEN and AIVEN_PROJECT from the same file (or the environment). Edits the file in
 * place: keys it manages are replaced on their own line or appended; every other line is left as is.
 * Prints key names only, never values.
 *
 * Note: the Aiven API returns "<redacted>" for passwords and keys unless the request asks for
 * ?include_secrets=true. A URI copied from a plain API response is therefore not usable.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const ENV = resolve(envIdx >= 0 ? args[envIdx + 1] : resolve(here, "../web/.env.local"));
const includeDb = args.includes("--include-database-url");

if (!existsSync(ENV)) {
  console.error(`no env file at ${ENV}`);
  process.exit(1);
}
process.loadEnvFile(ENV);
const token = process.env.AIVEN_API_TOKEN;
const project = process.env.AIVEN_PROJECT;
if (!token || !project) {
  console.error("AIVEN_API_TOKEN and AIVEN_PROJECT must be set");
  process.exit(1);
}

const SERVICES = {
  pg: process.env.AIVEN_PG_SERVICE ?? "dock-pg",
  opensearch: process.env.AIVEN_OPENSEARCH_SERVICE ?? "dock-search",
  valkey: process.env.AIVEN_VALKEY_SERVICE ?? "dock-cache",
  kafka: process.env.AIVEN_KAFKA_SERVICE ?? "dock-events",
};

async function api(path) {
  const res = await fetch(`https://api.aiven.io/v1${path}`, { headers: { Authorization: `aivenv1 ${token}` } });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} -> HTTP ${res.status}`);
  return res.json();
}
const service = async (name) =>
  (await api(`/project/${project}/service/${name}?include_secrets=true`)).service;

const enc = encodeURIComponent;
/** One-line dotenv value: double-quoted, newlines as \n (dotenv and process.loadEnvFile expand them). */
const quoted = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

const pairs = {};
const [pg, os, vk, kf, ca] = await Promise.all([
  includeDb ? service(SERVICES.pg) : null,
  service(SERVICES.opensearch),
  service(SERVICES.valkey),
  service(SERVICES.kafka),
  api(`/project/${project}/kms/ca`),
]);
if (pg) pairs.DATABASE_URL = pg.service_uri;
{
  const p = os.service_uri_params;
  pairs.OPENSEARCH_URL = `https://${enc(p.user)}:${enc(p.password)}@${p.host}:${p.port}`;
}
{
  const p = vk.service_uri_params;
  pairs.VALKEY_URL = `rediss://${enc(p.user)}:${enc(p.password)}@${p.host}:${p.port}`;
}
{
  const p = kf.service_uri_params;
  const admin = kf.users.find((u) => u.username === "avnadmin");
  pairs.KAFKA_BOOTSTRAP_SERVERS = `${p.host}:${p.port}`;
  pairs.KAFKA_SECURITY_PROTOCOL = "SSL";
  pairs.KAFKA_ACCESS_KEY = quoted(admin.access_key);
  pairs.KAFKA_ACCESS_CERT = quoted(admin.access_cert);
  pairs.KAFKA_CA_CERT = quoted(ca.certificate);
}
for (const [k, v] of Object.entries(pairs)) {
  if (v.includes("<redacted>")) throw new Error(`${k}: API returned a redacted value`);
}

const original = readFileSync(ENV, "utf8");
const lines = original.split("\n");
const trailingNewline = original.endsWith("\n");
if (trailingNewline) lines.pop();
const updated = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(lines[i]);
  if (m && m[1] in pairs && !updated.includes(m[1])) {
    lines[i] = `${m[1]}=${pairs[m[1]]}`;
    updated.push(m[1]);
  }
}
const added = Object.keys(pairs).filter((k) => !updated.includes(k));
if (added.length) {
  lines.push("# Aiven services (written by infra/aiven-env.mjs; see infra/aiven.md)");
  for (const k of added) lines.push(`${k}=${pairs[k]}`);
}
writeFileSync(ENV, lines.join("\n") + "\n");
console.log(`updated: ${updated.join(", ") || "none"}`);
console.log(`added:   ${added.join(", ") || "none"}`);
