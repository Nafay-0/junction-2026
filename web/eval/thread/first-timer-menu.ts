/**
 * The partner's two menu scenarios, end to end on a phone-sized browser, as a first-timer would do them:
 *
 *   pnpm tsx eval/thread/first-timer-menu.ts --url http://localhost:PORT [--lang en|fi] [--out dir] [--account hotel-lumo] [--only 1,2]
 *
 *   1 need -> recipe -> order: "plan next week's lunch for 40 around what is in season": the menu says what is in
 *     season, proposes what the kitchen probably still has as in stock (shown, left as counted), and is ordered.
 *   2 last-minute event: an unexpected booking for the soonest delivery day: a line that cannot arrive in time is
 *     flagged with why and a way out by the dish's logic; the way out is used, and the menu is ordered.
 *
 * Per scenario: seconds from the first words to the placed order, taps, messages typed, questions the agent asked.
 * Real models (cents). Screenshots at the end of each to --out.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { Card, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4541")!;
const out = opt("--out");
const lang = (opt("--lang", "en") as "en" | "fi")!;
const accountName = opt("--account", "hotel-lumo")!;
const only = opt("--only")?.split(",").map(Number);
const account = TEST_ACCOUNTS.find((a) => a.username === accountName)!;
if (out) fs.mkdirSync(out, { recursive: true });

/** The soonest delivery day in words: tomorrow, unless tomorrow is a Sunday (no deliveries), then Monday. */
const sunday = new Date(Date.now() + 86_400_000).getUTCDay() === 0;
const L = {
  en: {
    seasonal: "Plan next week's lunch for 40 around what is in season",
    lastMinute: `Unexpected booking: moose stew and rye bread lunch for 30 ${sunday ? "on Monday" : "tomorrow"}`,
    cook: /^Cook this$/,
    toSheet: /^Put on the order sheet$/,
    useThis: /^Use this$/,
    inSeason: /In season:/,
    stock: /You probably still have .+ delivery; counted as in stock\./,
    order: /^(Order this|Send to .+ for an OK)/,
    yes: /^(Yes, that is right|Keep it)/,
    swap: /^Swap$/,
    choose: /^Choose this$/,
    takeOff: /^Take it off this order$/,
    lookAgain: /^Find other options for this$/,
  },
  fi: {
    seasonal: "Suunnittele ensi viikon lounas 40 hengelle sesongin raaka-aineista",
    lastMinute: `Yllätysvaraus: hirvikäristys ja ruisleipä lounaaksi 30 hengelle ${sunday ? "maanantaiksi" : "huomiseksi"}`,
    cook: /^Valitse tämä$/,
    toSheet: /^Vie tilauslomakkeelle$/,
    useThis: /^Käytä tätä$/,
    inSeason: /Sesongissa:/,
    stock: /Teillä on todennäköisesti vielä .+ toimituksesta; laskettu varastoon\./,
    order: /^(Tilaa(,| tämä)|Lähetä hyväksyttäväksi)/,
    yes: /^(Kyllä, tämä on oikein|Pidä)/,
    swap: /^Vaihda$/,
    choose: /^Valitse tämä$/,
    takeOff: /^Poista se tästä tilauksesta$/,
    lookAgain: /^Etsi tälle muita vaihtoehtoja$/,
  },
}[lang];

type Result = { task: string; ok: boolean; seconds: number; taps: number; typed: number; questions: number; note?: string };

const cardsOf = (t: Thread | undefined): Card[] => (t?.turns ?? []).flatMap((x) => (x.role === "agent" ? x.cards : []));
const menuOf = (t: Thread | undefined) => cardsOf(t).findLast((c) => c.type === "menu");
const ordered = (t: Thread) => cardsOf(t).some((c) => c.type === "order" && (c.status === "committed" || c.status === "pending_approval"));

class Run {
  taps = 0;
  typed = 0;
  t0 = Date.now();
  constructor(readonly page: Page) {}
  get log() {
    return this.page.getByRole("log").first();
  }
  async thread(): Promise<Thread | undefined> {
    const r = await this.page.request.get(`${base}/ui-api/kitchens/${account.username}/thread`);
    return r.ok() ? ((await r.json()) as { thread: Thread }).thread : undefined;
  }
  async say(words: string) {
    const field = this.page.getByRole("textbox").last();
    await field.fill(words);
    await field.press("Enter");
    this.typed++;
  }
  async tap(l: Locator) {
    await l.scrollIntoViewIfNeeded().catch(() => undefined);
    await l.click();
    this.taps++;
  }
  async until(test: (t: Thread) => boolean, timeout = 150_000): Promise<Thread> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const t = await this.thread();
      if (t && test(t)) return t;
      await this.page.waitForTimeout(700);
    }
    throw new Error("timed out waiting for the thread");
  }
  async questions(): Promise<number> {
    return cardsOf(await this.thread()).reduce((n, c) => n + (c.type === "question" ? c.questions.length : c.type === "anomaly" ? c.concerns.length : 0), 0);
  }
  /** The menu card ready (a menu chosen first if the words left it open), with the planner's ways out in. */
  async menuReady(): Promise<void> {
    const cook = this.log.getByRole("button", { name: L.cook }).first();
    const end = Date.now() + 150_000;
    while (Date.now() < end) {
      const m = menuOf(await this.thread());
      if (m?.type === "menu" && m.stage === "ready" && m.dishes.length) break;
      if (m?.type === "menu" && m.stage === "choose" && (await cook.isVisible().catch(() => false))) {
        await this.tap(cook);
        await this.page.waitForTimeout(1500);
      }
      await this.page.waitForTimeout(700);
    }
    await this.page.waitForTimeout(12_000); // the ways out for stuck lines arrive a few seconds after the card
  }
  /** Put the menu on the order sheet and order it, as a first-timer gets through the sheet. */
  async orderIt(): Promise<Thread> {
    const toSheet = this.log.getByRole("button", { name: L.toSheet }).last();
    await toSheet.waitFor({ timeout: 30_000 });
    await this.tap(toSheet);
    await this.until((t) => cardsOf(t).some((c) => c.type === "sheet"), 60_000);
    const confirm = this.log.getByRole("button", { name: L.order }).last();
    const yes = this.log.getByRole("button", { name: L.yes }).last();
    const swap = this.log.getByRole("button", { name: L.swap }).first();
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      if ((await confirm.isVisible().catch(() => false)) && (await confirm.isEnabled().catch(() => false))) {
        await this.tap(confirm);
        return this.until(ordered, 60_000);
      }
      if (await yes.isVisible().catch(() => false)) await this.tap(yes);
      if (await swap.isVisible().catch(() => false)) {
        await this.tap(swap);
        const choose = this.log.getByRole("button", { name: L.choose }).first();
        const takeOff = this.log.getByRole("button", { name: L.takeOff }).first();
        await choose.or(takeOff).first().waitFor({ timeout: 30_000 });
        await this.tap((await choose.isVisible().catch(() => false)) ? choose : takeOff);
        await this.page.waitForTimeout(1500);
        continue;
      }
      await this.page.waitForTimeout(500);
    }
    throw new Error("the order sheet never offered its button");
  }
}

async function task(name: string, n: number, body: (r: Run) => Promise<string | void>): Promise<Result> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "fi" ? "fi-FI" : "en-GB" });
  const page = await ctx.newPage();
  const s = await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (s.status() !== 200) throw new Error(`sign-in: HTTP ${s.status()}`);
  await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/reset`, { data: {} });
  await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  await page.goto(`${base}/k/${account.username}`);
  await page.getByRole("log").first().waitFor({ timeout: 30_000 });
  const r = new Run(page);
  let result: Result;
  try {
    r.t0 = Date.now();
    const note = await body(r);
    result = { task: name, ok: true, seconds: Math.round((Date.now() - r.t0) / 100) / 10, taps: r.taps, typed: r.typed, questions: await r.questions(), ...(note ? { note } : {}) };
  } catch (err) {
    result = { task: name, ok: false, seconds: Math.round((Date.now() - r.t0) / 100) / 10, taps: r.taps, typed: r.typed, questions: await r.questions().catch(() => 0), note: (err as Error).message.split("\n")[0].slice(0, 200) };
  }
  if (out) await page.screenshot({ path: path.join(out, `menu-${lang}-${n}-${result.ok ? "done" : "failed"}.png`), fullPage: false });
  // Clean slate for the next run: take back what this one placed.
  for (const c of cardsOf(await r.thread())) {
    if (c.type === "order" && (c.status === "pending_approval" || c.status === "committed"))
      await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/turns`, { data: { door: "typed", via: "tap", action: { type: "withdraw", orderId: c.orderId }, label: "clean-up", clientTurnId: `cleanup-${c.orderId}` } }).catch(() => undefined);
  }
  await page.waitForTimeout(1500);
  await browser.close();
  return result;
}

const TASKS: [string, (r: Run) => Promise<string | void>][] = [
  [
    "need -> recipe -> order: a seasonal lunch for 40, with what is probably in stock",
    async (r) => {
      await r.say(L.seasonal);
      await r.menuReady();
      const m = menuOf(await r.thread());
      if (m?.type !== "menu") throw new Error("no menu card");
      const seasonal = m.dishes.filter((d) => d.season?.length).map((d) => `${d.name} (${d.season!.map((x) => x.name[lang]).join(", ")})`);
      if (!seasonal.length) throw new Error("no dish says what is in season");
      await r.log.getByText(L.inSeason).first().waitFor({ timeout: 10_000 });
      const stock = m.dishes.flatMap((d) => d.lines).filter((l) => l.stock);
      if (stock.length) await r.log.getByText(L.stock).first().waitFor({ timeout: 10_000 });
      const t = await r.orderIt();
      const o = cardsOf(t).findLast((c) => c.type === "order");
      return `in season: ${seasonal.slice(0, 2).join("; ")}; counted as in stock: ${stock.map((l) => `${l.ingredient} ${l.stock!.amount} ${l.stock!.unit}`).join(", ") || "none"}; order ${o?.type === "order" ? `${o.lines.length} lines, ${o.status}` : "?"}`;
    },
  ],
  [
    "last-minute event: what cannot arrive in time is flagged, the dish's way out used",
    async (r) => {
      await r.say(L.lastMinute);
      await r.menuReady();
      const m = menuOf(await r.thread());
      if (m?.type !== "menu") throw new Error("no menu card");
      const late = m.dishes.flatMap((d) => d.lines).filter((l) => l.late?.way);
      if (!late.length) throw new Error(`no line flagged with a way out (late lines: ${m.dishes.flatMap((d) => d.lines).filter((l) => l.conflicts.some((c) => c.code === "cannot_arrive")).length})`);
      const use = r.log.getByRole("button", { name: L.useThis }).first();
      await use.waitFor({ timeout: 10_000 });
      await r.tap(use);
      await r.until((t) => {
        const mm = menuOf(t);
        return mm?.type === "menu" && !mm.dishes.flatMap((d) => d.lines).some((l) => l.lineId === late[0].lineId && l.late);
      }, 60_000);
      const t = await r.orderIt();
      const o = cardsOf(t).findLast((c) => c.type === "order");
      return `flagged: ${late.map((l) => `${l.ingredient} -> ${l.late!.way!.title}`).join("; ")}; order ${o?.type === "order" ? `${o.lines.length} lines, ${o.status}` : "?"}`;
    },
  ],
];

(async () => {
  const results: Result[] = [];
  for (const [i, [name, body]] of TASKS.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const res = await task(name, i + 1, body);
    results.push(res);
    console.log(`${i + 1}. ${name}: ${res.ok ? "done" : "FAILED"} in ${res.seconds} s, ${res.taps} taps, ${res.typed} typed, ${res.questions} question${res.questions === 1 ? "" : "s"}${res.note ? `; ${res.note}` : ""}`);
  }
  console.log(`\n${lang}: ${results.filter((r) => r.ok).length}/${results.length} done`);
  if (out) fs.writeFileSync(path.join(out, `first-timer-menu-${lang}.json`), JSON.stringify(results, null, 2));
})();
