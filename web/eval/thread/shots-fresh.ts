/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: reads untyped JSON replies. */
/**
 * A fresh kitchen on screen, as a visitor starts one: its opening, an order of non-food in packs, and, after "Give this
 * kitchen a limit", an order over the limit with the slab's signer line. Phone (390 × 844 at scale 2) and desk
 * (1440 × 900), motion on. `pnpm tsx eval/thread/shots-fresh.ts --url URL --out DIR`
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (f: string, d: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4820");
const out = opt("--out", "/tmp");
const lang = opt("--lang", "en");
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  for (const ctx of [phone, desk]) await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  const p = await phone.newPage();
  const started = await p.request.post(`${base}/ui-api/account/fresh`, { data: { fresh: true } });
  const slug = String(((await started.json()) as any).next ?? "").split("/").filter(Boolean).at(-1)!;
  console.log(`fresh kitchen ${slug}`);
  await desk.addCookies(await phone.cookies());
  const d = await desk.newPage();
  const call = (m: string, u: string, b?: unknown) => (m === "GET" ? p.request.get(`${base}${u}`) : p.request.post(`${base}${u}`, { data: b })).then((r) => r.json());
  const bottom = (page: Page) =>
    page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const s = getComputedStyle(el);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
  const shoot = async (name: string, top = false) => {
    for (const [page, kind] of [[p, "phone"], [d, "desk"]] as const) {
      if (!top) await bottom(page);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, `fresh-${name}-${kind}.png`) });
    }
  };
  await p.goto(`${base}/k/${slug}`);
  await d.goto(`${base}/k/${slug}`);
  await p.waitForTimeout(6000);
  await d.waitForTimeout(1000);
  await shoot("01-opening", true);
  const say = async (n: string, text: string) => {
    const sent = await call("POST", `/ui-api/kitchens/${slug}/thread/turns`, { door: "typed", via: "typed", text, lang });
    let a: any;
    for (let k = 0; k < 360; k++) {
      await new Promise((r) => setTimeout(r, 500));
      a = (await call("GET", `/ui-api/kitchens/${slug}/thread`)).thread.turns.find((x: any) => x.turnId === sent.agentTurnId);
      if (a && a.status !== "working") break;
    }
    console.log(`> ${text}\n  [${a?.status}; ${(a?.cards ?? []).map((c: any) => c.type).join(",")}] ${a?.line ?? ""}\n`);
    await p.waitForTimeout(1500);
    await shoot(n);
  };
  await say("02-napkins-2-packs", "paper napkins, 2 packs for Friday");
  await say("03-napkins-yes", "yes");
  // "Give this kitchen a limit" on its rules page, as a visitor taps it: this browser's passkey (a virtual authenticator)
  // becomes the approver, then the 250 € limit is signed.
  const cdp = await phone.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await p.goto(`${base}/k/${slug}/agent`);
  await p.getByRole("button", { name: /^Give it a .+ limit$/ }).click();
  await p.getByText(/orders over .+ now wait for your OK/).first().waitFor({ timeout: 30_000 }).catch(() => console.log("limit: no confirmation seen"));
  await p.screenshot({ path: path.join(out, "fresh-04-limit-given-phone.png") });
  await p.goto(`${base}/k/${slug}`);
  await p.waitForTimeout(3000);
  await say("05-over-the-limit", "300 litres of lactose-free milk for Friday");
  await say("06-over-the-limit-yes", "yes");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
