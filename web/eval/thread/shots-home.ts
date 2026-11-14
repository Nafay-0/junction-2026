/**
 * Screenshots of where a signed-in kitchen lands, on a phone and a desk: `pnpm tsx eval/thread/shots-home.ts --url URL --out DIR [--lang en|fi]`.
 * Then the starting points: earlier orders, recurring orders, what the agent remembers.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const out = opt("--out", "/tmp")!;
const lang = opt("--lang", "en")!;
const account = TEST_ACCOUNTS.find((a) => a.username === "hotel-lumo")!;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h] of [["phone", 390, 844], ["desk", 1440, 900]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600 });
    const page = await ctx.newPage();
    await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
    await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/reset`, { data: {} });
    await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
    await page.goto(`${base}/k/${account.username}`);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(out, `${lang}-${name}-1-landing.png`) });
    if (name === "phone") {
      for (const [i, label] of (lang === "fi" ? ["Aiemmat tilaukset", "Toistuvat tilaukset", "Mitä agentti muistaa"] : ["Earlier orders", "Recurring orders", "What the agent remembers"]).entries()) {
        await page.getByRole("button", { name: label }).first().click();
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(out, `${lang}-${name}-${i + 2}.png`) });
      }
    }
    await ctx.close();
  }
  await browser.close();
})();
