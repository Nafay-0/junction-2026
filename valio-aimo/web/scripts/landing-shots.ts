/**
 * The landing page's screenshots, made from the running product (headless Chromium, the repo's own Playwright).
 *
 *   pnpm landing:shots --url http://localhost:4760 [--only milk,ops,menu,watch,seller,voice,store,mail,wall,reel,webshop] [--keep-png DIR]
 *
 * The "webshop" stage (the agent docked in the store, for the landing's "How it looks on your webshop") wants the
 * server started with DOCK_SAMPLE_ACTIVITY=off as well, so no sample orders sit in the shot.
 *
 * The server: a production build with every hosted service switched off, on its own port (from web/):
 *
 *   ENV="DATABASE_URL= OPENSEARCH_URL= VALKEY_URL= KAFKA_BOOTSTRAP_SERVERS= DOCK_PUBLIC_URL= DOCK_MARIADB_URL= \
 *        DOCK_COPILOT_PG_URL= AIVEN_API_TOKEN= AIVEN_READONLY_TOKEN= AIVEN_PROJECT= AIVEN_ORGANIZATION_ID= \
 *        DOCK_AIVEN_LAUNCH_TOKEN= RESEND_API_KEY= DOCK_OPS_PASSCODE=landing-ops DOCK_LLM_DAILY_USD=15 \
 *        DOCK_WATCH_MINUTES=0 PORT=4760"
 *   env $ENV pnpm -s build && env $ENV pnpm -s start
 *
 * The second and third lines matter: .env.local also names the hosted read-only copilot database and the Aiven API,
 * and the scorecard and the platform page would read them. Blank, nothing here talks to a hosted service but the
 * model providers and the partner's mock price API. Run all stages in one go on a freshly started server (the
 * stages build on each other: the trace is the milk request's, the scorecard shows the attacks). The operations
 * Observe panels read PostgreSQL, so they are not shot here.
 *
 * The conversations run on the real agent and the partner's live price API, so each run differs a little; a stage
 * that fails is reported and the others still run. Phone shots: 390 x 844 at 3x, written 780 px wide; desktop:
 * 1440 x 900 at 2x, written 1920 px wide; mail: 600 px wide at 2x, written 1200 px wide. WebP via cwebp, quality
 * lowered until a file is under 200 KB. Output: public/landing/<key>.webp and src/app/_landing/shots.json
 * (src, w, h, kind, caption), rewritten after every shot so a partial run is still usable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { AgentTurn, Card, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url")?.replace(/\/$/, "");
if (!base) {
  console.error("Usage: pnpm landing:shots --url http://localhost:4760 [--only stage,stage]\nStart the server first; see the comment at the top of scripts/landing-shots.ts.");
  process.exit(2);
}
const only = opt("--only")?.split(",");
const WEB = path.resolve(__dirname, "..");
const OUT = path.join(WEB, "public/landing");
const MANIFEST = path.join(WEB, "src/app/_landing/shots.json");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "landing-shots-"));
const PASSCODE = process.env.DOCK_OPS_PASSCODE || "landing-ops";
const CWEBP = fs.existsSync("/opt/homebrew/bin/cwebp") ? "/opt/homebrew/bin/cwebp" : "cwebp";
const MAX_BYTES = 200 * 1024;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

type Kind = "phone" | "desktop" | "mail";
type Entry = { src: string; w: number; h: number; kind: Kind; caption: string };
const manifest: Record<string, Entry> = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const WIDTH: Record<Kind, number> = { phone: 780, desktop: 1920, mail: 1200 };
const done: string[] = [];
const failed: string[] = [];

/** The webshop stage's frames have their own manifest beside the second landing page that shows them. */
const WEBSHOP_MANIFEST = path.join(WEB, "src/app/_landing2/webshop.json");
const webshopManifest: Record<string, Entry> = fs.existsSync(WEBSHOP_MANIFEST) ? JSON.parse(fs.readFileSync(WEBSHOP_MANIFEST, "utf8")) : {};

function writeManifest() {
  for (const [m, file] of [
    [manifest, MANIFEST],
    [webshopManifest, WEBSHOP_MANIFEST],
  ] as const) {
    if (m === webshopManifest && !Object.keys(m).length) continue;
    const sorted = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
  }
}

/** PNG -> WebP at the kind's width (or `o.width`), quality lowered until the file is under MAX_BYTES (or `o.max`). */
function toWebp(png: string, key: string, kind: Kind, o: { width?: number; max?: number } = {}): { w: number; h: number; bytes: number } {
  const out = path.join(OUT, `${key}.webp`);
  let bytes = 0;
  for (const q of [82, 76, 70, 64, 58, 52, 46, 40, 34]) {
    execFileSync(CWEBP, ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-resize", String(o.width ?? WIDTH[kind]), "0", png, "-o", out]);
    bytes = fs.statSync(out).size;
    if (bytes <= (o.max ?? MAX_BYTES)) break;
  }
  const buf = fs.readFileSync(out);
  // VP8/VP8L/VP8X header: read the canvas size cwebp wrote.
  const fourcc = buf.toString("ascii", 12, 16);
  let w = 0;
  let h = 0;
  if (fourcc === "VP8X") {
    w = 1 + buf.readUIntLE(24, 3);
    h = 1 + buf.readUIntLE(27, 3);
  } else if (fourcc === "VP8 ") {
    w = buf.readUInt16LE(26) & 0x3fff;
    h = buf.readUInt16LE(28) & 0x3fff;
  } else if (fourcc === "VP8L") {
    const b = buf.readUInt32LE(21);
    w = (b & 0x3fff) + 1;
    h = ((b >> 14) & 0x3fff) + 1;
  }
  return { w, h, bytes };
}

/** Wait until the page shows nothing on its way: fonts loaded, no busy region, no skeleton, no turning step. */
async function quiet(page: Page, ms = 20_000) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const busy = await page
      .evaluate(() => {
        const visible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return [...document.querySelectorAll('[aria-busy="true"], .skeleton')].filter(visible).length;
      })
      .catch(() => 0);
    if (!busy) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(700);
}

async function shoot(page: Page, key: string, kind: Kind, caption: string, o: { fullPage?: boolean; quiet?: boolean; width?: number; max?: number; webshop?: boolean } = {}) {
  try {
    if (o.quiet !== false) await quiet(page);
    const png = path.join(TMP, `${key}.png`);
    await page.screenshot({ path: png, fullPage: !!o.fullPage, animations: "disabled", caret: "hide" });
    const { w, h, bytes } = toWebp(png, key, kind, o);
    if (opt("--keep-png")) fs.copyFileSync(png, path.join(opt("--keep-png")!, `${key}.png`));
    (o.webshop ? webshopManifest : manifest)[key] = { src: `/landing/${key}.webp`, w, h, kind, caption };
    writeManifest();
    done.push(`${key} ${w}x${h} ${(bytes / 1024).toFixed(0)} KB`);
    console.log(`  shot ${key} (${w}x${h}, ${(bytes / 1024).toFixed(0)} KB)`);
  } catch (e) {
    failed.push(`${key}: ${(e as Error).message.split("\n")[0]}`);
    console.log(`  FAILED ${key}: ${(e as Error).message.split("\n")[0]}`);
  }
}

// ------------------------------------------------------------------ contexts

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const COMMON = { locale: "en-GB", timezoneId: "Europe/Helsinki", reducedMotion: "reduce" as const };

async function context(browser: Browser, kind: "phone" | "desktop", extra: Record<string, unknown> = {}) {
  const ctx = await browser.newContext({ ...(kind === "phone" ? PHONE : DESK), ...COMMON, baseURL: base, ...extra });
  await ctx.addCookies([{ name: "aimopilot-lang", value: "en", url: base! }]);
  return ctx;
}

async function passkey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function signInKitchen(ctx: BrowserContext, username: string) {
  const account = TEST_ACCOUNTS.find((a) => a.username === username)!;
  const r = await ctx.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (!r.ok()) throw new Error(`sign-in as ${username}: HTTP ${r.status()}`);
}

async function signInOps(ctx: BrowserContext) {
  const r = await ctx.request.post(`${base}/ops-api/session`, { data: { passcode: PASSCODE, name: "Landing page" } });
  if (!r.ok()) throw new Error(`operations sign-in: HTTP ${r.status()}`);
}

/** The shared test accounts back to their seed (rules, mandate, history), so an earlier run's order is not "the usual". */
async function resetTestAccounts(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: base });
  await signInOps(ctx);
  const r = await ctx.request.post(`${base}/ops-api/accounts/reset`, { headers: { origin: base! } });
  console.log(`  test accounts reset: HTTP ${r.status()}`);
  await ctx.close();
}

// ------------------------------------------------------------------ the thread

async function threadOf(ctx: BrowserContext, kitchen: string): Promise<Thread> {
  const r = await ctx.request.get(`${base}/ui-api/kitchens/${kitchen}/thread`);
  return ((await r.json()) as { thread: Thread }).thread;
}
const cardsOf = (t: Thread): Card[] => t.turns.flatMap((x) => (x.role === "agent" ? x.cards : []));
const lastAgent = (t: Thread) => [...t.turns].reverse().find((x): x is AgentTurn => x.role === "agent");

async function idle(ctx: BrowserContext, kitchen: string, buyers: number, ms = 150_000): Promise<Thread> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await threadOf(ctx, kitchen);
    const b = t.turns.filter((x) => x.role === "buyer");
    const lastB = b.at(-1);
    const a = lastB && t.turns.find((x): x is AgentTurn => x.role === "agent" && x.replyTo === lastB.turnId);
    if (b.length >= buyers && a && a.status !== "working") return t;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error("the agent did not finish its turn");
}

async function say(page: Page, words: string, docked = false) {
  const field = docked ? page.locator("#assistant").getByRole("textbox").last() : page.getByRole("textbox").last();
  await field.fill(words);
  await field.press("Enter");
}

/** Open the "N steps" disclosure under the latest agent reply. */
async function openSteps(page: Page, which: "last" | "first" = "last") {
  const toggles = page.getByRole("button", { name: /^\d+ steps?$/ });
  const n = await toggles.count();
  if (!n) return false;
  const t = which === "last" ? toggles.nth(n - 1) : toggles.first();
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await page.waitForTimeout(600);
  return true;
}

async function resetThread(ctx: BrowserContext, kitchen: string) {
  await ctx.request.post(`${base}/ui-api/kitchens/${kitchen}/thread/reset`, { data: {} });
}

/** Scroll the thread so an element's top sits near the top of the screen (below sticky headers). */
async function topAlign(page: Page, locator: ReturnType<Page["locator"]>, offset = 90) {
  await locator.evaluate((el, off) => {
    let p: HTMLElement | null = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    const r = el.getBoundingClientRect();
    if (p) p.scrollBy({ top: r.top - off - p.getBoundingClientRect().top + 0, behavior: "instant" as ScrollBehavior });
    else window.scrollBy({ top: r.top - off, behavior: "instant" as ScrollBehavior });
  }, offset);
  await page.waitForTimeout(400);
}

// ------------------------------------------------------------------ stages

const MILK = "I need 1,000 litres of lactose-free milk by Monday";
let milkRequestId: string | undefined;

/** The partner's own example, on the phone, with the desktop beside it at the same moments. */
async function milk(browser: Browser) {
  const kitchen = "hotel-lumo";
  const ctx = await context(browser, "phone");
  const page = await ctx.newPage();
  await passkey(page);
  await resetTestAccounts(browser);
  await signInKitchen(ctx, kitchen);
  await resetThread(ctx, kitchen);
  const desk = await context(browser, "desktop");
  await desk.addCookies(await ctx.cookies());
  const dpage = await desk.newPage();

  await page.goto(`/k/${kitchen}`);
  await page.waitForTimeout(2500);
  await shoot(page, "agent-home", "phone", "The agent's home on a phone: it noticed before the kitchen that Monday's usual milk missed its cut-off, and asks once.");

  await say(page, MILK);
  await page.waitForTimeout(2600);
  await shoot(page, "flow-request", "phone", "The request as the buyer typed it, and the agent working through it step by step.", { quiet: false });
  let t = await idle(ctx, kitchen, 1);
  const first = lastAgent(t)!;
  milkRequestId = first.cards.find((c) => c.requestId)?.requestId ?? milkRequestId;
  await page.waitForTimeout(1500);
  await quiet(page);
  // The reply that names the missed cut-off, from its first line.
  const reply = page.locator("li, article, section").filter({ hasText: /cut-off|can't arrive|cannot arrive|can't come/i }).last();
  if (await reply.count()) await topAlign(page, reply, 40).catch(() => undefined);
  await shoot(page, "hero-phone-thread", "phone", "The agent's answer to the milk request: the usual 10 L boxes missed the order cut-off, the 1 L cartons can make Monday.");

  // The same moment on a desk: the store with the agent docked beside it.
  await dpage.goto(`/k/${kitchen}/catalogue`);
  await dpage.waitForTimeout(2500);
  if (!(await dpage.locator("#assistant").isVisible().catch(() => false))) {
    await dpage.getByRole("button", { name: /^Agent/ }).first().click().catch(() => undefined);
    await dpage.waitForTimeout(800);
  }
  await shoot(dpage, "hero-desktop-store", "desktop", "The store on a desk, with the kitchen's agent docked beside the catalogue in the same conversation.");

  // The lookup behind the reply: its steps opened.
  if (await openSteps(page)) {
    const steps = page.getByRole("button", { name: /^\d+ steps?$/ }).last();
    await topAlign(page, steps, 120).catch(() => undefined);
    await shoot(page, "flow-lookup", "phone", "The steps behind the reply opened: the request read, the products found, live price, stock and the order cut-off checked.");
    await shoot(page, "steps-open", "phone", "Every reply carries its steps, closed by default and one tap away.");
    await page.getByRole("button", { name: /^\d+ steps?$/ }).last().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }

  // The fixed-price options, the first one opened to show what it keeps and gives up.
  const opts = cardsOf(t).filter((c) => c.type === "options").at(-1);
  const firstName = opts?.type === "options" ? opts.options[0]?.lines[0]?.name : undefined;
  const more = page.getByText("more", { exact: true }).first();
  if (await more.count()) {
    await more.click().catch(() => undefined);
    await page.waitForTimeout(800);
  }
  if (firstName) await topAlign(page, page.getByText(firstName, { exact: false }).last(), 110).catch(() => undefined);
  await shoot(page, "flow-options", "phone", "Options at fixed prices from the live price call: each with its total, price per litre and delivery day.");
  if (await more.count()) await page.reload().then(() => page.waitForTimeout(2500));

  // Choose: the order is over the agent's limit, so it waits for a person.
  let buyers = 1;
  await say(page, opts?.type === "options" && opts.options.length > 1 ? "the first one" : "yes, order it");
  buyers++;
  let approvalId: string | undefined;
  for (let i = 0; i < 3 && !approvalId; i++) {
    t = await idle(ctx, kitchen, buyers);
    const waiting = cardsOf(t).find((c) => c.type === "gate" && c.outcome === "waiting" && c.approvalId);
    if (waiting?.type === "gate") approvalId = waiting.approvalId;
    else {
      // The agent left something open (a question, a sheet to confirm): answer it the way a person would.
      const a = lastAgent(t)!;
      const q = a.cards.find((c) => c.type === "question");
      await say(page, q?.type === "question" ? (q.questions[0]?.options[0]?.label ?? "yes") : "yes, order it");
      buyers++;
    }
  }
  milkRequestId = cardsOf(t).find((c) => c.type === "gate")?.requestId ?? milkRequestId;
  if (!approvalId) throw new Error("no sign-off was asked for");
  await page.waitForTimeout(1500);
  const slab = page.locator('[data-slab="waiting"]').last();
  if (await slab.count()) await topAlign(page, slab, 160).catch(() => undefined);
  await shoot(page, "thread-waiting", "phone", "Over the kitchen's limit: the order waits in the thread for the named person's OK.");

  // The test account's own browser signs as the kitchen's signer (the slab says so), with a passkey.
  const ok = page.getByRole("button", { name: /^OK with Face ID$/ }).last();
  await ok.click({ timeout: 20_000 });
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    t = await threadOf(ctx, kitchen);
    if (cardsOf(t).some((c) => c.type === "order" && c.status === "committed")) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(3000);
  await page.reload();
  await page.waitForTimeout(3000);
  const okd = page.getByText(/OK'd by/).last();
  if (await okd.count()) await topAlign(page, okd, 420).catch(() => undefined);
  await shoot(page, "thread-signed", "phone", "Back in the thread: the order placed at the quoted price, OK'd by the named person.");

  // The desk's full agent workspace, after the sign-off.
  await dpage.goto(`/k/${kitchen}`);
  await dpage.waitForTimeout(3000);
  await shoot(dpage, "screen-thread-desktop", "desktop", "The agent as the whole workspace on a desk: the same conversation, the order OK'd and placed.");
  // The store on a phone.
  await page.goto(`/k/${kitchen}/catalogue`);
  await page.waitForTimeout(2500);
  await shoot(page, "screen-store-phone", "phone", "The catalogue on a phone: 17,546 products, searchable in Finnish, Swedish and English.");
  await ctx.close();
  await desk.close();
}

/** The headline path: a visitor joins with a passkey, their agent asks for the milk, the sign-off reaches the phone. */
async function signoff(browser: Browser) {
  const ctx = await context(browser, "phone");
  const page = await ctx.newPage();
  await passkey(page);
  await page.goto("/join");
  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver", { timeout: 30_000 });
  await page.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
  await page.waitForURL("**/approve/**", { timeout: 120_000 });
  const approvalId = page.url().split("/approve/")[1].split(/[?#]/)[0];
  await page.getByRole("button", { name: /^Approve \d/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shoot(page, "flow-signoff", "phone", "The sign-off on the approver's phone: who asks, the total, why it stopped, approve with a passkey.");
  const desk = await context(browser, "desktop");
  await desk.addCookies(await ctx.cookies());
  const dp = await desk.newPage();
  await dp.goto(`/approve/${approvalId}`);
  await dp.waitForTimeout(3000);
  await shoot(dp, "screen-approve-desktop", "desktop", "The same sign-off page in a desktop browser.");
  await desk.close();
  await page.getByRole("button", { name: /^Approve \d/ }).click();
  await page.getByText(/Signed|Approved/).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, "flow-signed", "phone", "Signed with a passkey: the stamp names who signed, and the order is placed at the quoted price.");
  await ctx.close();
}

/** The presenter's six attacks on the gate, run for real against it; each refusal names its rule. */
async function refused(browser: Browser) {
  const ctx = await context(browser, "desktop");
  await signInOps(ctx);
  const page = await ctx.newPage();
  await page.goto("/present");
  await page.waitForTimeout(3000);
  for (const k of ["1", "2", "3", "4", "5", "6"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1500);
    const end = Date.now() + 45_000;
    while (Date.now() < end && (await page.locator('[aria-busy="true"]').count())) await page.waitForTimeout(500);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
  await shoot(page, "gate-refused", "desktop", "Six ways to make an agent misbehave, run against the live gate: each refused, each with the rule that refused it.");
  await ctx.close();
}

/** The operations portal: live, the agents' scorecard, observe, safeguards, the trace of the milk request. */
async function ops(browser: Browser) {
  const ctx = await context(browser, "desktop");
  await signInOps(ctx);
  const page = await ctx.newPage();
  await page.goto("/ops");
  await page.waitForTimeout(3000);
  await shoot(page, "ops-live", "desktop", "Operations, Live: every agent at the door and what the gate decided, as it happens.");
  await page.goto("/ops/agents");
  await page.waitForTimeout(3500);
  await shoot(page, "ops-agents", "desktop", "Operations, Agents: each agent's status with the reason in words, and the orders waiting for a person.");
  await page.goto("/ops/safeguards");
  await page.waitForTimeout(3000);
  await shoot(page, "ops-safeguards", "desktop", "Operations, Safeguards: the gate's rules and how often each one fired.");
  // Observe's panels read PostgreSQL as the read-only copilot user; on a server without it they say so, so no shot.
  // The trace of the milk request (or the latest request when the milk stage did not run).
  let rid = milkRequestId;
  if (!rid) {
    // The milk request of the hotel kitchen's thread (the milk stage ran in an earlier process).
    const k = await browser.newContext({ baseURL: base });
    await signInKitchen(k, "hotel-lumo");
    rid = cardsOf(await threadOf(k, "hotel-lumo")).find((c) => c.type === "gate")?.requestId;
    await k.close();
  }
  if (!rid) {
    const r = await ctx.request.get(`${base}/ops-api/trace`);
    rid = ((await r.json().catch(() => ({}))) as { requestId?: string }).requestId;
  }
  if (rid) {
    await page.goto(`/ops/trace/${rid}`);
    await page.waitForTimeout(3500);
    await shoot(page, "trace", "desktop", "The trace: one request replayed station by station, from the buyer's words to the signed order.");
  } else failed.push("trace: no request to trace");

  const phone = await context(browser, "phone");
  await signInOps(phone);
  const pp = await phone.newPage();
  await pp.goto("/ops");
  await pp.waitForTimeout(3000);
  await shoot(pp, "screen-ops-phone", "phone", "The operations portal on a phone.");
  await phone.close();
  await ctx.close();
}

/** The watch: a stock-out staged for a test kitchen (marked staged), found and answered with substitutes. */
async function watch(browser: Browser) {
  const ctx = await context(browser, "desktop");
  await signInOps(ctx);
  const kitchen = "koulu-metsola";
  const view = (await (await ctx.request.get(`${base}/ops-api/watch`)).json()) as { kitchens: { slug: string; standing: { productId: string }[] }[] };
  const productId = view.kitchens.find((k) => k.slug === kitchen)?.standing[0]?.productId;
  if (!productId) throw new Error("no standing order to stage a stock-out on");
  const st = await ctx.request.post(`${base}/ops-api/watch`, { data: { action: "stage_stock_out", kitchen, productId } });
  console.log(`  staged stock-out: HTTP ${st.status()}`);
  const run = await ctx.request.post(`${base}/ops-api/watch`, { data: { action: "run", kitchens: [kitchen], fresh: true } });
  console.log(`  watch run: HTTP ${run.status()}`);
  const page = await ctx.newPage();
  await page.goto("/ops/watch");
  await page.waitForTimeout(3500);
  await shoot(page, "ops-watch", "desktop", "Operations, Watch: what the kitchens' agents noticed before the kitchens did, and what each proposed.");

  const phone = await context(browser, "phone");
  await signInKitchen(phone, kitchen);
  await resetThread(phone, kitchen);
  const pp = await phone.newPage();
  await pp.goto(`/k/${kitchen}`);
  await pp.waitForTimeout(4000);
  await shoot(pp, "agent-watch", "phone", "The watch on the kitchen's phone: a product that cannot come for its day, noticed before the kitchen, with substitutes.");
  // Back to the real figures.
  const stages = ((await (await ctx.request.get(`${base}/ops-api/watch`)).json()) as { stages: { stageId?: string; id?: string; lifted?: unknown }[] }).stages;
  for (const s of stages ?? []) if (!s.lifted) await ctx.request.post(`${base}/ops-api/watch`, { data: { action: "lift", stageId: s.stageId ?? s.id } });
  await phone.close();
  await ctx.close();
}

/** The wholesaler's selling agent. */
async function seller(browser: Browser) {
  const ctx = await context(browser, "desktop");
  await signInOps(ctx);
  const r = await ctx.request.post(`${base}/ops-api/offers`, { data: { action: "run" } });
  console.log(`  selling agent run: HTTP ${r.status()}`);
  const page = await ctx.newPage();
  await page.goto("/ops/offers");
  await page.waitForTimeout(3500);
  await shoot(page, "agent-seller", "desktop", "The wholesaler's selling agent: signed offers it made, and the ones its guardrails held back with the rule.");
  await ctx.close();
}

/** The menu planner, in the agent's workspace on a desk. */
async function menu(browser: Browser) {
  const kitchen = "kahvila-sointu";
  const ctx = await context(browser, "desktop");
  await signInKitchen(ctx, kitchen);
  await resetThread(ctx, kitchen);
  const page = await ctx.newPage();
  await page.goto(`/k/${kitchen}`);
  await page.waitForTimeout(2500);
  await say(page, "Plan a lunch for 10 people on Monday");
  let t = await idle(ctx, kitchen, 1, 180_000);
  await page.waitForTimeout(2500);
  await shoot(page, "agent-menu", "desktop", "The menu planner in the agent: dishes for the covers, what the kitchen has, what must be ordered.");
  const m = cardsOf(t).filter((c) => c.type === "menu").at(-1);
  if (m?.type === "menu" && m.stage === "choose") {
    await say(page, "the first one");
    t = await idle(ctx, kitchen, 2, 180_000);
    await page.waitForTimeout(2500);
    await shoot(page, "agent-menu-sheet", "desktop", "A menu chosen: each dish's ingredients matched to products, with the total for the covers.");
  }
  await ctx.close();
}

/** Voice mode with Chromium's fake microphone. */
async function voice(browser: Browser) {
  const kitchen = "kahvila-sointu";
  const ctx = await context(browser, "phone", { permissions: ["microphone"] });
  await signInKitchen(ctx, kitchen);
  await resetThread(ctx, kitchen);
  const page = await ctx.newPage();
  await page.goto(`/k/${kitchen}`);
  await page.waitForTimeout(2500);
  await shoot(page, "agent-seller-phone", "phone", "The wholesaler's selling agent, as the kitchen sees it: one signed offer, cheaper per litre than its weekly milk, and a question.");
  const mic = page.getByRole("button", { name: /microphone|speak|talk|voice/i }).first();
  await mic.click({ timeout: 10_000 });
  await page.waitForTimeout(6000);
  await shoot(page, "agent-voice", "phone", "Speaking to the agent: hold to talk, or leave the microphone open in a loud kitchen.", { quiet: false });
  await page.getByRole("button", { name: /End call/i }).click().catch(() => undefined);
  await ctx.close();
}

/** /try: connect your own agent. */
async function outside(browser: Browser) {
  const ctx = await context(browser, "desktop");
  const page = await ctx.newPage();
  await page.goto("/try");
  await page.waitForTimeout(2500);
  await shoot(page, "agent-outside", "desktop", "Connect your own agent: the MCP address, the OpenAPI document, a mandate to try with.");
  await ctx.close();
}

/** The receipt and a "something changed" mail, as sent (HTML kept outside the repository). */
async function mail(browser: Browser) {
  const dir = opt("--mail-dir", "/Users/macbookair/dock-shots/mail/sent")!;
  const ctx = await browser.newContext({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  for (const [file, key, caption] of [
    ["02-receipt.html", "mail-receipt", "The receipt: each line, VAT, who decided, and a link to verify the wholesaler's signature."],
    ["07-changed-cannot_come.html", "mail-changed", "Something changed: a product that cannot come, why, and the substitutes, good, better, best."],
  ] as const) {
    const f = path.join(dir, file);
    if (!fs.existsSync(f)) {
      failed.push(`${key}: ${f} not found`);
      continue;
    }
    await page.goto(`file://${f}`);
    await page.waitForTimeout(500);
    await shoot(page, key, "mail", caption, { fullPage: true });
  }
  await ctx.close();
}

/** The wall, at its address (/wall; the landing page is at /). */
async function wall(browser: Browser) {
  const ctx = await context(browser, "desktop");
  const page = await ctx.newPage();
  await page.goto("/wall");
  await page.getByRole("heading", { name: "Scan to become the approver" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await shoot(page, "wall", "desktop", "The wall: live requests passing the gate, the totals, and the code a visitor scans to become the approver.", { quiet: false });
  await ctx.close();
}

// ------------------------------------------------------------------ the hero reel (landing v2)

const REEL_DIR = path.join(OUT, "reel");
const REEL_MANIFEST = path.join(WEB, "src/app/_landing2/reel.json");
const REEL_THREAD = path.join(WEB, "src/app/_landing2/reel-thread.json");
const REEL_MAX = 60 * 1024;
type ReelFrame = { key: string; src: string; w: number; h: number; caption: string };
const reelFrames: ReelFrame[] = [];
fs.mkdirSync(path.dirname(REEL_MANIFEST), { recursive: true });

/** One frame of the reel as the phone shows it at that instant: motion left running, 600 px wide, under 60 KB. */
async function snap(page: Page, key: string, caption: string) {
  try {
    fs.mkdirSync(REEL_DIR, { recursive: true });
    const png = path.join(TMP, `${key}.png`);
    await page.screenshot({ path: png, caret: "hide" });
    const out = path.join(REEL_DIR, `${key}.webp`);
    let bytes = 0;
    for (const q of [80, 74, 68, 62, 56, 50, 44, 38, 32]) {
      execFileSync(CWEBP, ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-resize", "600", "0", png, "-o", out]);
      bytes = fs.statSync(out).size;
      if (bytes <= REEL_MAX) break;
    }
    const buf = fs.readFileSync(out);
    const fourcc = buf.toString("ascii", 12, 16);
    let w = 0;
    let h = 0;
    if (fourcc === "VP8X") {
      w = 1 + buf.readUIntLE(24, 3);
      h = 1 + buf.readUIntLE(27, 3);
    } else if (fourcc === "VP8 ") {
      w = buf.readUInt16LE(26) & 0x3fff;
      h = buf.readUInt16LE(28) & 0x3fff;
    }
    const i = reelFrames.findIndex((f) => f.key === key);
    const f = { key, src: `/landing/reel/${key}.webp`, w, h, caption };
    if (i >= 0) reelFrames[i] = f;
    else reelFrames.push(f);
    fs.writeFileSync(REEL_MANIFEST, JSON.stringify({ frames: reelFrames }, null, 2) + "\n");
    done.push(`reel/${key} ${w}x${h} ${(bytes / 1024).toFixed(0)} KB`);
    console.log(`  frame ${key} (${w}x${h}, ${(bytes / 1024).toFixed(1)} KB)`);
  } catch (e) {
    failed.push(`reel/${key}: ${(e as Error).message.split("\n")[0]}`);
    console.log(`  FAILED reel/${key}: ${(e as Error).message.split("\n")[0]}`);
  }
}

/** The thread as the product wrote it, without ids, tokens or signatures: the words the landing page may quote. */
function threadForPage(t: Thread, seen: { at: number; label: string; detail?: string; status: string }[], shown: { after: string; steps: string[] }[]) {
  return {
    note: "Written by scripts/landing-shots.ts (stage reel) from GET /ui-api/kitchens/hotel-lumo/thread, the product's own words, unedited. Ids, signatures and approval ids removed.",
    capturedAt: new Date().toISOString(),
    kitchen: "hotel-lumo",
    turns: t.turns.map((x) =>
      x.role === "buyer"
        ? { role: "buyer", text: x.text, label: x.label, via: x.via }
        : {
            role: "agent",
            status: x.status,
            line: x.line,
            steps: x.steps.map((st) => ({ kind: st.kind, label: st.label, detail: st.detail, status: st.status })),
            cards: x.cards.map((c) => {
              if (c.type === "options")
                return {
                  type: "options",
                  options: c.options.map((o) => ({ rank: o.rank, title: o.title, totalCents: o.totalCents, deliveryDate: o.deliveryDate, signOff: o.signOff, pros: o.pros, cons: o.cons, lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, substituteForName: l.substituteForName })) })),
                  preselected: c.preselected?.reason,
                  excluded: c.excluded,
                  notes: c.notes,
                };
              if (c.type === "gate") return { type: "gate", outcome: c.outcome, rule: c.rule, reasons: c.reasons, said: c.said?.en, approver: c.approver, rules: c.rules?.map((r) => ({ rule: r.rule, outcome: r.outcome })) };
              if (c.type === "order") return { type: "order", status: c.status, totalCents: c.totalCents, deliveryDate: c.deliveryDate, lines: c.lines.map((l) => ({ name: l.name })), authorised: c.authorised, signedConfirmation: Boolean(c.confirmation) };
              return { type: c.type };
            }),
          },
    ),
    stepsAsTheyAppeared: seen,
    stepsViewAsShown: shown,
  };
}

/** The words of an opened "N steps" view, as the buyer reads them (the store's view, built from the turn's cards). */
async function stepsShown(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-expanded="true"]')].filter((x) => /^\s*\d+ steps?\s*$/.test((x as HTMLElement).innerText)).at(-1);
    if (!b) return [];
    let box: Element | null = b.parentElement;
    for (let i = 0; i < 4 && box && !box.querySelector("li"); i++) box = box.parentElement;
    return box ? [...box.querySelectorAll("li")].map((li) => (li as HTMLElement).innerText.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  });
}

/** The partner's example once, on a phone, frame by frame: what the hero reel and the scroll story show. */
async function reel(browser: Browser) {
  const kitchen = "hotel-lumo";
  // Motion on: the frames must show the line drawing and the steps turning, as a buyer sees them.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/Helsinki", baseURL: base });
  await ctx.addCookies([{ name: "aimopilot-lang", value: "en", url: base! }]);
  const page = await ctx.newPage();
  await passkey(page);
  await resetTestAccounts(browser);
  await signInKitchen(ctx, kitchen);
  await resetThread(ctx, kitchen);
  await page.goto(`/k/${kitchen}`);
  await page.waitForTimeout(3000);
  await quiet(page);

  const field = page.getByRole("textbox").last();
  await field.click();
  await field.pressSequentially(MILK, { delay: 12 });
  // The field scrolls with the caret; back to the start so the request reads from its first word.
  await field.evaluate((el) => {
    const f = el as HTMLInputElement | HTMLTextAreaElement;
    f.setSelectionRange(0, 0);
    f.scrollLeft = 0;
    f.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  await snap(page, "r01-typed", "The buyer's request typed into the agent's composer on a phone, not yet sent.");

  // Watch the steps as the product writes them while the frames are taken.
  const seen: { at: number; label: string; detail?: string; status: string }[] = [];
  const shown: { after: string; steps: string[] }[] = [];
  const t0 = Date.now();
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const t = await threadOf(ctx, kitchen).catch(() => undefined);
      const a = t && lastAgent(t);
      for (const st of a?.steps ?? []) {
        const k = `${st.label}|${st.status}`;
        if (!seen.some((x) => `${x.label}|${x.status}` === k)) seen.push({ at: Date.now() - t0, label: st.label, detail: st.detail, status: st.status });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  await field.press("Enter");
  await page.waitForTimeout(900);
  await snap(page, "r02-reading", "Sent: the buyer's words in the thread and the agent's first step line turning.");
  await page.waitForTimeout(2600);
  await snap(page, "r03-working", "The agent at work: step lines ticking off as the thread's line draws down.");
  await page.waitForTimeout(2600);
  const stillWorking = await threadOf(ctx, kitchen).then((t) => lastAgent(t)?.status === "working").catch(() => false);
  if (stillWorking) await snap(page, "r03b-working", "Further on: more steps done, the agent still working.");

  let t = await idle(ctx, kitchen, 1);
  await page.waitForTimeout(1800);
  await quiet(page);
  const reply = page.locator("li, article, section").filter({ hasText: /cut-off|can't arrive|cannot arrive|in time/i }).last();
  if (await reply.count()) await topAlign(page, reply, 40).catch(() => undefined);
  await snap(page, "r04-reply", "The reply: the usual 10 l boxes can't arrive in time, so it would come as one-litre cartons; which one?");

  if (await openSteps(page)) {
    const steps = page.getByRole("button", { name: /^\d+ steps?$/ }).last();
    await topAlign(page, steps, 120).catch(() => undefined);
    await page.waitForTimeout(500);
    await snap(page, "r05-steps", "The same reply with its steps opened: request read, history, the assortment searched, live price for a few, the rest left out and why.");
    shown.push({ after: MILK, steps: await stepsShown(page) });
    await steps.click().catch(() => undefined);
    await page.waitForTimeout(500);
  }
  const opts = cardsOf(t).filter((c) => c.type === "options").at(-1);
  const firstName = opts?.type === "options" ? opts.options[0]?.lines[0]?.name : undefined;
  if (firstName) await topAlign(page, page.getByText(firstName, { exact: false }).last(), 140).catch(() => undefined);
  await page.waitForTimeout(500);
  await snap(page, "r06-options", "The three options in one-litre cartons, each with its fixed total, price per litre and Monday delivery.");

  // The buyer picks, as a person would type it.
  const f2 = page.getByRole("textbox").last();
  await f2.click();
  await f2.pressSequentially("the first one", { delay: 15 });
  await f2.press("Enter");
  await page.waitForTimeout(1500);
  await snap(page, "r07-choice", "\"the first one\" sent; the agent takes the order to the gate.");
  let buyers = 2;
  let approvalId: string | undefined;
  for (let i = 0; i < 3 && !approvalId; i++) {
    t = await idle(ctx, kitchen, buyers);
    const waiting = cardsOf(t).find((c) => c.type === "gate" && c.outcome === "waiting" && c.approvalId);
    if (waiting?.type === "gate") approvalId = waiting.approvalId;
    else {
      const a = lastAgent(t)!;
      const q = a.cards.find((c) => c.type === "question");
      await say(page, q?.type === "question" ? (q.questions[0]?.options[0]?.label ?? "yes") : "yes, order it");
      buyers++;
    }
  }
  if (!approvalId) throw new Error("no sign-off was asked for");
  await page.waitForTimeout(1500);
  await quiet(page);
  const slab = page.locator('[data-slab="waiting"]').last();
  if (await slab.count()) await topAlign(page, slab, 160).catch(() => undefined);
  await page.waitForTimeout(400);
  await snap(page, "r08-gate", "Over the 500 € the agent may spend alone: the dark slab, needs your OK, with OK with Face ID.");

  // The sign-off page for this same order, on this phone; the virtual authenticator answers the passkey.
  const ap = await ctx.newPage();
  await ap.goto(`/approve/${approvalId}`);
  const approve = ap.getByRole("button", { name: /^Approve \d/ });
  let approvedOnPage = false;
  if (await approve.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) {
    await ap.waitForTimeout(1200);
    await snap(ap, "r09-approve", "The sign-off page on the phone: stopped at the gate, the total, why you are asked, Approve with a passkey.");
    await approve.click();
    approvedOnPage = await ap.getByText(/Signed off|Order placed/).first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
    if (approvedOnPage) {
      await ap.waitForTimeout(2200);
      await ap.evaluate(() => window.scrollTo(0, 0));
      await snap(ap, "r10-signed", "Signed off with a passkey: the stamp with the signer's name, and the order placed.");
    }
  } else console.log("  the sign-off page did not offer Approve on this session; signing in the thread instead");
  await ap.close();
  if (!approvedOnPage) {
    // The test account's own phone is the kitchen's signer (the slab says so): the passkey is asked in the thread.
    // A virtual authenticator answers at once and shows nothing, so the frame is the card just after the passkey signed.
    await page.getByRole("button", { name: /^OK with Face ID$/ }).last().click({ timeout: 20_000 });
    await page.waitForTimeout(1600);
    await snap(page, "r09-ok-given", "OK with Face ID tapped and signed with this phone's passkey: the card turns to OK given, OK'd by the kitchen manager.");
  }
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    t = await threadOf(ctx, kitchen);
    if (cardsOf(t).some((c) => c.type === "order" && c.status === "committed")) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForTimeout(3000);
  await quiet(page);
  const okd = page.getByText(/OK'd by/).last();
  if (await okd.count()) await topAlign(page, okd, 420).catch(() => undefined);
  await page.waitForTimeout(400);
  await snap(page, "r11-thread-signed", "Back in the thread: OK'd by the kitchen manager, the order placed at the quoted price for Monday.");

  if (await openSteps(page)) shown.push({ after: "the first one", steps: await stepsShown(page) });
  watching = false;
  await watcher;
  t = await threadOf(ctx, kitchen);
  fs.writeFileSync(REEL_THREAD, JSON.stringify(threadForPage(t, seen, shown), null, 2) + "\n");
  console.log(`  thread written (${t.turns.length} turns; approved ${approvedOnPage ? "on the sign-off page" : "in the thread"})`);
  await ctx.close();
}

// ------------------------------------------------------------------ the agent inside the shop (landing v2, "webshop")

/**
 * The store as a kitchen already uses it, with its buying agent docked beside the catalogue: the partner's milk
 * request from the closed panel to the sign-off, at 1440 x 900 (2x), and the same moments on a 390 px phone (2x).
 * The landing page cross-fades these as the reader scrolls. Run on a server with DOCK_SAMPLE_ACTIVITY=off so no
 * sample orders sit in the shot. Desktop frames are written 1920 px wide (the section shows them up to ~960 CSS px
 * wide, so 2x), phone frames 780 px; each under 170 KB / 80 KB. Listed in src/app/_landing2/webshop.json.
 */
async function webshop(browser: Browser) {
  const kitchen = "hotel-lumo";
  const SEARCH = "lactose-free milk";
  const DESK_O = { width: 1920, max: 170 * 1024, webshop: true };
  const PHONE_O = { width: 780, max: 80 * 1024, webshop: true };
  await resetTestAccounts(browser);
  const desk = await context(browser, "desktop");
  await signInKitchen(desk, kitchen);
  await resetThread(desk, kitchen);
  const phone = await browser.newContext({ ...PHONE, deviceScaleFactor: 2, ...COMMON, baseURL: base });
  await phone.addCookies([{ name: "aimopilot-lang", value: "en", url: base! }, ...(await desk.cookies())]);
  const page = await desk.newPage();
  await passkey(page);
  const pp = await phone.newPage();
  const shop = `/k/${kitchen}/catalogue?q=${encodeURIComponent(SEARCH)}`;
  // The catalogue scrolled so its first row of milk sits just under the store's sticky header.
  const toCards = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    const badge = page.locator("main").getByText("Chilled", { exact: true }).first();
    if (await badge.count()) {
      const y = await badge.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), Math.max(0, y - 165));
    }
    await page.waitForTimeout(500);
  };
  const panel = page.locator("#assistant");
  // The agent's opening note (what it noticed before the kitchen did) keeps its steps open; fold them, as a buyer
  // would, so the request and its answer have the room.
  const fold = async (p: Page) => {
    const first = p.locator("#assistant button[aria-expanded]").filter({ hasText: /^\s*\d+ steps?\s*$/ }).first();
    if ((await first.getAttribute("aria-expanded").catch(() => null)) === "true") await first.click().catch(() => undefined);
    await p.waitForTimeout(400);
  };


  // 1. The shop as the kitchen knows it: milk searched in the catalogue, the agent's panel closed.
  await page.goto(shop);
  await page.waitForTimeout(2500);
  await quiet(page);
  await fold(page);
  const close = panel.getByRole("button", { name: /close/i });
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.mouse.move(700, 450);
  await page.waitForTimeout(800);
  await toCards();
  await shoot(page, "shop-1-catalogue", "desktop", "The kitchen's webshop on a desk: the catalogue searched for lactose-free milk, the buying agent's panel closed.", DESK_O);

  // 2. Ctrl K: the panel opens beside the catalogue and the buyer asks; the agent's steps under way.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(800);
  await toCards();
  await say(page, MILK, true);
  await page.waitForTimeout(900);
  await fold(page);
  await shoot(page, "shop-2-asked", "desktop", "Ctrl K opens the agent beside the same catalogue; the buyer's request sent and the agent's steps under way.", { ...DESK_O, quiet: false });

  // 3. The reply: the usual milk cannot make Monday, so a substitute, at fixed prices.
  let t = await idle(desk, kitchen, 1);
  await page.waitForTimeout(1500);
  await quiet(page);
  await fold(page);
  await toCards();
  const said = MILK;
  const reply = panel.getByText(said).last();
  if (await reply.count()) await topAlign(page, reply, 70).catch(() => undefined);
  await shoot(page, "shop-3-substitute", "desktop", "The agent's answer beside the catalogue: the usual milk misses the cut-off, a substitute that arrives Monday, priced live.", DESK_O);
  await pp.goto(`${shop}&agent=open`);
  await pp.waitForTimeout(3000);
  await quiet(pp);
  await fold(pp);
  const preply = pp.locator("#assistant").getByText(said).last();
  if (await preply.count()) await topAlign(pp, preply, 105).catch(() => undefined);
  await shoot(pp, "shop-phone-substitute", "phone", "The same answer on a phone: the agent full screen over the shop, the substitute and its price.", PHONE_O);

  // 4. The buyer picks; over the kitchen's limit, the order waits for a named person's passkey.
  const opts = cardsOf(t).filter((c) => c.type === "options").at(-1);
  await say(page, opts?.type === "options" && opts.options.length > 1 ? "the first one" : "yes, order it", true);
  let buyers = 2;
  let approvalId: string | undefined;
  for (let i = 0; i < 3 && !approvalId; i++) {
    t = await idle(desk, kitchen, buyers);
    const waiting = cardsOf(t).find((c) => c.type === "gate" && c.outcome === "waiting" && c.approvalId);
    if (waiting?.type === "gate") approvalId = waiting.approvalId;
    else {
      const q = lastAgent(t)!.cards.find((c) => c.type === "question");
      await say(page, q?.type === "question" ? (q.questions[0]?.options[0]?.label ?? "yes") : "yes, order it", true);
      buyers++;
    }
  }
  if (!approvalId) throw new Error("no sign-off was asked for");
  await page.waitForTimeout(1500);
  await quiet(page);
  await fold(page);
  await toCards();
  const over = /^the first one$|^yes, order it$/;
  const line = panel.getByText(over).last();
  if (await line.count()) await topAlign(page, line, 75).catch(() => undefined);
  await shoot(page, "shop-4-signoff", "desktop", "Over the kitchen's limit: in the same panel the order waits for the named person's OK with a passkey.", DESK_O);
  await pp.goto(`${shop}&agent=open`);
  await pp.waitForTimeout(3000);
  await quiet(pp);
  await fold(pp);
  const pline = pp.locator("#assistant").getByText(over).last();
  if (await pline.count()) await topAlign(pp, pline, 105).catch(() => undefined);
  await shoot(pp, "shop-phone-signoff", "phone", "The sign-off on a phone: the order waits for the named person's OK with a passkey.", PHONE_O);
  await phone.close();
  await desk.close();
}

const STAGES: Record<string, (b: Browser) => Promise<void>> = { milk, signoff, refused, ops, watch, seller, voice, menu, outside, mail, wall, reel, webshop };

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  for (const [name, fn] of Object.entries(STAGES)) {
    if (only && !only.includes(name)) continue;
    console.log(`stage ${name}`);
    const t0 = Date.now();
    try {
      await fn(browser);
    } catch (e) {
      failed.push(`stage ${name}: ${(e as Error).message.split("\n")[0]}`);
      console.log(`  stage ${name} FAILED: ${(e as Error).message.split("\n")[0]}`);
    }
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();
  const total = Object.keys(manifest).reduce((s, k) => s + (fs.existsSync(path.join(OUT, `${k}.webp`)) ? fs.statSync(path.join(OUT, `${k}.webp`)).size : 0), 0);
  console.log(`\n${done.length} shots this run; ${Object.keys(manifest).length} in the manifest, ${(total / 1024 / 1024).toFixed(2)} MB in all.`);
  if (failed.length) console.log(`Not made:\n  ${failed.join("\n  ")}`);
  fs.rmSync(TMP, { recursive: true, force: true });
})();
