// End-to-end test of notifications, against the running server. Run: pnpm test:notify [port]
//
// With two throwaway accounts and real (small) chats, it checks: the settings and their
// defaults; presence check-ins; "tell me when it's done" (a notice when the chat finishes, an
// email only when the user is away, nothing after Stop); "the browser is waiting for you" (one
// notice however often it is reported, an email a minute later only if it is still waiting and
// the user is away); reading and clearing; and that another account sees and can touch none of it.
//
// The accounts are made straight in the database (ordinary accounts, never an admin) with
// addresses at Resend's test inbox, which reaches no one, and are deleted at the end. It needs
// DATABASE_URL from exa/.env.local, and RESEND_API_KEY on the server: the email checks read
// notifications.emailed_at. It takes about three minutes and costs under a cent.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const port = process.argv.slice(2).find((a) => /^\d{2,5}$/.test(a)) ?? "3000";
const base = `http://localhost:${port}`;
const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
/** The first column of the first row, as text. */
const text = async (query) => {
  const rows = await db.unsafe(query);
  return rows.length ? String(Object.values(rows[0])[0] ?? "") : "";
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (label, pass, note = "") => { if (!pass) failures += 1; console.log(`${pass ? "ok  " : "FAIL"} ${label}${note !== "" ? `  (${String(note).slice(0, 200)})` : ""}`); };

/** The app's own password format (src/lib/auth/password.ts). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return ["scrypt", 32768, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}
const ACCOUNTS = [
  { email: "delivered+beryl-notify-test@resend.dev", name: "Notify Test", password: crypto.randomBytes(18).toString("base64url") },
  { email: "delivered+beryl-notify-other@resend.dev", name: "Notify Other", password: crypto.randomBytes(18).toString("base64url") },
];
const drop = async () => { for (const account of ACCOUNTS) await db`delete from users where email = ${account.email} and role = 'user'`; };
const create = async () => {
  await drop();
  for (const account of ACCOUNTS) await db`insert into users (email, name, password_hash, role, status, modes, show_usage) values (${account.email}, ${account.name}, ${hashPassword(account.password)}, 'user', 'active', ${["ultrafast", "fast"]}, true)`;
};
const passwordOf = (i) => ACCOUNTS[i].password;

const signIn = async (email, password) => {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`could not sign in (${res.status})`);
  return (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { "content-type": "application/json", cookie, "x-beryl-client": "web", ...(init.headers ?? {}) } });
};

await create();
const EMAIL = ACCOUNTS[0].email;
const userId = await text(`select id from users where email='${EMAIL}'`);
ok("two throwaway accounts exist", Boolean(userId));
const me = await signIn(EMAIL, passwordOf(0));
const other = await signIn(ACCOUNTS[1].email, passwordOf(1));
const windowId = "w-api-test-0001";
const json = async (res) => res.json().catch(() => null);
const notices = async () => json(await me("/api/notifications"));
const row = (dedupe) => text(`select coalesce(to_char(emailed_at,'HH24:MI:SS'),'-') || '|' || coalesce(to_char(read_at,'HH24:MI:SS'),'-') || '|' || coalesce(to_char(resolved_at,'HH24:MI:SS'),'-') from notifications where user_id='${userId}' and dedupe like '${dedupe}'`);

// --- the gate
ok("signed out, the API answers 401", (await fetch(`${base}/api/notifications`)).status === 401 && (await fetch(`${base}/api/presence`, { method: "POST", body: "{}" })).status === 401 && (await fetch(`${base}/api/chat/abcdef12/notify`)).status === 401);

// --- the list and the settings
let list = await notices();
ok("a new account has no notifications", Array.isArray(list?.items) && list.items.length === 0 && list.unread === 0);
let prefs = await json(await me("/api/notifications/settings"));
ok("the settings start at the defaults", prefs?.email === true && prefs.chats === true && prefs.browser === true && prefs.jobs === true && prefs.quietWhenHere === true, JSON.stringify(prefs));
prefs = await json(await me("/api/notifications/settings", { method: "PUT", body: JSON.stringify({ chats: false }) }));
ok("one switch can be turned off, and the others stay", prefs?.chats === false && prefs.email === true && prefs.jobs === true);
ok("a setting that is not a switch is refused", (await me("/api/notifications/settings", { method: "PUT", body: JSON.stringify({ chats: "no" }) })).status === 400);
prefs = await json(await me("/api/notifications/settings", { method: "PUT", body: JSON.stringify({ chats: true }) }));
ok("and turned back on", prefs?.chats === true);

// --- presence
ok("presence refuses a malformed window id", (await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId: "x", here: true }) })).status === 400);
const beat = await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: true }) });
ok("a window in front checks in and gets the list back", beat.ok && Array.isArray((await json(beat))?.items));
const gone = await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: false }) });
ok("a window that leaves says so (204)", gone.status === 204);

// --- "tell me when it's done"
const chat = async (id, text) => me("/api/chat", { method: "POST", body: JSON.stringify({ id, mode: "fast", effort: 1, timeZone: "Europe/Helsinki", messages: [{ id: `u-${id}`, role: "user", parts: [{ type: "text", text }] }] }) });
const drain = async (res) => { const reader = res.body.getReader(); for (;;) { const { done } = await reader.read(); if (done) break; } };
const c1 = `notifytest-${Date.now().toString(36)}a`;
ok("asking about a chat that does not exist is a 404", (await me(`/api/chat/${c1}/notify`, { method: "POST", body: JSON.stringify({ on: true }) })).status === 404);
let res = await chat(c1, "In two sentences: what is the capital of Finland and roughly how many people live there? Do not search.");
ok("a chat starts", res.ok, res.status);
await wait(400);
const asked = await me(`/api/chat/${c1}/notify`, { method: "POST", body: JSON.stringify({ on: true }) });
ok("while it works, the user asks to be told", asked.ok && (await json(asked))?.on === true);
const state = await json(await me(`/api/chat/${c1}/notify`));
ok("the server says it is on, and how long the chat has been working", state?.on === true, JSON.stringify(state));
await drain(res);
await wait(2500);
list = await notices();
const done1 = list.items.find((n) => n.kind === "chat_done" && n.conversationId === c1);
ok("when the chat finishes there is a notification", Boolean(done1) && list.unread >= 1, done1 ? `${done1.title} | ${done1.body.slice(0, 80)}` : JSON.stringify(list.items.map((n) => n.kind)));
ok("away from the screen, it is emailed", (await row(`done:${c1}:%`)).split("|")[0] !== "-", (await row(`done:${c1}:%`)));
ok("the request is used up", (await json(await me(`/api/chat/${c1}/notify`)))?.on === false);

// The same again while a window is in front: no email.
const c2 = `notifytest-${Date.now().toString(36)}b`;
res = await chat(c2, "In one sentence: what is the capital of Sweden? Do not search.");
await wait(400);
await me(`/api/chat/${c2}/notify`, { method: "POST", body: JSON.stringify({ on: true }) });
await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: true }) });
await drain(res);
await wait(2500);
list = await notices();
ok("with the user here, the notice is made", list.items.some((n) => n.kind === "chat_done" && n.conversationId === c2));
ok("and no email is sent", (await row(`done:${c2}:%`)).split("|")[0] === "-", (await row(`done:${c2}:%`)));

// Stop takes the request with it, and tells nobody.
const c3 = `notifytest-${Date.now().toString(36)}c`;
res = await chat(c3, "Write a 400 word essay about lakes. Do not search.");
await wait(600);
await me(`/api/chat/${c3}/notify`, { method: "POST", body: JSON.stringify({ on: true }) });
await me(`/api/chat/${c3}/run`, { method: "DELETE" });
await drain(res).catch(() => {});
await wait(2000);
list = await notices();
ok("a chat the user stopped tells nobody", !list.items.some((n) => n.conversationId === c3) && (await json(await me(`/api/chat/${c3}/notify`)))?.on === false);

// --- the live browser is waiting
await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: false }) });
const need = (body) => me("/api/notifications/needs-you", { method: "POST", body: JSON.stringify(body) });
ok("a report about someone else's chat is a 404", (await need({ conversationId: "someoneelse-123456", toolCallId: "t0", what: "approval" })).status === 404);
ok("a malformed report is refused", (await need({ conversationId: c1, what: "approval" })).status === 400 && (await need({ conversationId: c1, toolCallId: "t0", what: "dance" })).status === 400);
const t = Date.now().toString(36);
const n1 = await need({ conversationId: c1, toolCallId: `away-${t}`, what: "approval", text: "Reserve a table for 2 at Kahvila Sandbox tomorrow at 19:00." });
ok("an approval that is waiting makes a notice", n1.ok && Boolean((await json(n1))?.id));
await need({ conversationId: c1, toolCallId: `away-${t}`, what: "approval" });
list = await notices();
ok("told twice, it is one notice", list.items.filter((n) => n.kind === "needs_you" && n.title.includes("approval")).length === 1, list.items.filter((n) => n.kind === "needs_you").map((n) => n.title).join(" / "));
await need({ conversationId: c1, toolCallId: `dealt-${t}`, what: "login", text: "Sign in to your account so I can carry on." });
await wait(1500);
await need({ conversationId: c1, toolCallId: `dealt-${t}`, resolved: true });
console.log("     waiting a minute for the emails that are due");
await wait(64000);
ok("still waiting a minute later, with the user away: emailed", (await row(`needs:away-${t}`)).split("|")[0] !== "-", (await row(`needs:away-${t}`)));
const dealt = (await row(`needs:dealt-${t}`)).split("|");
ok("dealt with in the meantime: no email, and it reads as read", dealt[0] === "-" && dealt[1] !== "-" && dealt[2] !== "-", dealt.join("|"));
// With the user here, the email is held back.
await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: true }) });
await need({ conversationId: c1, toolCallId: `here-${t}`, what: "verification", text: "Enter the code the site sent you." });
for (let i = 0; i < 3; i++) { await wait(21000); await me("/api/presence", { method: "POST", body: JSON.stringify({ windowId, here: true }) }); }
await wait(3000);
ok("with the user here the whole minute: no email", (await row(`needs:here-${t}`)).split("|")[0] === "-", (await row(`needs:here-${t}`)));

// --- reading and clearing
list = await notices();
const before = list.unread;
const one = list.items.find((n) => !n.read);
list = await json(await me("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", ids: [one.id] }) }));
ok("one notice can be marked read", list.unread === before - 1 && list.items.find((n) => n.id === one.id)?.read === true);
list = await json(await me("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", ids: "all" }) }));
ok("all of them can", list.unread === 0 && list.items.every((n) => n.read));
ok("a bad read request is refused", (await me("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", ids: ["nope"] }) })).status === 400);
// Another account sees none of it.
ok("another account sees none of these", ((await json(await other("/api/notifications")))?.items ?? []).length === 0);
ok("and cannot ask about, or report on, this account's chat", (await other(`/api/chat/${c1}/notify`, { method: "POST", body: JSON.stringify({ on: true }) })).status === 404 && (await other("/api/notifications/needs-you", { method: "POST", body: JSON.stringify({ conversationId: c1, toolCallId: "x1", what: "approval" }) })).status === 404);
list = await json(await me("/api/notifications", { method: "DELETE" }));
ok("the list can be cleared", list.items.length === 0);
for (const id of [c1, c2, c3]) await me(`/api/conversations/${id}`, { method: "DELETE" });
await drop();
ok("the accounts are gone, and their notices with them", (await text(`select count(*) from notifications where user_id='${userId}'`)) === "0");
await db.end({ timeout: 5 });
console.log(failures ? `\n${failures} checks failed.` : "\nThe notification API behaves as intended.");
process.exit(failures ? 1 : 0);
