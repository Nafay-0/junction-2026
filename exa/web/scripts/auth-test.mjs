// End-to-end test of accounts, sign-in and saved conversations, over HTTP against a running server.
// Needs the dev server and its database. Run: pnpm test:auth [port]
//
// It signs in as the admin from exa/.env.local, makes two throwaway accounts, and checks what must
// hold: wrong passwords are refused, each account sees only its own conversations, a conversation
// can only be added to from the kind of client it was started in, the admin's routes are the
// admin's alone, and blocking, a new password and deleting take effect at once. It removes the
// accounts it made. No password is ever printed.
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

  /* Too many wrong passwords. */
  const guessed = `guess-${tag}@beryl.test`;
  let last;
  for (let i = 0; i < 7; i++) last = await new Client().signIn(guessed, secret());
  check("repeated wrong passwords are slowed down", last.status === 429, say(last));

  /* The overview, and deleting. */
  r = await admin.get("/api/admin/overview");
  const before = r.json?.conversations?.total;
  check("the admin's overview answers", r.status === 200 && typeof before === "number" && Array.isArray(r.json?.daily) && r.json.daily.length === 14, say(r));
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
