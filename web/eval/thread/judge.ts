/**
 * A judge on a shared test account finishes the headline request alone, in a real browser at phone width:
 *
 *   pnpm tsx eval/thread/judge.ts --url http://localhost:PORT [--out dir] [--account hotel-lumo] [--width 390] [--lang en|fi] [--repeat N]
 *
 * Signs in to the public test account, opens the Order page (the thread), types "I need 1,000 litres of lactose-free
 * milk by Monday", taps the lead option's button, and on the gate card "Add this device and sign" (or "Sign with this
 * device"), with a virtual passkey authenticator standing in for the phone's own. Done when the thread shows the
 * signed order. Times from the send: options shown, the order waiting, signed. Counts the taps after the words.
 * Real models (cents). Screenshots of the whole thread go to --out.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4522")!;
const out = opt("--out");
const accountName = opt("--account", "hotel-lumo")!;
const width = Number(opt("--width", "390"));
const lang = opt("--lang", "en")!;
const repeat = Number(opt("--repeat", "1"));
const WORDS: Record<string, string> = { en: "I need 1,000 litres of lactose-free milk by Monday", fi: "Tarvitsen 1 000 litraa laktoositonta maitoa maanantaiksi" };

const account = TEST_ACCOUNTS.find((a) => a.username === accountName)!;
if (out) fs.mkdirSync(out, { recursive: true });

async function shot(page: Page, name: string) {
  if (out) await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}

let current: Page | undefined;
async function once(n: number) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600, locale: lang === "fi" ? "fi-FI" : "en-GB" });
  const page = await ctx.newPage();
  current = page;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const r = await page.request.post(`${base}/ui-api/account/signin`, { data: { username: account.username, password: account.password } });
  if (r.status() !== 200) throw new Error(`sign-in: HTTP ${r.status()}`);
  // A fresh conversation, in the chosen language.
  await page.request.post(`${base}/ui-api/kitchens/${account.username}/thread/reset`, { data: {} });
  await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  await page.goto(`${base}/k/${account.username}/order`);
  const log = page.getByRole("log").first();
  const field = page.getByRole("textbox").last();
  await field.fill(WORDS[lang]);
  const t0 = Date.now();
  await field.press("Enter");
  const marks: Record<string, number> = {};
  let taps = 0;
  const lead = log.getByRole("button", { name: /^(Send to .+ for an OK|Order this|Lähetä hyväksyttäväksi|Tilaa tämä)/ }).first();
  // A check the agent asks first (a likely slip, a repeat of a recent order) is answered as the judge means it: one tap.
  const confirm = log.getByRole("button", { name: /^(Yes, that is right|Kyllä, tämä on oikein)$/ }).last();
  for (let i = 0; i < 2; i++) {
    const which = await Promise.race([lead.waitFor({ timeout: 60_000 }).then(() => "lead"), confirm.waitFor({ timeout: 60_000 }).then(() => "confirm")]);
    if (which === "lead") break;
    marks.checked ??= Date.now() - t0;
    await confirm.click();
    taps++;
    await confirm.waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
  }
  await lead.waitFor({ timeout: 60_000 });
  marks.options = Date.now() - t0;
  await shot(page, `${String(n).padStart(2, "0")}-${lang}-${width}-1-options`);
  // Any check the agent asks first is answered as asked (a judge's one tap).
  await lead.click();
  taps++;
  const sign = log.getByRole("button", { name: /(Add this device and sign|Sign with this device|Lisää tämä laite ja hyväksy|Hyväksy tällä laitteella)/ }).first();
  await sign.waitFor({ timeout: 60_000 });
  marks.waiting = Date.now() - t0;
  await shot(page, `${String(n).padStart(2, "0")}-${lang}-${width}-2-gate`);
  await sign.click();
  taps++;
  await log.getByText(/(Signed off by|Approved by|Hyväksyjä:)/).first().waitFor({ timeout: 60_000 });
  marks.signed = Date.now() - t0;
  await page.waitForTimeout(2500); // the agent's closing line
  await shot(page, `${String(n).padStart(2, "0")}-${lang}-${width}-3-signed`);
  const screens = (await page.evaluate(() => document.documentElement.scrollHeight)) / 844;
  await browser.close();
  return { marks, taps, screens: Math.round(screens * 10) / 10 };
}

(async () => {
  const runs = [];
  for (let i = 1; i <= repeat; i++) {
    try {
      const r = await once(i);
      runs.push(r);
      console.log(`run ${i}: options ${(r.marks.options / 1000).toFixed(1)} s, waiting ${(r.marks.waiting / 1000).toFixed(1)} s, signed ${(r.marks.signed / 1000).toFixed(1)} s, ${r.taps} taps after the words, page ${r.screens} screens`);
    } catch (err) {
      if (current && out) await current.screenshot({ path: path.join(out, `${String(i).padStart(2, "0")}-${lang}-${width}-failed.png`), fullPage: true }).catch(() => undefined);
      console.log(`run ${i}: FAILED ${(err as Error).message.split("\n").slice(0, 3).join(" ")}`);
    }
  }
  console.log(`${runs.length}/${repeat} finished alone${runs.length ? `; signed median ${(runs.map((r) => r.marks.signed).sort((a, b) => a - b)[Math.floor((runs.length - 1) / 2)] / 1000).toFixed(1)} s` : ""}`);
})();
