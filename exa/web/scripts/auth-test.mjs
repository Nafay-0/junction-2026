// End-to-end test of accounts, sign-in and saved conversations, over HTTP against a running server.
// Needs the dev server and its database. Run: pnpm test:auth [port]
//
// It signs in as the admin from exa/.env.local, makes a few throwaway accounts, and checks what
// must hold: wrong passwords are refused, each account sees only its own conversations, a
// conversation can only be added to from the kind of client it was started in, the admin's routes
// are the admin's alone, the admin decides each account's modes, whether it sees usage and how
// much it may spend, and blocking, a new password and deleting take effect at once. It removes
// the accounts it made. No password is ever printed.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedEnv = path.join(web, "..", ".env.local");
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const port = process.argv[2] ?? "3000";
const base = `http://localhost:${port}`;
const COOKIE = "beryl_session";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `  ${detail}`}`);
};

/** One browser: it keeps its cookie and says which kind of client it is. */
class Client {
  constructor(kind = "web") {
    this.kind = kind;
    this.cookie = "";
  }
  /** The same signed-in browser, speaking as the other kind of client. */
  as(kind) {
    const other = new Client(kind);
    other.cookie = this.cookie;
    return other;
  }
  async call(method, route, body) {
    const res = await fetch(base + route, {
      method,
      redirect: "manual",
      headers: { "x-beryl-client": this.kind, ...(this.cookie ? { cookie: `${COOKIE}=${this.cookie}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";").map((s) => s.trim());
      if (!pair.startsWith(`${COOKIE}=`)) continue;
      this.cookie = pair.slice(COOKIE.length + 1);
      this.cookieAttributes = attributes.map((a) => a.toLowerCase());
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, location: res.headers.get("location") };
  }
  get = (route) => this.call("GET", route);
  post = (route, body) => this.call("POST", route, body ?? {});
  put = (route, body) => this.call("PUT", route, body);
  patch = (route, body) => this.call("PATCH", route, body);
  del = (route) => this.call("DELETE", route);
  signIn = (email, password) => this.post("/api/auth/login", { email, password });
}

const say = (r) => `${r.status} ${JSON.stringify(r.json ?? "").slice(0, 160)}`;
const tag = randomBytes(4).toString("hex");
const secret = () => randomBytes(12).toString("base64url");
const message = (id, role, text) => ({ id, role, parts: [{ type: "text", text }] });
const made = [];

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
const admin = new Client();

try {
  if (!adminEmail || !adminPassword) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in exa/.env.local.");

  /* Signed out. */
  const nobody = new Client();
  let r = await nobody.get("/api/auth/me");
  check("signed out: the API says so", r.status === 401, say(r));
  r = await nobody.get("/");
  check("signed out: the app sends you to the sign-in page", r.status >= 300 && r.status < 400 && /\/login/.test(r.location ?? ""), `${r.status} ${r.location}`);
  r = await nobody.get("/admin");
  check("signed out: so does the admin area, and it remembers where you were going", /\/login\?next=%2Fadmin/.test(r.location ?? ""), `${r.status} ${r.location}`);
  r = await nobody.get("/api/conversations");
  check("signed out: no conversations", r.status === 401, say(r));
  r = await nobody.get("/api/admin/users");
  check("signed out: no admin routes", r.status === 401, say(r));
  r = await nobody.get("/login");
  check("the sign-in page is open to everyone", r.status === 200, String(r.status));
  r = await nobody.get("/dev/sandbox.html");
  check("the pretend shop for the browser tests stays open", r.status === 200, String(r.status));

  /* Signing in. */
  r = await nobody.signIn(adminEmail, `${adminPassword}x`);
  const wrongPassword = r.json?.error;
  check("a wrong password is refused", r.status === 401 && !nobody.cookie, say(r));
  r = await nobody.signIn(`nobody-${tag}@beryl.test`, secret());
  check("an unknown email gets the very same answer", r.status === 401 && r.json?.error === wrongPassword, say(r));
  r = await nobody.post("/api/auth/login", { email: "not an email", password: "" });
  check("nonsense is refused politely", r.status === 400 && typeof r.json?.error === "string", say(r));

  r = await admin.signIn(adminEmail.toUpperCase(), adminPassword);
  check("the admin signs in (the email's case does not matter)", r.status === 200 && r.json?.user?.role === "admin" && Boolean(admin.cookie), say(r));
  check("the cookie cannot be read by scripts and stays on this site", admin.cookieAttributes?.includes("httponly") && admin.cookieAttributes?.includes("samesite=lax"), String(admin.cookieAttributes));
  r = await admin.get("/api/auth/me");
  check("and is recognised afterwards", r.status === 200 && r.json?.user?.email === adminEmail, say(r));

  /* Accounts. */
  const ada = { name: "Ada Test", email: `ada-${tag}@beryl.test`, password: secret() };
  const bo = { name: "Bo Test", email: `bo-${tag}@beryl.test`, password: secret() };
  for (const person of [ada, bo]) {
    r = await admin.post("/api/admin/users", { ...person, role: "admin", status: "blocked" });
    check(`the admin adds an account (${person.name})`, r.status === 201 && typeof r.json?.id === "string", say(r));
    person.id = r.json?.id;
    if (person.id) made.push(person.id);
  }
  r = await admin.get("/api/admin/users");
  const listed = (r.json?.accounts ?? []).filter((a) => made.includes(a.id));
  check("an account made this way is an ordinary, active one, whatever was sent", listed.length === 2 && listed.every((a) => a.role === "user" && a.status === "active"), JSON.stringify(listed.map((a) => [a.role, a.status])));
  check("there is exactly one admin", (r.json?.accounts ?? []).filter((a) => a.role === "admin").length === 1);
  r = await admin.post("/api/admin/users", { ...ada, name: "Again" });
  check("the same email cannot be used twice", r.status === 409, say(r));
  r = await admin.post("/api/admin/users", { name: "Weak", email: `weak-${tag}@beryl.test`, password: "short" });
  check("a short password is refused", r.status === 400, say(r));

  const adaWeb = new Client("web");
  const boWeb = new Client("web");
  r = await adaWeb.signIn(ada.email, ada.password);
  check("the new account signs in", r.status === 200 && r.json?.user?.role === "user", say(r));
  await boWeb.signIn(bo.email, bo.password);

  /* The admin's routes are the admin's alone. */
  r = await adaWeb.get("/api/admin/users");
  const r2 = await adaWeb.get("/api/admin/overview");
  const r3 = await adaWeb.post("/api/admin/users", { name: "Sneak", email: `sneak-${tag}@beryl.test`, password: secret() });
  const r4 = await adaWeb.patch(`/api/admin/users/${bo.id}`, { status: "blocked" });
  const r5 = await adaWeb.del(`/api/admin/users/${bo.id}`);
  check("an ordinary account gets 403 on every admin route", [r, r2, r3, r4, r5].every((x) => x.status === 403), [r, r2, r3, r4, r5].map((x) => x.status).join(" "));
  r = await adaWeb.get("/admin");
  check("and the admin pages are not there for it", r.status === 404 || (r.status >= 300 && r.status < 400), String(r.status));
  r = await admin.patch(`/api/admin/users/${ada.id}`, { role: "admin" });
  check("nobody can be made admin through the API", r.status === 400, say(r));

  /* What an account may use: its modes, whether it sees usage, and its spending limit. */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ALL_MODES = ["ultrafast", "fast", "smart", "expert"];
  const inList = async (id) => ((await admin.get("/api/admin/users")).json?.accounts ?? []).find((a) => a.id === id);
  const meOf = async (client) => (await client.get("/api/auth/me")).json?.user;
  check(
    "a new account starts with only the quickest mode, usage hidden and no limit",
    listed.every((a) => same(a.modes, ["ultrafast"]) && a.showUsage === false && a.usageCapUsd === null),
    JSON.stringify(listed.map((a) => [a.modes, a.showUsage, a.usageCapUsd])),
  );
  let who = await meOf(adaWeb);
  check("and is told so when it asks who it is", same(who?.modes, ["ultrafast"]) && who?.showUsage === false && who?.usageCapUsd === null, JSON.stringify(who));
  who = await meOf(admin);
  check("the admin has every mode, sees usage and has no limit", same(who?.modes, ALL_MODES) && who?.showUsage === true && who?.usageCapUsd === null, JSON.stringify(who));

  r = await admin.patch(`/api/admin/users/${ada.id}`, { modes: ["expert", "ultrafast"], showUsage: true });
  check("the admin switches modes on and lets an account see its usage", r.status === 200, say(r));
  who = await meOf(adaWeb);
  check("which holds from the account's next request, without signing it out, modes in order", same(who?.modes, ["ultrafast", "expert"]) && who?.showUsage === true, JSON.stringify(who));
  r = await admin.patch(`/api/admin/users/${ada.id}`, { modes: [] });
  const r6 = await admin.patch(`/api/admin/users/${ada.id}`, { modes: ["fast", "telepathy"] });
  check("an account always keeps at least one mode, and only real ones", r.status === 400 && r6.status === 400 && same((await inList(ada.id))?.modes, ["ultrafast", "expert"]), `${say(r)} | ${say(r6)}`);
  r = await admin.patch(`/api/admin/users/${ada.id}`, { modes: ["fast"], showUsage: false });
  who = await meOf(adaWeb);
  check("modes can be taken away again, the quickest included", r.status === 200 && same(who?.modes, ["fast"]) && who?.showUsage === false, JSON.stringify(who));

  r = await admin.patch(`/api/admin/users/${ada.id}`, { usageCapUsd: 10 });
  const capped = await inList(ada.id);
  who = await meOf(adaWeb);
  check("the admin sets a usage limit", r.status === 200 && capped?.usageCapUsd === 10 && typeof capped?.costUsd === "number", say(r));
  check("and the account is told its limit", who?.usageCapUsd === 10, JSON.stringify(who));
  const bad = [];
  for (const amount of [0, -5, 200000, "ten"]) bad.push((await admin.patch(`/api/admin/users/${ada.id}`, { usageCapUsd: amount })).status);
  check("a limit is a positive amount, within reason", bad.every((status) => status === 400) && (await inList(ada.id))?.usageCapUsd === 10, bad.join(" "));
  r = await admin.patch(`/api/admin/users/${ada.id}`, { usageCapUsd: null });
  who = await meOf(adaWeb);
  check("the admin removes the limit", r.status === 200 && (await inList(ada.id))?.usageCapUsd === null && who?.usageCapUsd === null, say(r));

  const cy = { name: "Cy Test", email: `cy-${tag}@beryl.test`, password: secret(), modes: ["smart", "ultrafast"], showUsage: true, usageCapUsd: 2.5 };
  r = await admin.post("/api/admin/users", cy);
  if (r.json?.id) made.push(r.json.id);
  const cyListed = await inList(r.json?.id);
  check("an account can be added with its modes, usage in view and a limit", r.status === 201 && same(cyListed?.modes, ["ultrafast", "smart"]) && cyListed?.showUsage === true && cyListed?.usageCapUsd === 2.5, JSON.stringify(cyListed ?? say(r)));
  r = await admin.post("/api/admin/users", { name: "No Modes", email: `none-${tag}@beryl.test`, password: secret(), modes: [] });
  check("but not with no mode at all", r.status === 400, say(r));

  r = await adaWeb.get(`/api/admin/users/${bo.id}/usage`);
  check("one account's usage is the admin's to see, nobody else's", r.status === 403, say(r));
  r = await admin.get(`/api/admin/users/${ada.id}/usage?days=30`);
  const kinds = ["llm", "exa", "voice", "decisions"];
  check(
    "the admin sees it by kind of cost, by mode and by model",
    r.status === 200 && r.json?.days === 30 && kinds.every((k) => typeof r.json?.period?.[k] === "number" && typeof r.json?.allTime?.[k] === "number") && Array.isArray(r.json?.byMode) && Array.isArray(r.json?.byModel),
    say(r),
  );
  r = await admin.get(`/api/admin/users/00000000-0000-4000-8000-000000000000/usage`);
  check("and an account that is not there has none", r.status === 404, say(r));

  /* Conversations belong to one account. */
  const first = `conv-${tag}-one`;
  r = await adaWeb.put(`/api/conversations/${first}`, { title: "Ada's first", modelLabel: "Test model", messages: [message("u1", "user", "hello"), message("a1", "assistant", "hi Ada")] });
  check("a conversation is saved", r.status === 200 && r.json?.meta?.origin === "web" && r.json?.meta?.title === "Ada's first", say(r));
  r = await adaWeb.get("/api/conversations");
  check("it is in its owner's list", r.status === 200 && r.json?.conversations?.some((c) => c.id === first), say(r));
  r = await boWeb.get("/api/conversations");
  check("and not in anyone else's", r.status === 200 && !r.json?.conversations?.some((c) => c.id === first), say(r));
  r = await boWeb.get(`/api/conversations/${first}`);
  check("someone else asking for it by id gets 404", r.status === 404, say(r));
  r = await boWeb.put(`/api/conversations/${first}`, { title: "Bo's own", messages: [message("u1", "user", "this is Bo")] });
  check("the same id in another account is another conversation", r.status === 200 && r.json?.meta?.title === "Bo's own", say(r));
  await boWeb.del(`/api/conversations/${first}`);
  r = await adaWeb.get(`/api/conversations/${first}`);
  check("so the first is untouched by what the other account did", r.status === 200 && r.json?.messages?.length === 2 && r.json?.messages?.[1]?.parts?.[0]?.text === "hi Ada", say(r));
  r = await adaWeb.put(`/api/conversations/${first}`, { title: "ignored", messages: [message("u1", "user", "hello"), message("a1", "assistant", "hi Ada"), message("u2", "user", "nul \u0000 and half a pair \ud83d here")] });
  const back = await adaWeb.get(`/api/conversations/${first}`);
  check("a later save replaces the messages and keeps the title", r.status === 200 && back.json?.messages?.length === 3 && back.json?.meta?.title === "Ada's first", say(r));
  check("text the database cannot hold as it is does not break a save", back.json?.messages?.[2]?.parts?.[0]?.text === "nul  and half a pair � here", JSON.stringify(back.json?.messages?.[2]?.parts?.[0]?.text));

  /* A conversation belongs to the kind of client it was started in. */
  const adaDesktop = adaWeb.as("desktop");
  r = await adaDesktop.put(`/api/conversations/${first}`, { title: "x", messages: [message("u1", "user", "from the desktop app")] });
  check("the desktop app cannot add to a conversation started on the web (409, and it says why)", r.status === 409 && /read-only/.test(r.json?.error ?? ""), say(r));
  r = await adaDesktop.get(`/api/conversations/${first}`);
  check("but it can read it", r.status === 200 && r.json?.messages?.length === 3 && r.json?.meta?.origin === "web", say(r));
  r = await adaDesktop.patch(`/api/conversations/${first}`, { title: "Renamed from the desktop app" });
  check("and rename it", r.status === 200 && r.json?.meta?.title === "Renamed from the desktop app", say(r));
  const second = `conv-${tag}-two`;
  r = await adaDesktop.put(`/api/conversations/${second}`, { title: "Started in the app", messages: [message("u1", "user", "book a table")] });
  check("a conversation started in the desktop app is marked so", r.status === 200 && r.json?.meta?.origin === "desktop", say(r));
  r = await adaWeb.put(`/api/conversations/${second}`, { title: "x", messages: [message("u1", "user", "from the web")] });
  check("and the web cannot add to that one", r.status === 409, say(r));
  r = await adaWeb.del(`/api/conversations/${second}`);
  check("either kind may delete", r.status === 200 && r.json?.deleted === true, say(r));

  /* Signing out. */
  const adaPhone = new Client("web");
  await adaPhone.signIn(ada.email, ada.password);
  await adaPhone.post("/api/auth/logout");
  r = await adaPhone.get("/api/auth/me");
  check("signing out ends that session", r.status === 401, say(r));
  r = await adaWeb.get("/api/auth/me");
  check("and only that one", r.status === 200, say(r));

  /* Blocking. */
  r = await admin.patch(`/api/admin/users/${bo.id}`, { status: "blocked" });
  check("the admin blocks an account", r.status === 200, say(r));
  r = await boWeb.get("/api/auth/me");
  check("which ends its session at once", r.status === 401, say(r));
  r = await new Client().signIn(bo.email, bo.password);
  check("and it cannot sign in again", r.status === 403, say(r));
  await admin.patch(`/api/admin/users/${bo.id}`, { status: "active" });
  r = await new Client().signIn(bo.email, bo.password);
  check("until it is unblocked", r.status === 200, say(r));

  /* A new password. */
  const newPassword = secret();
  r = await admin.patch(`/api/admin/users/${ada.id}`, { password: newPassword });
  check("the admin sets a new password", r.status === 200, say(r));
  r = await adaWeb.get("/api/auth/me");
  check("which signs the account out everywhere", r.status === 401, say(r));
  r = await new Client().signIn(ada.email, ada.password);
  check("the old password no longer works", r.status === 401, say(r));
  const adaAgain = new Client();
  r = await adaAgain.signIn(ada.email, newPassword);
  check("the new one does", r.status === 200, say(r));

  /* The admin's own account. */
  const me = (await admin.get("/api/auth/me")).json?.user?.id;
  r = await admin.patch(`/api/admin/users/${me}`, { status: "blocked" });
  check("the admin cannot block themselves", r.status === 400, say(r));
  r = await admin.del(`/api/admin/users/${me}`);
  check("or delete themselves", r.status === 400, say(r));
  r = await admin.patch(`/api/admin/users/${me}`, { password: secret() });
  check("and the admin's password is not changed through the API", r.status === 400, say(r));
  const fixed = [];
  for (const change of [{ modes: ["ultrafast"] }, { showUsage: false }, { usageCapUsd: 5 }]) fixed.push((await admin.patch(`/api/admin/users/${me}`, change)).status);
  who = await meOf(admin);
  check("nor are the admin's modes, usage or limit: they are fixed", fixed.every((status) => status === 400) && same(who?.modes, ALL_MODES) && who?.showUsage === true && who?.usageCapUsd === null, fixed.join(" "));

  /* Too many wrong passwords. */
  const guessed = `guess-${tag}@beryl.test`;
  let last;
  for (let i = 0; i < 7; i++) last = await new Client().signIn(guessed, secret());
  check("repeated wrong passwords are slowed down", last.status === 429, say(last));

  /* The overview, and deleting. */
  r = await admin.get("/api/admin/overview");
  const before = r.json?.conversations?.total;
  check("the admin's overview answers", r.status === 200 && typeof before === "number" && Array.isArray(r.json?.daily) && r.json.daily.length === 14, say(r));
  check(
    "with the cost by kind (LLMs, Exa, voice, decisions), by mode and by model",
    kinds.every((k) => typeof r.json?.period?.[k] === "number" && typeof r.json?.allTime?.[k] === "number" && typeof r.json?.daily?.[0]?.[k] === "number") && Array.isArray(r.json?.byMode) && Array.isArray(r.json?.byModel),
    JSON.stringify(r.json?.period),
  );
  const mine = (await adaAgain.get("/api/conversations")).json?.conversations?.length ?? 0;
  r = await admin.del(`/api/admin/users/${ada.id}`);
  check("the admin deletes an account", r.status === 200, say(r));
  r = await adaAgain.get("/api/auth/me");
  check("which signs it out", r.status === 401, say(r));
  r = await admin.get("/api/admin/overview");
  check("and takes its conversations with it", mine > 0 && r.json?.conversations?.total === before - mine, `${before} - ${mine} -> ${r.json?.conversations?.total}`);
  r = await new Client().signIn(ada.email, newPassword);
  check("a deleted account cannot sign in", r.status === 401, say(r));
} catch (err) {
  failed += 1;
  console.log("FAIL the test itself broke:", err?.message ?? err);
} finally {
  // Leave nothing behind.
  for (const id of made) await admin.del(`/api/admin/users/${id}`).catch(() => {});
  await admin.post("/api/auth/logout").catch(() => {});
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAccounts, sign-in and saved conversations behave as intended.");
process.exitCode = failed ? 1 : 0;
