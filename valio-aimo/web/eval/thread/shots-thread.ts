/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * Screenshots of whole conversations for people to look at: each turn's reply on a phone (390 × 844 at device scale 2)
 * and in the desk panel (1440 × 900), motion on, and the working line while a long turn is still at work.
 *
 *   pnpm tsx eval/thread/shots-thread.ts --url URL --out DIR --name sointu-dish --kitchen kahvila-sointu --lang en \
 *        "i Have a big lunch …" "surprise me" "the first one" "yes"
 *
 * Optional labels per turn: "words=>label" names the shot ("the first one=>pick"). The thread starts over first. The
 * turns are sent over HTTP as the kitchen's own signed-in person (the one-click test account); the pages are the store's
 * own, in headless Chromium from the repo's Playwright.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const flags = new Set(["--url", "--out", "--name", "--kitchen", "--lang"]);
const turns = args.filter((a, i) => !flags.has(a) && !flags.has(args[i - 1])).map((a) => ({ text: a.split("=>")[0], label: a.split("=>")[1] }));
const base = opt("--url", "http://localhost:4820")!;
const out = opt("--out", "/tmp")!;
const name = opt("--name", "thread")!;
const lang = opt("--lang", "en")!;
const slug = opt("--kitchen", "hotel-lumo")!;
const account = TEST_ACCOUNTS.find((a) => a.username === slug)!;
fs.mkdirSync(out, { recursive: true });
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9äö]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

(async () => {
  const browser = await chromium.launch();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  for (const ctx of [phone, desk]) await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  const p = await phone.newPage();
  const d = await desk.newPage();
  for (const page of [p, d]) await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  await p.request.post(`${base}/ui-api/kitchens/${slug}/thread/reset`, { data: {} });
  const call = (m: string, u: string, b?: unknown) => (m === "GET" ? p.request.get(`${base}${u}`) : p.request.post(`${base}${u}`, { data: b })).then((r) => r.json());
  // The phone stays on the agent's page (as a chef would); the desk opens the agent's panel over the catalogue.
  await p.goto(`${base}/k/${slug}`);
  await d.goto(`${base}/k/${slug}/catalogue`);
  // On a wide screen the panel opens by itself once the page is live; a click would close it again.
  await d.locator("#assistant").waitFor({ state: "visible", timeout: 20_000 }).catch(async () => {
    await d.locator("header button[aria-controls=assistant]").click().catch(() => undefined);
  });
  const bottom = (page: Page) =>
    page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const s = getComputedStyle(el);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
  const shoot = async (page: Page, file: string) => {
    await bottom(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, file) });
  };
  for (const [i, t] of turns.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const label = t.label ?? slugOf(t.text);
    const t0 = Date.now();
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text: t.text, lang });
    let a: any;
    let working = false;
    for (let k = 0; k < 480; k++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
      // A long turn: the working line as the buyer sees it then, once.
      if (!working && Date.now() - t0 > 7000) {
        working = true;
        await shoot(p, `${name}-${n}-${label}-working-phone.png`);
      }
    }
    console.log(`> ${t.text}\n  [${a?.status}; ${Math.round((Date.now() - t0) / 1000)} s; ${(a?.cards ?? []).map((c: any) => c.type).join(",")}]\n  ${a?.line ?? ""}\n`);
    await p.waitForTimeout(1500);
    await shoot(p, `${name}-${n}-${label}-phone.png`);
    await shoot(d, `${name}-${n}-${label}-desk.png`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
