#!/usr/bin/env node
/**
 * Screenshots of every screen, for a design pass: `pnpm ui:shots -- --out <dir> [--base http://localhost:4850]
 * [--only <substring>] [--no-seed]`. Headless Chromium from the repo's own Playwright; it does not touch any
 * browser a person is using.
 *
 * It first makes content (unless --no-seed): a visitor phone joins with a virtual passkey and asks its agent for
 * 1 000 L of milk (a sign-off), a test kitchen places a small order and a large one through its conversation, and
 * the operations desk runs the selling agent and the kitchen watch once. Then it visits every screen at
 * 390 x 844 (device scale 2, touch) and 1440 x 900 and saves `<dir>/<name>--phone.png` and `--desk.png`, plus
 * `manifest.json` (name -> address). Model spend: a few requests through the real reader and agent.
 *
 * Needs a running server (production build) with the operations passcode in OPS_PASSCODE (default polish-ops).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", process.env.SHOTS_BASE ?? "http://localhost:4850").replace(/\/$/, "");
const OUT = path.resolve(arg("out", "shots"));
const ONLY = arg("only", "");
const SEED = !process.argv.includes("--no-seed");
const PASSCODE = process.env.OPS_PASSCODE ?? "polish-ops";
const TEST = { username: "hotel-lumo", password: "lumo-breakfast-i4APPxo8" };
mkdirSync(OUT, { recursive: true });

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const COMMON = { baseURL: BASE, locale: "en-GB", timezoneId: "Europe/Helsinki" };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ headless: true });

async function passkey(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function settle(page) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(1200);
  // Skeletons gone, or give up after a few seconds.
  await page.waitForFunction(() => document.querySelectorAll(".skeleton").length === 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const firstHref = async (page, prefix) =>
  page.evaluate((p) => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).find((h) => h && h.startsWith(p) && h.length > p.length + 1) ?? null, prefix);

// ---------- seed: content on every side ----------

const found = {};

const opsCtx = await browser.newContext({ ...COMMON, ...DESK });
const ops = await opsCtx.newPage();
async function enterOps() {
  await ops.goto("/ops/enter");
  await ops.getByLabel("Your name, for the record").fill("Riikka Operations");
  const pc = ops.getByLabel("Passcode");
  if (await pc.isVisible().catch(() => false)) await pc.fill(PASSCODE);
  await ops.getByRole("button", { name: "Enter as operations staff" }).click();
  await ops.waitForURL((u) => !u.pathname.startsWith("/ops/enter"), { timeout: 30_000 });
}

const phoneCtx = await browser.newContext({ ...COMMON, ...PHONE });
const phone = await phoneCtx.newPage();
await passkey(phone);

const storeCtx = await browser.newContext({ ...COMMON, ...DESK });
const store = await storeCtx.newPage();

async function signInStore() {
  const r = await store.request.post("/ui-api/account/signin", { data: TEST });
  const j = await r.json();
  found.kitchen = (j.next ?? "").split("/k/")[1]?.split(/[/?#]/)[0];
  log("store kitchen", found.kitchen);
}

async function say(page, words) {
  const field = page.getByRole("textbox", { name: /^(Ask, or say what the kitchen needs|What changes\?|How much, and for when\?)$/ }).filter({ visible: true }).first();
  await field.waitFor({ timeout: 30_000 });
  await field.fill(words);
  await field.press("Enter");
}

async function join() {
  // Shots of the signed-out doors first.
  await shootPublicBeforeJoin();
  // The visitor phone joins (its own kitchen, and the approver of it).
  await phone.goto("/join");
  await phone.getByRole("button", { name: "Create my passkey and start" }).click();
  await phone.waitForURL("**/approver", { timeout: 40_000 });
  const res = await phone.request.get("/k/mine", { maxRedirects: 0 });
  found.visitor = (res.headers()["location"] ?? "").split("/k/")[1]?.split(/[/?#]/)[0];
  log("visitor kitchen", found.visitor);
}

async function seed() {
  // The test kitchen: a small order it may place alone, then the big one.
  await signInStore();
  await store.goto(`/k/${found.kitchen}/order`);
  await store.waitForTimeout(1500);
  await store.request.post(`/ui-api/kitchens/${found.kitchen}/thread/reset`).catch(() => {});
  await store.reload();
  try {
    await say(store, "40 litres of lactose-free milk for Tuesday");
    const choices = store.getByRole("group", { name: "Choices" }).last();
    const pick = choices.getByRole("button", { name: /\d,\d\d\s?€$/ }).first();
    const keep = choices.getByRole("button", { name: "Yes, as I said" });
    await pick.or(keep).first().waitFor({ timeout: 90_000 });
    if (await keep.isVisible().catch(() => false)) {
      await keep.click();
      await store.getByRole("group", { name: "Choices" }).last().getByRole("button", { name: /\d,\d\d\s?€$/ }).first().waitFor({ timeout: 90_000 });
    }
    await store.getByRole("group", { name: "Choices" }).last().getByRole("button", { name: /\d,\d\d\s?€$/ }).first().click();
    await store.waitForTimeout(8000);
    log("small order placed (or asked)");
  } catch (e) {
    log("small order: could not finish", String(e).slice(0, 160));
  }

  await enterOps();
  // The selling agent and the watch, once each.
  for (const [url, name] of [
    ["/ops/offers", "Run the selling agent now"],
    ["/ops/watch", "Run the watch now"],
  ]) {
    try {
      await ops.goto(url);
      await ops.getByRole("button", { name }).click({ timeout: 20_000 });
      await ops.waitForTimeout(2000);
      await ops.getByRole("button", { name }).waitFor({ timeout: 120_000 });
      log("ran", url);
    } catch (e) {
      log("could not run", url, String(e).slice(0, 160));
    }
  }

  // The phone's milk request (it opens the sign-off by itself).
  try {
    await phone.goto("/approver");
    await phone.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
    await phone.waitForURL("**/approve/**", { timeout: 90_000 });
    found.approval = phone.url().split("/approve/")[1].split(/[?#]/)[0];
    log("approval", found.approval);
  } catch (e) {
    log("milk request: could not finish", String(e).slice(0, 160));
  }
}

// ---------- shots ----------

const manifest = {};
const audit = {};

/**
 * What a reader should never see, read from the page itself: codes and ids in visible text, text cut off by its
 * box, and (on a phone) controls smaller than 44 px. Runs in the page.
 */
const AUDIT = (phone) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("details:not([open]) > :not(summary), [aria-hidden=true], .sr-only, code, pre, kbd, script, style");
  };
  const texts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.textContent.trim();
    if (t && n.parentElement && visible(n.parentElement)) texts.push(t);
  }
  const all = texts.join(" \u2016 ");
  const grab = (re) => [...new Set([...all.matchAll(re)].map((m) => m[0]))].slice(0, 25);
  const leaks = {
    snake: grab(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g),
    ids: grab(/\b(?:ord|req|apr|qt|agent|sbx|thr|run|off|sus)_[A-Za-z0-9_]{4,}\b/g),
    cat: grab(/\bcat[ _]\d{3,}\b/gi),
    dock: grab(/\bDock\b[^\u2016]{0,40}/g),
  };
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.textOverflow === "ellipsis" || /line-clamp|truncate/.test(el.className)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "hidden" && el.textContent.trim()) clipped.push(el.textContent.trim().slice(0, 60));
  }
  const small = [];
  if (phone) {
    for (const el of document.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select, summary")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Links inside running text are exempt (WCAG 2.5.8 inline exception).
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
      if (r.height < 40 || r.width < 40) small.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`);
    }
  }
  const outside = [];
  const W = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 2 && r.width < W * 3) {
      let p = el.parentElement, scroller = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") { scroller = true; break; } p = p.parentElement; }
      if (!scroller) outside.push(`${el.tagName.toLowerCase()} ${(el.textContent || "").trim().slice(0, 40)}`);
    }
  }
  return { leaks, clipped: clipped.slice(0, 15), small: small.slice(0, 30), smallCount: small.length, outside: outside.slice(0, 10) };
};
async function shot(ctxOpts, storage, name, url, prepare) {
  if (ONLY && !name.includes(ONLY)) return;
  for (const [size, opts] of [
    ["phone", PHONE],
    ["desk", DESK],
  ]) {
    const ctx = await browser.newContext({ ...COMMON, ...opts, ...(storage ? { storageState: storage } : {}), ...ctxOpts });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { timeout: 45_000 });
      await settle(page);
      if (prepare) await prepare(page);
      const file = path.join(OUT, `${name}--${size}.png`);
      await page.screenshot({ path: file, fullPage: true, timeout: 30_000 });
      manifest[name] = url;
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      audit[`${name}--${size}`] = await page.evaluate(AUDIT, size === "phone");
      log("shot", name, size, wide > 1 ? `SIDEWAYS SCROLL +${wide}px` : "");
    } catch (e) {
      log("FAILED", name, size, String(e).slice(0, 160));
    } finally {
      await ctx.close();
    }
  }
}

async function shootPublicBeforeJoin() {
  await shot({}, null, "public-join", "/join");
}

async function shootAll() {
  // Public.
  for (const [name, url] of [
    ["public-wall", "/"],
    ["public-door", "/k"],
    ["public-signup", "/k/signup"],
    ["public-try", "/try"],
    ["public-docs", "/docs"],
    ["public-docs-connect", "/docs/connect-an-agent"],
    ["public-docs-assumptions", "/docs/assumptions"],
    ["public-presenter-join", "/join/presenter"],
    ["public-present", "/present"],
    ["public-present-table", "/present/table"],
    ["public-screen", "/screen"],
    ["public-mail-confirm", "/mail/confirm"],
    ["public-mail-stopped", "/mail/stopped"],
    ["public-ops-enter", "/ops/enter"],
    ["public-not-found", "/this-page-does-not-exist"],
    ["public-knowledge", "/knowledge"],
    ["public-plan", "/plan"],
  ])
    await shot({}, null, name, url);

  // The approver's phone.
  const phoneState = await phoneCtx.storageState();
  await shot({}, phoneState, "phone-approver", "/approver");
  if (found.approval) await shot({}, phoneState, "phone-approve-pending", `/approve/${found.approval}`);

  // The store.
  const storeState = await storeCtx.storageState();
  const k = found.kitchen;
  if (k) {
    await shot({}, storeState, "store-door-signed-in", "/k");
    await shot({}, storeState, "store-home", `/k/${k}`);
    await shot({}, storeState, "store-catalogue", `/k/${k}/catalogue`);
    await store.goto(`/k/${k}/catalogue`);
    await settle(store);
    const product = await firstHref(store, `/k/${k}/catalogue/`);
    if (product) await shot({}, storeState, "store-product", product);
    await shot({}, storeState, "store-basket", `/k/${k}/basket`);
    await shot({}, storeState, "store-orders", `/k/${k}/orders`);
    await store.goto(`/k/${k}/orders`);
    await settle(store);
    const order = await firstHref(store, `/k/${k}/orders/`);
    if (order) await shot({}, storeState, "store-order", order);
    await shot({}, storeState, "store-agent", `/k/${k}/agent`);
    await shot({}, storeState, "store-menu", `/k/${k}/menu`);
    await shot({}, storeState, "store-thread", `/k/${k}/order`);
  }
  if (found.visitor) {
    await shot({}, phoneState, "store-visitor-home", `/k/${found.visitor}`);
    await shot({}, phoneState, "store-visitor-week", `/k/${found.visitor}/week`);
  }

  // Operations.
  const opsState = await opsCtx.storageState();
  const OPS = [
    ["ops-live", "/ops"],
    ["ops-orders", "/ops/orders"],
    ["ops-trace", "/ops/trace"],
    ["ops-conversations", "/ops/conversation"],
    ["ops-safeguards", "/ops/safeguards"],
    ["ops-radar", "/ops/radar"],
    ["ops-offers", "/ops/offers"],
    ["ops-watch", "/ops/watch"],
    ["ops-mail", "/ops/mail"],
    ["ops-control", "/ops/control"],
    ["ops-audit", "/ops/audit"],
    ["ops-time-machine", "/ops/time-machine"],
    ["ops-agents", "/ops/agents"],
    ["ops-customers", "/ops/customers"],
    ["ops-accounts", "/ops/accounts"],
    ["ops-platform", "/ops/platform"],
    ["ops-platform-observe", "/ops/platform/observe"],
    ["ops-platform-stream", "/ops/platform/stream"],
    ["ops-platform-ask", "/ops/platform/ask"],
    ["ops-platform-agent", "/ops/platform/agent"],
  ];
  for (const [name, url] of OPS) await shot({}, opsState, name, url);
  for (const [name, list, prefix] of [
    ["ops-order", "/ops/orders", "/ops/orders/"],
    ["ops-trace-one", "/ops/trace", "/ops/trace/"],
    ["ops-conversation-one", "/ops/conversation", "/ops/conversation/"],
    ["ops-customer-one", "/ops/customers", "/ops/customers/"],
    ["ops-audit-one", "/ops/audit", "/ops/audit/"],
  ]) {
    if (ONLY && !name.includes(ONLY)) continue;
    await ops.goto(list);
    await settle(ops);
    const href = await firstHref(ops, prefix);
    if (href) await shot({}, opsState, name, href);
    else log("no link for", name);
  }

  // The sign-off, decided (last: it changes the order).
  if (found.approval && (!ONLY || "phone-approve-decided".includes(ONLY))) {
    try {
      await phone.goto(`/approve/${found.approval}`);
      await phone.getByRole("button", { name: /^Approve \d/ }).click({ timeout: 20_000 });
      await phone.getByRole("heading", { name: "Order placed" }).waitFor({ timeout: 40_000 });
      await shot({}, await phoneCtx.storageState(), "phone-approve-decided", `/approve/${found.approval}`);
    } catch (e) {
      log("approve: could not finish", String(e).slice(0, 160));
    }
  }
}

await join();
if (SEED) await seed();
else {
  await signInStore();
  await enterOps();
}
await shootAll();
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ base: BASE, found, manifest }, null, 2));
writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(audit, null, 1));
await browser.close();
log("done", OUT);
