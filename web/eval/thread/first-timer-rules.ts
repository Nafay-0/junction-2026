/**
 * A first-timer changes the kitchen's rules on a phone-sized browser: "raise the limit to 800 €", typed and tapped.
 *
 *   pnpm tsx eval/thread/first-timer-rules.ts --url http://localhost:PORT [--lang en|fi] [--out dir] [--account hotel-lumo]
 *
 * typed:  "raise my limit to 800" -> the change shown as before and after -> one confirm.
 * tapped: "what are my rules?" -> Change on "Your agent may spend alone" -> 800 € -> confirm.
 * Done when the account's signed rules say 800 € (read back from the thread's rules card). Seconds from the first
 * words, taps, typed messages, questions the agent asked. The account's limit is put back as it was after each task.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import type { Card, RulesCard, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4531")!;
const out = opt("--out");
const lang = (opt("--lang", "en") as "en" | "fi")!;
const account = TEST_ACCOUNTS.find((a) => a.username === opt("--account", "hotel-lumo"))!;
if (out) fs.mkdirSync(out, { recursive: true });

const L = {
  en: { raise: "raise my limit to 800", show: "what are my rules?", row: /: Your agent may spend alone$/, pick: /^800\s€$/, confirm: /^Confirm: 800\s€ per order$/ },
  fi: { raise: "nosta rajani 800 euroon", show: "mitkä ovat sääntöni?", row: /: Agenttisi saa tilata yksin$/, pick: /^800\s€$/, confirm: /^Vahvista: 800\s€ \/ tilaus$/ },
}[lang];

const cardsOf = (t: Thread | undefined): Card[] => (t?.turns ?? []).flatMap((x) => (x.role === "agent" ? x.cards : []));
const rulesCards = (t: Thread | undefined) => cardsOf(t).filter((c): c is RulesCard => c.type === "rules");
const signed800 = (t: Thread) => rulesCards(t).some((c) => c.proposal?.state === "signed" && c.current.perOrderLimitCents === 80_000);

type Result = { task: string; ok: boolean; seconds: number; taps: number; typed: number; questions: number; note?: string };

async function run(name: string, body: (p: Page, tap: (l: Locator) => Promise<void>, say: (w: string) => Promise<void>, thread: () => Promise<Thread | undefined>) => Promise<void>): Promise<Result> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "fi" ? "fi-FI" : "en-GB" });
  const page = await ctx.newPage();
  const s = await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (s.status() !== 200) throw new Error(`sign-in: HTTP ${s.status()}`);
  await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/reset`, { data: {} });
  await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  const thread = async () => {
    const r = await page.request.get(`${base}/ui-api/kitchens/${account.username}/thread`);
    return r.ok() ? ((await r.json()) as { thread: Thread }).thread : undefined;
  };
  const before = rulesCards(await thread()).at(-1)?.current.perOrderLimitCents;
  await page.goto(`${base}/k/${account.username}?agent=open`);
  const log = page.getByRole("log").first();
  await page.waitForTimeout(1500);
  if (!(await log.isVisible().catch(() => false))) await page.getByRole("button", { name: /^(Agent|Agentti)$/ }).or(page.getByRole("link", { name: /^(Agent|Agentti)$/ })).first().click();
  await log.waitFor({ timeout: 30_000 });
  let taps = 0;
  let typed = 0;
  const tap = async (l: Locator) => {
    await l.waitFor({ timeout: 60_000 });
    await l.scrollIntoViewIfNeeded().catch(() => undefined);
    await l.click();
    taps++;
  };
  const say = async (w: string) => {
    const field = page.getByRole("textbox").last();
    await field.fill(w);
    await field.press("Enter");
    typed++;
  };
  const t0 = Date.now();
  let result: Result;
  try {
    await body(page, tap, say, thread);
    const end = Date.now() + 30_000;
    while (Date.now() < end && !signed800((await thread())!)) await page.waitForTimeout(400);
    if (!signed800((await thread())!)) throw new Error("the limit was not signed at 800 €");
    const questions = cardsOf(await thread()).reduce((n, c) => n + (c.type === "question" ? c.questions.length : c.type === "anomaly" ? c.concerns.length : 0), 0);
    result = { task: name, ok: true, seconds: Math.round((Date.now() - t0) / 100) / 10, taps, typed, questions };
  } catch (err) {
    result = { task: name, ok: false, seconds: Math.round((Date.now() - t0) / 100) / 10, taps, typed, questions: 0, note: (err as Error).message.split("\n")[0].slice(0, 160) };
  }
  await page.waitForTimeout(800);
  if (out) await page.screenshot({ path: path.join(out, `rules-${lang}-${name.replace(/\W+/g, "-")}-${result.ok ? "done" : "failed"}.png`) });
  // Put the account's limit back as it was, through the same door (signed by the account's own session).
  const restore = Math.round((before ?? 50_000) / 100);
  await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/turns`, { data: { door: "typed", via: "tap", action: { type: "rules_propose", change: { perOrderLimitEur: restore }, sign: true }, label: "eval: restore the limit", clientTurnId: `restore-${Date.now()}` } });
  await page.waitForTimeout(2500);
  await browser.close();
  return result;
}

(async () => {
  const results: Result[] = [];
  results.push(
    await run("typed", async (page, tap, say) => {
      await say(L.raise);
      await tap(page.getByRole("log").first().getByRole("button", { name: L.confirm }).last());
    }),
  );
  results.push(
    await run("tapped", async (page, tap, say) => {
      const log = page.getByRole("log").first();
      await say(L.show);
      await tap(log.getByRole("button", { name: L.row }).last());
      await tap(log.getByRole("button", { name: L.pick }).last());
      await tap(log.getByRole("button", { name: L.confirm }).last());
    }),
  );
  for (const r of results) console.log(`${lang} ${r.task}: ${r.ok ? "done" : "FAILED"} in ${r.seconds} s, ${r.taps} taps, ${r.typed} typed, ${r.questions} questions${r.note ? `; ${r.note}` : ""}`);
  if (out) fs.writeFileSync(path.join(out, `first-timer-rules-${lang}.json`), JSON.stringify(results, null, 2));
})();
