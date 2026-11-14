#!/usr/bin/env node
/**
 * One-time clean-up of the hosted site after the deploy that keeps the sample activity in its own kitchens: the site
 * had played the earlier sample, which wrote conversation turns, orders and staged conditions into the test kitchens
 * and into Kaari and Laakso. Run once as staff, after the deploy:
 *
 *   node infra/hosted-sample-clean.mjs
 *   DOCK_HOSTED_URL=https://… node infra/hosted-sample-clean.mjs
 *
 * Signs in at POST /ops-api/session with DOCK_OPS_PASSCODE from web/.env.local (never printed), then:
 *   1. resets the shared test accounts (POST /ops-api/accounts/reset): Hotel Lumo, Metsola and Sointu become fresh
 *      organisations, without the earlier sample's turns, waiting orders, staged stock-outs and rule changes;
 *   2. clears what the earlier sample left in Kaari and Laakso (POST /ops-api/sample {action:"clean"}): its waiting
 *      orders taken back, its staged conditions lifted, its auto-renew switched off, its open offers declined and mutes
 *      lifted, its orders removed from the kitchens' order history, a conversation holding its turns started over;
 *      only records the sample marked as its own, each recorded in the ledger;
 *   3. plays the new sample once (POST /ops-api/sample {action:"refresh"}): the earlier sets are marked superseded;
 *   4. checks and prints what a person signing in would meet (GET /ops-api/sample?check=1) and the waiting count.
 *
 * Safe to run twice: the reset gives fresh test kitchens again, the clean-up finds nothing left the second time, and
 * the refresh supersedes the set the first run played and plays another (more sample entries in the ledger, nothing
 * else). Exits non-zero if the final check finds a sample turn or a sample order waiting in a kitchen people sign into.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../web/.env.local");
const env = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const passcode = process.env.DOCK_OPS_PASSCODE || env.DOCK_OPS_PASSCODE;
const base = (process.env.DOCK_HOSTED_URL || "https://aimopilot.zeroanomaly.tech").replace(/\/$/, "");
if (!passcode) {
  console.error("DOCK_OPS_PASSCODE is not set in web/.env.local (or the environment).");
  process.exit(2);
}

let cookie = "";
async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { accept: "application/json", origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) cookie = [cookie, c.split(";")[0]].filter(Boolean).join("; ");
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${json?.error?.message ?? json?.raw ?? ""}`);
  return json;
}

console.log(`Hosted site: ${base}`);
const s = await call("POST", "/ops-api/session", { passcode, name: "Sample clean-up" });
console.log(`Signed in as staff (${s.name}).`);

console.log("\n1. Resetting the shared test accounts…");
const reset = await call("POST", "/ops-api/accounts/reset");
console.log(`   reset: ${(reset.reset ?? []).join(", ") || "(none reported)"}`);

console.log("\n2. Clearing what the earlier sample left in kitchens people sign into…");
const clean = await call("POST", "/ops-api/sample", { action: "clean" });
for (const k of clean.cleared ?? []) console.log(`   ${k.kitchen}: ${k.done.length ? k.done.join("; ") : "nothing of the sample left"}`);

console.log("\n3. Playing the new sample once…");
const before = await call("GET", "/ops-api/sample");
const fresh = await call("POST", "/ops-api/sample", { action: "refresh" });
const p = fresh.played;
console.log(`   superseded: ${before.current ? before.current.set : "(no earlier set shown)"}; played ${p ? `${p.set}: ${p.beats} beats in ${(p.ms / 1000).toFixed(1)} s${p.failed?.length ? `, failed: ${p.failed.join(", ")}` : ""}` : "nothing"}`);
console.log("   The earlier sets' ledger entries stay (the ledger is append-only and hash-chained), still marked as sample,");
console.log("   hidden by \"Hide the sample\", and no longer shown once superseded.");

console.log("\n4. Checking what a person signing in would meet…");
const check = await call("GET", "/ops-api/sample?check=1");
let bad = 0;
for (const k of check.kitchens ?? []) {
  const ok = !k.sampleTurnsInConversation && k.sampleOrdersWaiting === 0;
  if (!ok) bad++;
  console.log(`   ${ok ? "ok  " : "LEFT"} ${k.kitchen}: sample turns in the conversation ${k.sampleTurnsInConversation ? "YES" : "none"}, sample orders waiting ${k.sampleOrdersWaiting}`);
}
const session = await call("GET", "/ops-api/session");
console.log(`   Top bar: ${session.waiting} sign-off(s) waiting (all kitchens, sample shown; the new sample's own kitchens hold its waiting orders).`);
console.log(`   Sample orders waiting in kitchens people sign into: ${check.sampleWaitingInSignable}`);
if (bad || check.sampleWaitingInSignable) {
  console.error("\nSomething of the sample is still in a kitchen people sign into: see above.");
  process.exit(1);
}
console.log("\nDone.");
