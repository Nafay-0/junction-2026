/**
 * A first-timer on a phone-sized browser, eight everyday tasks in the kitchen's agent, each from a fresh conversation:
 *
 *   pnpm tsx eval/thread/first-timer.ts --url http://localhost:PORT [--lang en|fi] [--out dir] [--account hotel-lumo] [--only 3,5]
 *
 * For every task: seconds from the first words to done, taps, messages typed, and how many questions the agent asked
 * (question cards and mistake checks, from the thread's own records). More than one question in a task is a defect
 * to explain. Real models (cents). Screenshots of the end of each task go to --out.
 *
 *   1 order the usual            5 move it to Thursday (on the order, before ordering)
 *   2 order something new        6 plan a lunch for 40 and order it
 *   3 make it 200 instead of 100 7 OK an order over the limit (passkey on this device)
 *   4 pick the lactose-free one  8 take one back
 *   9 and 10: two orders in one conversation, the second after a person's OK, typed and through the order sheet
 *  11 reorder last week's order (asked in words, "order again" on the list)   12 pause a standing order (from the landing screen)
 *  13 two items in one message (milk and oat drink for Thursday): one order sheet, the oat drink an oat drink, Thursday
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { Card, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const out = opt("--out");
const lang = (opt("--lang", "en") as "en" | "fi")!;
const accountName = opt("--account", "hotel-lumo")!;
const only = opt("--only")?.split(",").map(Number);
const account = TEST_ACCOUNTS.find((a) => a.username === accountName)!;
if (out) fs.mkdirSync(out, { recursive: true });

/** What a first-timer types, and the words on the buttons they tap, per language. */
const L = {
  en: {
    usual: "Order the usual",
    oat: "20 litres of oat drink for Friday",
    hundred: "100 litres of lactose-free milk for Friday",
    make200: "make it 200",
    milk: "200 litres of milk for Friday",
    fifty: "50 litres of lactose-free milk for Friday",
    lunch: "Plan a lunch for 40 on Friday",
    big: "I need 1,000 litres of lactose-free milk by Monday",
    order: /^(Order this|Send to .+ for an OK)/,
    adjust: /^Change amount, day or product$/,
    sheetChange: /^Change amount, day or product$/,
    yes: /^(Yes, that is right|Keep it)/,
    lactose: /lactose-free/i,
    cook: /^Cook this$/,
    toSheet: /^Put on the order sheet$/,
    sign: /^(Add this device and sign|Sign with this device)$/,
    takeBack: /^Take it back/,
    thursday: /^Thu /,
    swap: /^Swap$/,
    choose: /^Choose this$/,
    skip: /^No preference: show me the options$/,
    takeOff: /^Take it off this order$/,
    lookAgain: /^Find other options for this$/,
    lastWeek: "what did we order last week?",
    twoItems: "400 litres of lactose-free milk and 24 litres of oat drink for Thursday",
    oatName: /oat/i,
    again: /^Order again$/,
    recurring: /^Recurring orders$/,
  },
  fi: {
    usual: "Tilaa tavalliset",
    oat: "20 litraa kauramaitoa perjantaiksi",
    hundred: "100 litraa laktoositonta maitoa perjantaiksi",
    make200: "tee siitä 200",
    milk: "200 litraa maitoa perjantaiksi",
    fifty: "50 litraa laktoositonta maitoa perjantaiksi",
    lunch: "Suunnittele lounas 40 hengelle perjantaiksi",
    big: "Tarvitsen 1 000 litraa laktoositonta maitoa maanantaiksi",
    order: /^(Tilaa|Lähetä hyväksyttäväksi)/,
    adjust: /^Muuta määrää, päivää tai tuotetta$/,
    sheetChange: /^Muuta määrää, päivää tai tuotetta$/,
    yes: /^(Kyllä, tämä on oikein|Pidä)/,
    lactose: /laktoositon/i,
    cook: /^Valitse tämä$/,
    toSheet: /^Vie tilauslomakkeelle$/,
    sign: /^(Lisää tämä laite ja hyväksy|Hyväksy tällä laitteella)$/,
    takeBack: /^Peru tilaus/,
    thursday: /^to /,
    swap: /^Vaihda$/,
    choose: /^Valitse tämä$/,
    skip: /^Ei väliä: näytä vaihtoehdot$/,
    takeOff: /^Poista se tästä tilauksesta$/,
    lookAgain: /^Etsi tälle muita vaihtoehtoja$/,
    lastWeek: "mitä tilasimme viime viikolla?",
    twoItems: "400 litraa laktoositonta maitoa ja 24 litraa kaurajuomaa torstaiksi",
    oatName: /oat|kaura/i,
    again: /^Tilaa uudelleen$/,
    recurring: /^Toistuvat tilaukset$/,
  },
}[lang];

type Result = { task: string; ok: boolean; seconds: number; taps: number; typed: number; questions: number; note?: string };

const cardsOf = (t: Thread | undefined): Card[] => (t?.turns ?? []).flatMap((x) => (x.role === "agent" ? x.cards : []));

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
  /** Wait for one of the buttons, answering a mistake check ("yes, that is right") as the first-timer means it. */
  async waitFor(target: Locator, timeout = 90_000): Promise<void> {
    const end = Date.now() + timeout;
    const yes = this.log.getByRole("button", { name: L.yes }).last();
    const skip = this.log.getByRole("button", { name: L.skip }).last();
    const swap = this.log.getByRole("button", { name: L.swap }).first();
    while (Date.now() < end) {
      if ((await target.isVisible().catch(() => false)) && (await target.isEnabled().catch(() => false))) return;
      // What a first-timer does on the way: says yes to a check, takes the stated default of a question, and swaps a
      // product the wholesaler cannot deliver for one the picker offers.
      for (const b of [yes, skip]) {
        if (await b.isVisible().catch(() => false)) {
          await this.tap(b);
          await this.page.waitForTimeout(800);
        }
      }
      if (await swap.isVisible().catch(() => false)) {
        await this.tap(swap);
        const choose = this.log.getByRole("button", { name: L.choose }).first();
        const takeOff = this.log.getByRole("button", { name: L.takeOff }).first();
        const again = this.log.getByRole("button", { name: L.lookAgain }).first();
        // Another product; when the kitchen's rules allow nothing else, the line taken off the order, or (the only
        // line) the agent asked to look again with options.
        await choose.or(takeOff).or(again).first().waitFor({ timeout: 30_000 });
        await this.tap((await choose.isVisible().catch(() => false)) ? choose : (await takeOff.isVisible().catch(() => false)) ? takeOff : again);
        await this.page.waitForTimeout(1500);
        continue;
      }
      await this.page.waitForTimeout(300);
    }
    throw new Error(`timed out waiting for ${target}`);
  }
  async until(test: (t: Thread) => boolean, timeout = 90_000): Promise<Thread> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const t = await this.thread();
      if (t && test(t)) return t;
      await this.page.waitForTimeout(500);
    }
    throw new Error("timed out waiting for the thread");
  }
  /** Questions the agent asked in this task: question cards (each question) and mistake checks (each concern). */
  async questions(): Promise<number> {
    const cards = cardsOf(await this.thread());
    return cards.reduce((n, c) => n + (c.type === "question" ? c.questions.length : c.type === "anomaly" ? c.concerns.length : 0), 0);
  }
}

/** The agent has finished answering the buyer's newest turn (not an earlier one, like the day's opening). */
const idle = (t: Thread) => {
  const buyer = t.turns.findLast((x) => x.role === "buyer");
  const answer = buyer && t.turns.find((x) => x.role === "agent" && x.replyTo === buyer.turnId);
  return !!answer && answer.role === "agent" && answer.status !== "working";
};

const ordered = (statuses: string[]) => (t: Thread) => cardsOf(t).some((c) => c.type === "order" && statuses.includes(c.status));
const sheet = (t: Thread) => cardsOf(t).find((c) => c.type === "sheet");

async function task(name: string, n: number, body: (r: Run) => Promise<string | void>): Promise<Result> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "fi" ? "fi-FI" : "en-GB" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const s = await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (s.status() !== 200) throw new Error(`sign-in: HTTP ${s.status()}`);
  await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/reset`, { data: {} });
  await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  await page.goto(`${base}/k/${account.username}`);
  // The agent's panel, as a first-timer opens it if the page did not: the Agent tab.
  const log = page.getByRole("log").first();
  await page.waitForTimeout(1500);
  if (!(await log.isVisible().catch(() => false))) await page.getByRole("button", { name: /^(Agent|Agentti)$/ }).or(page.getByRole("link", { name: /^(Agent|Agentti)$/ })).first().click();
  await log.waitFor({ timeout: 30_000 });
  await page.getByRole("textbox").last().waitFor({ timeout: 30_000 });
  const r = new Run(page);
  let result: Result;
  try {
    r.t0 = Date.now();
    const note = await body(r);
    result = { task: name, ok: true, seconds: Math.round((Date.now() - r.t0) / 100) / 10, taps: r.taps, typed: r.typed, questions: await r.questions(), ...(note ? { note } : {}) };
  } catch (err) {
    result = { task: name, ok: false, seconds: Math.round((Date.now() - r.t0) / 100) / 10, taps: r.taps, typed: r.typed, questions: await r.questions().catch(() => 0), note: (err as Error).message.split("\n")[0].slice(0, 160) };
  }
  await page.waitForTimeout(1500);
  if (out) await page.screenshot({ path: path.join(out, `${lang}-${n}-${result.ok ? "done" : "failed"}.png`), fullPage: false });
  // A first-timer has no orders from the task before: take back what this task placed, so the next one starts clean
  // (otherwise the mistake check rightly asks "you ordered the same a moment ago").
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
    "order the usual",
    async (r) => {
      await r.say(L.usual);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      const done = ordered(["committed", "pending_approval"]);
      const end = Date.now() + 90_000;
      while (Date.now() < end) {
        if (done((await r.thread())!)) return "placed without a tap";
        if (await lead.isVisible().catch(() => false) && (await lead.isEnabled().catch(() => false))) {
          await r.tap(lead);
          await r.until(done);
          return;
        }
        // The usual product is not on offer: swap it on the sheet for one the picker offers, then order.
        const swap = r.log.getByRole("button", { name: L.swap }).first();
        if (await swap.isVisible().catch(() => false)) {
          await r.tap(swap);
          const choose = r.log.getByRole("button", { name: L.choose }).first();
          await choose.waitFor({ timeout: 30_000 });
          await r.tap(choose);
          await r.page.waitForTimeout(1500);
          continue;
        }
        await r.page.waitForTimeout(400);
      }
      throw new Error("no order and no button");
    },
  ],
  [
    "order something new",
    async (r) => {
      await r.say(L.oat);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      await r.waitFor(lead);
      await r.tap(lead);
      await r.until(ordered(["committed", "pending_approval"]));
    },
  ],
  [
    "make it 200 instead of 100",
    async (r) => {
      await r.say(L.hundred);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      // A routine order may be placed at once (inside the rules): then "make it 200" changes a placed order.
      const end = Date.now() + 90_000;
      let placedFirst = false;
      while (Date.now() < end) {
        const t = (await r.thread())!;
        if (t.turns.some((x) => x.role === "buyer") && idle(t)) {
          placedFirst = ordered(["committed", "pending_approval"])(t);
          break;
        }
        await r.page.waitForTimeout(400);
      }
      await r.say(L.make200);
      if (placedFirst) {
        // Whatever the agent does with a placed order: wait for a second order or a button, and say what happened to the first.
        const t = await r.until((t) => cardsOf(t).filter((c) => c.type === "order").length >= 2 || cardsOf(t).some((c) => c.type === "order" && c.status === "withdrawn"), 60_000).catch(() => undefined);
        const again = r.log.getByRole("button", { name: L.order }).last();
        if (!t && (await again.isVisible().catch(() => false))) {
          await r.tap(again);
        }
        const fin = await r.until((t) => cardsOf(t).filter((c) => c.type === "order" && ["committed", "pending_approval"].includes(c.status)).length >= 1 && cardsOf(t).some((c) => c.type === "order" && c.lines.reduce((s, l) => s + l.quantity * (l.packSize ?? 1), 0) >= 180), 60_000);
        const orders = cardsOf(fin).filter((c): c is Extract<Card, { type: "order" }> => c.type === "order");
        return `the 100 L was placed alone first; after "make it 200": ${orders.map((o) => `${o.lines.reduce((s, l) => s + l.quantity * (l.packSize ?? 1), 0)} L ${o.status}`).join(", ")}`;
      }
      // The new options (or the sheet) for 200 L: the first-timer checks the amount on the button's card and orders.
      await r.page.waitForTimeout(1500);
      await r.until((t) => t.turns.filter((x) => x.role === "buyer").length >= 2 && idle(t));
      const again = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(again);
      await r.tap(again);
      const t = await r.until(ordered(["committed", "pending_approval"]));
      const o = cardsOf(t).findLast((c) => c.type === "order");
      const litres = o?.type === "order" ? o.lines.reduce((s, l) => s + l.quantity * (l.packSize ?? 1), 0) : 0;
      if (Math.abs(litres - 200) > 20) throw new Error(`ordered ${litres} L, not 200`);
      return `${litres} L`;
    },
  ],
  [
    "pick the lactose-free one",
    async (r) => {
      await r.say(L.milk);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      const choice = r.log.getByRole("button", { name: L.lactose }).first();
      const end = Date.now() + 90_000;
      while (Date.now() < end && !(await lead.isVisible().catch(() => false)) && !(await choice.isVisible().catch(() => false))) await r.page.waitForTimeout(300);
      if (await choice.isVisible().catch(() => false)) {
        await r.tap(choice);
        await r.waitFor(lead);
      }
      // The lead option, or the lactose-free one among the others.
      const card = cardsOf(await r.thread()).findLast((c) => c.type === "options");
      const leadOpt = card?.type === "options" ? (card.options.find((o) => o.optionId === card.preselected?.optionId) ?? card.options[0]) : undefined;
      const leadIsLactoseFree = !!leadOpt && leadOpt.lines.every((l) => /lactose|laktoositon/i.test(l.name));
      if (!leadIsLactoseFree) {
        const row = r.log.locator("summary").filter({ hasText: L.lactose }).first();
        await r.tap(row);
        const pick = r.log.locator("details[open]").getByRole("button", { name: L.order }).first();
        await r.tap(pick);
      } else await r.tap(lead);
      const t = await r.until(ordered(["committed", "pending_approval"]));
      const o = cardsOf(t).findLast((c) => c.type === "order");
      if (o?.type === "order" && !o.lines.every((l) => L.lactose.test(l.name) || /laktoositon|lactose/i.test(l.name))) return `ordered ${o.lines.map((l) => l.name).join(", ")}`;
    },
  ],
  [
    "move it to Thursday",
    async (r) => {
      await r.say(L.fifty);
      const adjust = r.log.getByRole("button", { name: L.adjust }).first();
      await r.waitFor(adjust);
      await r.tap(adjust);
      await r.until((t) => !!sheet(t));
      const change = r.log.getByRole("button", { name: L.sheetChange }).last();
      await r.waitFor(change);
      await r.tap(change);
      const thu = r.log.getByRole("radio", { name: L.thursday }).first();
      await thu.waitFor({ timeout: 10_000 });
      if ((await thu.getAttribute("aria-disabled")) === "true") throw new Error("Thursday is not possible for this order");
      await r.tap(thu);
      await r.until((t) => {
        const s = sheet(t);
        return s?.type === "sheet" && new Date(`${s.deliveryDate}T12:00:00Z`).getUTCDay() === 4;
      });
      const confirm = r.log.getByRole("button", { name: L.order }).last();
      await r.page.waitForTimeout(500);
      await r.tap(confirm);
      const t = await r.until(ordered(["committed", "pending_approval"]));
      const o = cardsOf(t).findLast((c) => c.type === "order");
      return o?.type === "order" ? `delivers ${o.deliveryDate}` : undefined;
    },
  ],
  [
    "plan a lunch for 40 and order it",
    async (r) => {
      await r.say(L.lunch);
      const cook = r.log.getByRole("button", { name: L.cook }).first();
      const toSheet = r.log.getByRole("button", { name: L.toSheet }).first();
      const end = Date.now() + 150_000;
      while (Date.now() < end && !(await toSheet.isEnabled().catch(() => false))) {
        if (await cook.isVisible().catch(() => false)) {
          await r.tap(cook);
          await r.page.waitForTimeout(1000);
        }
        await r.page.waitForTimeout(500);
      }
      await r.tap(toSheet);
      await r.until((t) => !!sheet(t));
      const confirm = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(confirm);
      await r.tap(confirm);
      const t = await r.until(ordered(["committed", "pending_approval"]), 60_000);
      const o = cardsOf(t).findLast((c) => c.type === "order");
      return o?.type === "order" ? `${o.lines.length} lines, ${o.status}` : undefined;
    },
  ],
  [
    "OK an order over the limit",
    async (r) => {
      await r.say(L.big);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      await r.waitFor(lead);
      await r.tap(lead);
      const sign = r.log.getByRole("button", { name: L.sign }).first();
      await r.waitFor(sign);
      await r.tap(sign);
      await r.until(ordered(["committed"]), 60_000);
    },
  ],
  [
    "take one back",
    async (r) => {
      await r.say(L.fifty);
      const lead = r.log.getByRole("button", { name: L.order }).first();
      await r.waitFor(lead);
      await r.tap(lead);
      await r.until(ordered(["committed", "pending_approval"]));
      const t0 = Date.now();
      const back = r.log.getByRole("button", { name: L.takeBack }).first();
      await back.waitFor({ timeout: 20_000 });
      await r.tap(back);
      await r.until(ordered(["withdrawn"]), 30_000);
      return `take back ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    },
  ],
  [
    "two orders: after an OK, a second typed",
    async (r) => {
      await bigSigned(r);
      await r.say(L.oat);
      const lead = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(lead);
      await r.tap(lead);
      await r.until((t) => cardsOf(t).filter((c) => c.type === "order" && ["committed", "pending_approval"].includes(c.status)).length >= 2);
    },
  ],
  [
    "two orders: after an OK, a second through the order sheet",
    async (r) => {
      await bigSigned(r);
      await r.say(L.fifty);
      const adjust = r.log.getByRole("button", { name: L.adjust }).last();
      const lead = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(adjust);
      await r.tap(adjust);
      await r.until((t) => !!sheet(t));
      await r.page.waitForTimeout(500);
      await r.tap(lead);
      await r.until((t) => cardsOf(t).filter((c) => c.type === "order" && ["committed", "pending_approval"].includes(c.status)).length >= 2);
    },
  ],
  [
    "reorder last week's order",
    async (r) => {
      await r.say(L.lastWeek);
      const again = r.log.getByRole("button", { name: L.again }).first();
      await r.waitFor(again);
      await r.tap(again);
      await r.until((t) => !!sheet(t));
      const confirm = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(confirm);
      await r.tap(confirm);
      const t = await r.until(ordered(["committed", "pending_approval"]));
      const o = cardsOf(t).findLast((c) => c.type === "order");
      return o?.type === "order" ? `${o.lines.length} line(s), ${o.status}` : undefined;
    },
  ],
  [
    "pause a standing order",
    async (r) => {
      // From the landing screen's starting points: no words needed.
      const start = r.log.getByRole("button", { name: L.recurring }).first();
      await start.waitFor({ timeout: 30_000 });
      await r.tap(start);
      const sw = r.log.getByRole("switch").first();
      await sw.waitFor({ timeout: 30_000 });
      await r.tap(sw);
      const t = await r.until((t) => cardsOf(t).some((c) => c.type === "standing" && c.items.some((i) => i.paused)), 30_000);
      // Run it again, so the next run starts from the same records (not counted as a tap of the task).
      const card = cardsOf(t).find((c) => c.type === "standing");
      const fam = card?.type === "standing" ? card.items.find((i) => i.paused)?.family : undefined;
      if (fam) await r.page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/turns`, { data: { door: "typed", via: "tap", action: { type: "standing_pause", family: fam, paused: false }, label: "clean-up", clientTurnId: `unpause-${Date.now()}` } });
      return fam ? `paused ${fam}` : undefined;
    },
  ],
  [
    "two items in one message, one of them oat drink, for Thursday",
    async (r) => {
      // One order sheet with both lines (one total, one confirm); the oat drink is an oat drink; it arrives Thursday.
      await r.say(L.twoItems);
      const t0 = await r.until((t) => !!sheet(t) && idle(t), 90_000);
      const sh = sheet(t0);
      if (sh?.type !== "sheet") throw new Error("no order sheet");
      if (sh.lines.length !== 2) throw new Error(`${sh.lines.length} lines on the sheet, not 2`);
      if (!sh.lines.some((l) => L.oatName.test(l.name))) throw new Error(`no oat drink on the sheet: ${sh.lines.map((l) => l.name).join(", ")}`);
      const thursday = new Date(`${sh.deliveryDate}T12:00:00Z`).getUTCDay() === 4;
      const confirm = r.log.getByRole("button", { name: L.order }).last();
      await r.waitFor(confirm);
      await r.tap(confirm);
      const t = await r.until(ordered(["committed", "pending_approval"]));
      const o = cardsOf(t).findLast((c) => c.type === "order");
      if (o?.type === "order" && o.lines.length !== 2) throw new Error(`the order has ${o.lines.length} lines`);
      return `one order, 2 lines, ${thursday ? "Thursday" : `delivers ${sh.deliveryDate}`}`;
    },
  ],
];

/** The headline order, over the limit, signed on this device: the start of a two-order conversation. */
async function bigSigned(r: Run) {
  await r.say(L.big);
  const lead = r.log.getByRole("button", { name: L.order }).first();
  await r.waitFor(lead);
  await r.tap(lead);
  const sign = r.log.getByRole("button", { name: L.sign }).first();
  await r.waitFor(sign);
  await r.tap(sign);
  await r.until(ordered(["committed"]), 60_000);
  await r.page.waitForTimeout(3000); // the agent's closing line
}

(async () => {
  const results: Result[] = [];
  for (const [i, [name, body]] of TASKS.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const res = await task(name, i + 1, body);
    results.push(res);
    console.log(`${i + 1}. ${name}: ${res.ok ? "done" : "FAILED"} in ${res.seconds} s, ${res.taps} taps, ${res.typed} typed, ${res.questions} question${res.questions === 1 ? "" : "s"}${res.questions > 1 ? " (DEFECT: more than one)" : ""}${res.note ? `; ${res.note}` : ""}`);
  }
  const ok = results.filter((r) => r.ok);
  console.log(`\n${lang}: ${ok.length}/${results.length} done; taps ${ok.map((r) => r.taps).join("/")}; seconds ${ok.map((r) => r.seconds).join("/")}`);
  if (out) fs.writeFileSync(path.join(out, `first-timer-${lang}.json`), JSON.stringify(results, null, 2));
})();
