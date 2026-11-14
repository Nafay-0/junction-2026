/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * Screenshots of menu replies (dishes and ingredients in the reply), on a phone (390 px) and in the desk panel, with
 * motion on: `pnpm tsx eval/thread/shots-menu.ts --url URL --out DIR --name cake-en --kitchen hotel-lumo --lang en "chocolate cake" "10 portions" ...`
 * A shot is taken after every turn; the turns are sent over HTTP as the kitchen's own signed-in person.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const flags = new Set(["--url", "--out", "--name", "--kitchen", "--lang"]);
const words = args.filter((a, i) => !flags.has(a) && !flags.has(args[i - 1]));
const base = opt("--url", "http://localhost:4522")!;
const out = opt("--out", "/tmp")!;
const name = opt("--name", "menu")!;
const lang = opt("--lang", "en")!;
const slug = opt("--kitchen", "hotel-lumo")!;
const account = TEST_ACCOUNTS.find((a) => a.username === slug)!;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  for (const ctx of [phone, desk]) await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  const p = await phone.newPage();
  const d = await desk.newPage();
  for (const page of [p, d]) await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  await p.request.post(`${base}/ui-api/kitchens/${slug}/thread/reset`, { data: {} });
  const call = (m: string, u: string, b?: unknown) => (m === "GET" ? p.request.get(`${base}${u}`) : p.request.post(`${base}${u}`, { data: b })).then((r) => r.json());
  const shoot = async (page: Page, file: string, panel: boolean) => {
    if (panel) {
      await page.goto(`${base}/k/${slug}/catalogue`);
      await page.waitForTimeout(2500);
      const open = page.locator("button[aria-keyshortcuts='Control+K Meta+K']").last();
      if (await open.isVisible().catch(() => false)) await open.click();
      await page.waitForTimeout(2500);
    } else {
      await page.goto(`${base}/k/${slug}`);
      await page.waitForTimeout(3500);
    }
    await page.screenshot({ path: path.join(out, file) });
  };
  for (const [i, text] of words.entries()) {
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang });
    let a: any;
    for (let k = 0; k < 480; k++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
    }
    const dishes = (a?.cards ?? []).find((c: any) => c.type === "dishes");
    console.log(`> ${text}\n  [${a?.status}; ${(a?.cards ?? []).map((c: any) => c.type).join(",")}] ${a?.line ?? ""}`);
    if (dishes) for (const x of dishes.dishes) console.log(`    ${x.name[lang]}: ${x.items.map((it: any) => `${it.name[lang]}${it.need ? ` ${it.need.amount} ${it.need.unit}` : ""}${it.note ? ` (${it.note.code}${it.note.to ? ` ${it.note.to[lang]}` : ""}${it.note.why ? ` ${it.note.why}` : ""})` : ""}`).join(", ")}`);
    await shoot(p, `${name}-${i + 1}-phone.png`, false);
    await shoot(d, `${name}-${i + 1}-desk.png`, true);
  }
  await browser.close();
})();
