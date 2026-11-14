/**
 * A first-timer sets up a new restaurant on a phone-sized browser, from nothing to its first order:
 *
 *   pnpm tsx eval/thread/first-timer-setup.ts --url http://localhost:PORT [--lang en|fi] [--out dir] [--repeat N] [--think ms]
 *
 * Sign up (name, username, password), the set-up interview (one question at a time, each answer already chosen: the
 * first-timer takes the defaults, as most will), "These are your rules" confirmed with this device's passkey (a
 * virtual authenticator), then the first order in the agent ("50 litres of lactose-free milk for Friday"), signed with
 * the same device if it needs an OK. Measures seconds and taps for the set-up and for the first order, the number of
 * interview questions, and the agent's questions on the order. Run it against a hermetic server (e2e/support/
 * start-server.mjs, E2E_MODEL=1 for real models): accounts live in its memory and go with it.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator } from "@playwright/test";
import type { Card, Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4551")!;
const out = opt("--out");
const lang = (opt("--lang", "en") as "en" | "fi")!;
const repeat = Number(opt("--repeat", "1"));
/** Reading time before each tap of the set-up (ms), so the seconds are a person's, not a script's. */
const think = Number(opt("--think", "0"));
if (out) fs.mkdirSync(out, { recursive: true });

const L = {
  en: {
    restaurant: "Bistro Satama",
    continue: /^Continue$/,
    start: /^Let's start$/,
    next: /^(Next|None of these)$/,
    isRight: / is right$/,
    restaurantKind: /^Restaurant$/,
    confirm: /^Confirm, and add this device to OK orders$/,
    first: /^Make your first order$/,
    words: "50 litres of lactose-free milk for Friday",
    order: /^(Order this|Send to .+ for an OK)/,
    sign: /^(Add this device and sign|Sign with this device)$/,
    yes: /^(Yes, that is right|Keep it)/,
    skip: /^No preference: show me the options$/,
  },
  fi: {
    restaurant: "Ravintola Laituri",
    continue: /^Jatka$/,
    start: /^Aloitetaan$/,
    next: /^(Seuraava|Ei mikään näistä)$/,
    isRight: / sopii$/,
    restaurantKind: /^Ravintola$/,
    confirm: /^Vahvista ja lisää tämä laite hyväksyjäksi$/,
    first: /^Tee ensimmäinen tilaus$/,
    words: "50 litraa laktoositonta maitoa perjantaiksi",
    order: /^(Tilaa|Lähetä hyväksyttäväksi)/,
    sign: /^(Lisää tämä laite ja hyväksy|Hyväksy tällä laitteella)$/,
    yes: /^(Kyllä, tämä on oikein|Pidä)/,
    skip: /^Ei väliä: näytä vaihtoehdot$/,
  },
}[lang];

const cardsOf = (t: Thread | undefined): Card[] => (t?.turns ?? []).flatMap((x) => (x.role === "agent" ? x.cards : []));

async function once(n: number) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "fi" ? "fi-FI" : "en-GB" });
  await ctx.addCookies([{ name: "aimopilot-lang", value: lang, url: base }]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let taps = 0;
  let reading = false;
  const tap = async (l: Locator) => {
    await l.scrollIntoViewIfNeeded().catch(() => undefined);
    if (reading && think) await page.waitForTimeout(think);
    await l.click();
    taps++;
  };
  const shot = async (name: string) => out && (await page.screenshot({ path: path.join(out, `setup-${lang}-${n}-${name}.png`) }));
  const username = `ft-${lang}-${Date.now().toString(36)}`;

  // 1. The account.
  const t0 = Date.now();
  reading = true;
  await page.goto(`${base}/k/signup`);
  await page.locator("#su-restaurant").fill(`${L.restaurant} ${n}`);
  await page.locator("#su-username").fill(username);
  await page.locator("#su-password").fill("first-timer-pw-123");
  await page.locator("#su-email").fill("delivered@resend.dev");
  await tap(page.getByRole("button", { name: L.continue }));

  // 2. The interview: the welcome, then each question with its default taken.
  await tap(page.getByRole("button", { name: L.start }));
  await shot("1-first-question");
  let questions = 0;
  const confirm = page.getByRole("button", { name: L.confirm });
  for (let guard = 0; guard < 15; guard++) {
    await page.getByRole("progressbar").first().waitFor({ timeout: 15_000 });
    if (await confirm.isVisible().catch(() => false)) break;
    const before = await page.getByRole("progressbar").first().getAttribute("aria-valuenow");
    questions++;
    const kind = page.getByRole("radio", { name: L.restaurantKind });
    const amount = page.getByRole("button", { name: L.isRight });
    const next = page.getByRole("button", { name: L.next });
    if (await kind.isVisible().catch(() => false)) await tap(kind);
    else if (await amount.isVisible().catch(() => false)) await tap(amount);
    else await tap(next);
    // The next question (or the rules) replaces this one.
    for (let i = 0; i < 50; i++) {
      if ((await page.getByRole("progressbar").first().getAttribute("aria-valuenow").catch(() => before)) !== before) break;
      await page.waitForTimeout(100);
    }
  }
  await shot("2-rules");
  await tap(confirm);
  await page.getByRole("button", { name: L.first }).waitFor({ timeout: 30_000 });
  const setupSeconds = (Date.now() - t0) / 1000;
  const setupTaps = taps;
  reading = false;
  await shot("3-done");

  // 3. The first order, in the agent.
  await tap(page.getByRole("button", { name: L.first }));
  await page.waitForURL(`**/k/${username}**`, { timeout: 30_000 });
  const log = page.getByRole("log").first();
  if (!(await log.isVisible().catch(() => false))) {
    await page.waitForTimeout(1500);
    if (!(await log.isVisible().catch(() => false))) await tap(page.getByRole("button", { name: /^(Agent|Agentti)$/ }).or(page.getByRole("link", { name: /^(Agent|Agentti)$/ })).first());
  }
  await log.waitFor({ timeout: 30_000 });
  const t1 = Date.now();
  const tapsBefore = taps;
  const field = page.getByRole("textbox").last();
  await field.fill(L.words);
  await field.press("Enter");
  const thread = async () => {
    const r = await page.request.get(`${base}/ui-api/kitchens/${username}/thread`);
    return r.ok() ? ((await r.json()) as { thread: Thread }).thread : undefined;
  };
  const lead = log.getByRole("button", { name: L.order }).first();
  const sign = log.getByRole("button", { name: L.sign }).first();
  const yes = log.getByRole("button", { name: L.yes }).last();
  const skip = log.getByRole("button", { name: L.skip }).last();
  let status = "";
  const end = Date.now() + 120_000;
  let ordered = false;
  while (Date.now() < end) {
    const o = cardsOf(await thread()).findLast((c) => c.type === "order");
    if (o?.type === "order" && o.status === "committed") {
      status = o.authorised.by === "person" ? "committed, OK'd on this device" : "committed alone";
      break;
    }
    if (!ordered && (await lead.isVisible().catch(() => false))) {
      await tap(lead);
      ordered = true;
      continue;
    }
    for (const b of [yes, skip, sign]) {
      if (await b.isVisible().catch(() => false)) {
        await tap(b);
        await page.waitForTimeout(800);
      }
    }
    await page.waitForTimeout(400);
  }
  const t = await thread();
  const asked = cardsOf(t).reduce((q, c) => q + (c.type === "question" ? c.questions.length : c.type === "anomaly" ? c.concerns.length : 0), 0);
  await shot("4-first-order");
  await browser.close();
  if (!status) throw new Error("the first order was not placed in 120 s");
  return { setupSeconds, setupTaps, questions, orderSeconds: (Date.now() - t1) / 1000, orderTaps: taps - tapsBefore, asked, status };
}

(async () => {
  for (let i = 1; i <= repeat; i++) {
    try {
      const r = await once(i);
      console.log(
        `${lang} run ${i}: set-up ${r.setupSeconds.toFixed(1)} s, ${r.setupTaps} taps, ${r.questions} questions + the rules; first order ${r.orderSeconds.toFixed(1)} s, ${r.orderTaps} taps, ${r.asked} question${r.asked === 1 ? "" : "s"} from the agent (${r.status})`,
      );
    } catch (err) {
      console.log(`${lang} run ${i}: FAILED ${(err as Error).message.split("\n")[0].slice(0, 200)}`);
    }
  }
})();
