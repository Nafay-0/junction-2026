/**
 * c01 (getting in and onboarding): the three ways in, the sign-up with a made-up restaurant and delivered@resend.dev,
 * the rules interview (some answered, some "Decide later"), "These are your rules", Your rules, a fresh kitchen.
 *
 *   npx tsx scripts/demo-video/c01.ts --url http://localhost:5142
 */
import type { Locator, Page } from "@playwright/test";
import { click, context, deliver, hover, launch, opt, passkey, pointerAt, quiet, reveal, scrollBy, sleep, Take, type } from "./rec";

const base = opt("--url", "http://localhost:5142")!;

async function navTo(page: Page, name: RegExp, href: string) {
  const link = page.getByRole("link", { name }).first();
  if (await link.isVisible().catch(() => false)) await click(link);
  else await page.goto(href);
  await quiet(page);
}

async function main() {
  const browser = await launch();
  const ctx = await context(browser, base, "desktop");
  const page = await ctx.newPage();
  await passkey(page);
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("  [console]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 200)));
  await page.goto("/k");
  await quiet(page);
  await sleep(1500);
  await pointerAt(page, 900, 300);

  // ---------------------------------------------------------------- 1. three ways in
  let take = new Take("c01-01");
  await take.record(page);
  await sleep(1500);
  take.event("/k: the kitchen's shop door");
  await scrollBy(page, 330, { ms: 1400 });
  await sleep(600);
  const fresh = page.getByRole("button", { name: "Start a fresh kitchen" }).first();
  await hover(fresh);
  take.event("way 1: Start a fresh kitchen (no rules, empty memory)");
  await sleep(2200);
  await scrollBy(page, 330, { ms: 1300 });
  for (const n of ["Hotel Lumo kitchen", "Metsola school kitchen", "Kahvila Sointu"]) {
    await hover(page.getByRole("button", { name: `Sign in as ${n}` }));
    if (n === "Hotel Lumo kitchen") take.event("way 2: the three sample test kitchens with rules (shared, reset regularly)");
    await sleep(1300);
  }
  const account = page.getByRole("link", { name: "Open an account" }).first();
  await hover(account);
  take.event("way 3: open your restaurant's account");
  await sleep(2200);
  await take.stop();
  deliver(take, { id: "c01-01-three-ways", chapter: "c01", what: "/k: the three ways in: Start a fresh kitchen; three test kitchens with rules (Hotel Lumo, Metsola school, Kahvila Sointu); open your restaurant's account" });

  // ---------------------------------------------------------------- 2. sign-up, step 1
  take = new Take("c01-02");
  await take.record(page);
  await click(account);
  await take.wait(() => page.locator("#su-restaurant").waitFor());
  await quiet(page);
  await sleep(900);
  take.event("sign-up: the restaurant");
  await type(page.locator("#su-restaurant"), "Ravintola Kuusi");
  take.event("business email (a test address)");
  await type(page.locator("#su-email"), "delivered@resend.dev", { cps: 20 });
  const user = "kuusi-" + Date.now().toString(36).slice(-4);
  await type(page.locator("#su-username"), user, { cps: 20 });
  await type(page.locator("#su-password"), "kuusi-demo-2026", { cps: 24 });
  await sleep(500);
  await click(page.locator('form[aria-label="Your restaurant"] button[type=submit]'));
  const start = page.getByRole("button", { name: "Let's start" });
  await take.wait(() => start.waitFor({ timeout: 30_000 }));
  await quiet(page);
  await sleep(700);
  take.event("welcome: a few questions, each with an answer already chosen; under two minutes, change anything later");
  await hover(page.getByText(/Under two minutes/).first()).catch(() => undefined);
  await sleep(3200);
  await take.stop();
  deliver(take, { id: "c01-02-signup", chapter: "c01", what: "Sign-up: a made-up restaurant (Ravintola Kuusi), the business email delivered@resend.dev, username and password; the agent's welcome and the three things it will ask" });

  // ---------------------------------------------------------------- 3. the interview
  take = new Take("c01-03");
  await take.record(page);
  await click(start);
  const q = (re: RegExp) => take.wait(() => page.getByText(re).first().waitFor({ timeout: 20_000 }));
  const alt = (id: string) => page.locator(`main [data-alt="${id}"]:visible`).first();
  const btn = (name: string | RegExp) => page.locator("main button:visible").filter({ hasText: name }).first();
  const pick = async (l: Locator, pause = 1400) => {
    await click(l);
    await sleep(pause);
  };
  await q(/Must every product be one of these/);
  await sleep(1500);
  take.event("Q: must every product be one of these? (diet)");
  await hover(alt("later"));
  await sleep(1300);
  await pick(alt("later"));
  take.event("answered 'Decide later': I suggest one when your orders show a pattern");
  await q(/Anything your agent must never buy/);
  await sleep(1200);
  take.event("Q: anything your agent must never buy? Nuts and Peanuts chosen");
  await pick(btn(/^Nuts$/), 600);
  await pick(btn(/^Peanuts$/), 900);
  await pick(btn(/^Next$/));
  await q(/Which days do you usually want deliveries/);
  await sleep(1300);
  take.event("Q: delivery days: 'Decide later', learnt from your orders");
  await hover(alt("later"));
  await sleep(1000);
  await pick(alt("later"));
  await q(/About how much is a usual order/);
  await sleep(1200);
  take.event("Q: a usual order: 300 € is right");
  await pick(btn(/is right$/));
  await q(/Up to how much may your agent order alone/);
  await sleep(1500);
  take.event("Q: the limit the agent may spend alone: 450 € (a usual order and a half)");
  await pick(btn(/is right$/));
  await q(/And the most in a whole week/);
  await sleep(1300);
  take.event("Q: weekly budget: 'None', the safe default");
  await hover(alt("none"));
  await sleep(1100);
  await pick(alt("none"));
  await q(/Who OKs orders above that/);
  await sleep(1200);
  take.event("Q: who OKs orders above the limit: Head chef");
  await pick(btn(/^Head chef$/), 900);
  await pick(btn(/^Next$/));
  await q(/These are your rules/);
  await quiet(page);
  await sleep(800);
  take.event("These are your rules (defaults marked)");
  await reveal(page.getByText("These are your rules").first(), { block: "start", offset: 90 });
  await sleep(3000);
  await scrollBy(page, 220);
  await sleep(2000);
  await take.stop();
  deliver(take, { id: "c01-03-interview", chapter: "c01", what: "The rules interview: diet 'Decide later', never Nuts and Peanuts, delivery days 'Decide later', usual order 300 €, limit 450 €, weekly budget 'None' (safe default), Head chef signs; then 'These are your rules'" });

  // ---------------------------------------------------------------- 4. confirm: the device is added, start
  take = new Take("c01-04");
  await take.record(page);
  await sleep(600);
  const confirm = btn(/^Confirm, and add this device/);
  await reveal(confirm);
  await sleep(700);
  await click(confirm);
  take.event("Confirm: this device's passkey is added to OK orders");
  await take.wait(() => page.getByText("Done. Your agent is ready.").waitFor({ timeout: 90_000 }));
  await quiet(page);
  await sleep(800);
  take.event("Done: up to 450 € alone; a confirmation mail to the business address; change rules any time in words");
  await sleep(3500);
  const empty = page.locator('[data-start="empty"]');
  if (await empty.count()) {
    await hover(page.locator('[data-start="sample"]'));
    await sleep(1400);
    await click(empty);
    take.event("Start empty: the agent learns from the orders");
  } else {
    await click(btn(/Make your first order/));
  }
  await take.wait(() => page.waitForURL(/\/k\/kuusi-/, { timeout: 60_000 }));
  await take.wait(() => quiet(page));
  await sleep(1200);
  take.event("the new kitchen's agent, empty memory");
  await sleep(3500);
  await take.stop();
  deliver(take, { id: "c01-04-confirm", chapter: "c01", what: "Confirm the rules: the browser's passkey becomes the signing device; 'Done. Your agent is ready.'; start empty; the new kitchen's agent opens" });

  // ---------------------------------------------------------------- 5. Your rules
  take = new Take("c01-05");
  await take.record(page);
  await sleep(500);
  const kitchen = new URL(page.url()).pathname.split("/")[2];
  await navTo(page, /^Your rules$/, `/k/${kitchen}/agent`);
  await sleep(1200);
  take.event("Your rules: what the agent may do, who signs, what it remembers");
  await sleep(2000);
  for (let i = 0; i < 4; i++) {
    await scrollBy(page, 300, { at: { x: 640, y: 400 } });
    await sleep(1800);
  }
  await take.stop();
  deliver(take, { id: "c01-05-your-rules", chapter: "c01", what: "Your rules page for the new kitchen: limit, weekly budget, never-buy list, signer, defaults marked, changeable any time" });

  // ---------------------------------------------------------------- 6. a fresh kitchen
  const ctx2 = await context(browser, base, "desktop");
  const p2 = await ctx2.newPage();
  await p2.goto("/k");
  await quiet(p2);
  await pointerAt(p2, 700, 300);
  take = new Take("c01-06");
  await take.record(p2);
  await sleep(900);
  const fb = p2.getByRole("button", { name: "Start a fresh kitchen" }).first();
  await click(fb);
  take.event("Start a fresh kitchen: one click");
  await take.wait(() => p2.waitForURL(/\/k\/fresh-/, { timeout: 60_000 }));
  await take.wait(() => p2.getByTestId("fresh-opening").waitFor({ timeout: 30_000 }));
  await take.wait(() => quiet(p2));
  await sleep(800);
  take.event("the fresh kitchen's opening: no rules, empty memory");
  await sleep(2500);
  await scrollBy(p2, 300, { at: { x: 640, y: 400 } });
  await sleep(2500);
  await take.stop();
  deliver(take, { id: "c01-06-fresh", chapter: "c01", what: "'Start a fresh kitchen': one click, the agent's opening for a kitchen with no rules and an empty memory" });

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
