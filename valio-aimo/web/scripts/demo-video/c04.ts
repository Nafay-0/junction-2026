/**
 * c04 (the other agents in the kitchen): the watch, a backup for a poor delivery record, the menu planner, memory,
 * the shop's tabs (Orders, Catalogue with the agent as a pop-up, Try everything), the selling agent's offer.
 *
 *   npx tsx scripts/demo-video/c04.ts --url http://localhost:5142 [--only watch,backup,menu,memory,tabs,offer]
 */
import type { Page } from "@playwright/test";
import { lastAgent } from "./kit";
import { click, context, deliver, hover, launch, opt, passkey, pointerAt, quiet, reveal, scrollBy, sleep, Take, type } from "./rec";
import { Kitchen } from "./talk";

const base = opt("--url", "http://localhost:5142")!;
const only = opt("--only")?.split(",");
const on = (s: string) => !only || only.includes(s);

async function tab(page: Page, name: RegExp, href: string) {
  const link = page.getByRole("link", { name }).first();
  if (await link.isVisible().catch(() => false)) await click(link);
  else await page.goto(href);
  await quiet(page);
  await sleep(900);
}

const k0 = (page: Page) => page.getByText(/wholesaler's agent suggests/i).last();

async function main() {
  const browser = await launch();
  const needLumo = ["watch", "backup", "menu", "memory", "tabs", "planner"].some(on);
  const k = needLumo ? await new Kitchen(browser, base, "hotel-lumo").open({ resetAccounts: true }) : undefined;

  if (k && on("watch")) {
    const take = new Take("c04-01");
    await take.record(k.page);
    await sleep(800);
    const note = k.page.getByText(/can't come|cannot come/).first();
    if (await note.count()) await hover(note);
    take.event("the watch's opening note: Monday's milk can't come; it proposes a switch");
    await sleep(3500);
    await k.say(take, "Anything I should know about this week's deliveries?");
    take.event("the watch answers: what can't come, with ranked substitutes");
    await sleep(5000);
    await scrollBy(k.page, -260);
    await sleep(2500);
    await take.stop();
    deliver(take, { id: "c04-01-watch", chapter: "c04", what: "Hotel Lumo: the watch's opening note (Monday's milk can't come, a switch proposed); asked about this week's deliveries, it lists what can't come with substitutes" });
  }

  if (k && on("backup")) {
    const take = new Take("c04-02");
    await take.record(k.page);
    await sleep(700);
    await k.say(take, "Order 16.2 kg of Vaasan Rye rice pie 90x90g for Tuesday.", { cps: 22 });
    take.event("a poor delivery record: it offers a backup in advance");
    await sleep(4500);
    await k.say(take, "Yes, line it up.");
    take.event("the backup lined up; nothing extra bought");
    await sleep(4000);
    await take.stop();
    deliver(take, { id: "c04-02-backup", chapter: "c04", what: "Hotel Lumo: rice pies with a poor delivery record; the agent offers a backup in advance and lines it up when asked" });
  }

  if (k && on("menu")) {
    const take = new Take("c04-03");
    await take.record(k.page);
    await sleep(700);
    let t = await k.say(take, "Plan a dish for 40 covers for Friday.");
    take.event("the menu planner asks what it needs: what are you in the mood for");
    await sleep(3500);
    t = await k.say(take, "Something warming with fish.");
    take.event("three dishes offered");
    await sleep(4000);
    const line = lastAgent(t)?.line ?? "";
    const first = /1\.\s*([^:]+):/.exec(line)?.[1]?.trim();
    t = await k.say(take, first ? `The ${first.charAt(0).toLowerCase()}${first.slice(1)}.` : "The first one.");
    console.log("  menu cards:", lastAgent(t)?.cards.map((c) => c.type).join(","));
    await sleep(1500);
    const sheet = k.page.locator("text=/You have|I'll order|Can't get/").first();
    if (await sheet.count()) await reveal(sheet, { block: "start", offset: 120, ms: 1100 });
    take.event("You have / I'll order / Can't get, with reasons");
    await sleep(2500);
    await scrollBy(k.page, -350);
    await sleep(2500);
    await scrollBy(k.page, 350);
    await sleep(2000);
    await take.stop();
    deliver(take, { id: "c04-03-menu", chapter: "c04", what: "Hotel Lumo: the menu planner, a dish for 40 covers on Friday: it asks, offers dishes, then sorts what the kitchen has, what it will order and what it can't get" });
  }

  if (k && on("memory")) {
    const take = new Take("c04-04");
    await take.record(k.page);
    await sleep(600);
    await k.say(take, "What do you remember about us?");
    take.event("what the agent remembers, each with where it came from");
    await sleep(4500);
    await tab(k.page, /^Your rules$/, `/k/hotel-lumo/agent`);
    const mem = k.page.getByText(/remember/i).first();
    if (await mem.count()) await reveal(mem, { block: "start", offset: 120, ms: 1200 });
    take.event("Your rules: the memory, change or forget any item");
    await sleep(3500);
    await scrollBy(k.page, 300, { at: { x: 500, y: 400 } });
    await sleep(2500);
    await take.stop();
    deliver(take, { id: "c04-04-memory", chapter: "c04", what: "Hotel Lumo: 'What do you remember about us?' and the memory on Your rules, where an item can be changed or forgotten" });
  }

  if (k && on("tabs")) {
    // Orders
    let take = new Take("c04-05");
    await take.record(k.page);
    await sleep(500);
    await tab(k.page, /^Orders$/, `/k/hotel-lumo/orders`);
    take.event("the Orders tab");
    await sleep(2500);
    const first = k.page.locator("main a[href*='/order']").first();
    if (await first.count()) {
      await click(first);
      await take.wait(() => quiet(k.page));
      take.event("one order: its steps and the wholesaler's signed receipt");
      await sleep(2500);
      await scrollBy(k.page, 350, { at: { x: 500, y: 400 } });
      await sleep(2500);
      await scrollBy(k.page, 350, { at: { x: 500, y: 400 } });
      await sleep(2000);
    }
    await take.stop();
    deliver(take, { id: "c04-05-orders", chapter: "c04", what: "Hotel Lumo: the Orders tab and one order opened (its timeline, steps and signed receipt)" });

    // Catalogue with the agent as a pop-up
    take = new Take("c04-06");
    await take.record(k.page);
    await sleep(500);
    await tab(k.page, /^Catalogue$/, `/k/hotel-lumo/catalogue`);
    const panel = k.page.locator("#assistant");
    const close = panel.getByRole("button", { name: /close/i }).first();
    if (await close.isVisible().catch(() => false)) await click(close);
    await sleep(800);
    take.event("the Catalogue: the shop the kitchen already knows");
    const search = k.page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await type(search, "lactose-free milk", { enter: true });
      await take.wait(() => quiet(k.page));
      await sleep(1800);
      await scrollBy(k.page, 300);
      await sleep(1500);
    }
    await k.page.keyboard.press("Control+k");
    take.event("Ctrl K: the agent opens over the shop");
    await sleep(2000);
    const t0 = await k.thread();
    await k.say(take, "Two cases of tomatoes for Thursday.", { docked: true });
    void t0;
    take.event("asked in the panel, answered beside the catalogue");
    await sleep(4500);
    await take.stop();
    deliver(take, { id: "c04-06-shop-popup", chapter: "c04", what: "Hotel Lumo: the Catalogue searched for lactose-free milk; Ctrl K opens the agent as a panel over the shop; a request answered there" });

    // Try everything
    take = new Take("c04-07");
    await take.record(k.page);
    await sleep(500);
    await tab(k.page, /^Try everything$/, `/k/hotel-lumo/guide`);
    take.event("Try everything: one row per capability, ticked when the kitchen's record shows it");
    await sleep(2000);
    for (let i = 0; i < 5; i++) {
      await scrollBy(k.page, 380, { at: { x: 500, y: 400 } });
      await sleep(1500);
    }
    await take.stop();
    deliver(take, { id: "c04-07-guide", chapter: "c04", what: "Hotel Lumo: the 'Try everything' guide, each capability with words to say, ticked as tried" });
  }
  if (k && on("planner")) {
    const take = new Take("c04-03b");
    await take.record(k.page);
    await sleep(500);
    await tab(k.page, /^Menu planner$/, `/k/hotel-lumo/menu`);
    take.event("the Menu planner tab: say what you serve and for how many");
    await sleep(2000);
    await type(k.page.locator("main textarea").first(), "Salmon soup for 40 on Friday, lactose-free.", { cps: 20 });
    await click(k.page.getByRole("button", { name: /^Plan it$/ }));
    take.event("Plan it: the agent drafts ingredients and amounts; plain code finds products, checks rules, fixes the price");
    await take.wait(async () => {
      const end = Date.now() + 180_000;
      await sleep(3000);
      while (Date.now() < end) {
        const busy = await k.page.locator('main [aria-busy="true"]').count();
        const txt = await k.page.locator("main").innerText();
        if (!busy && /€/.test(txt) && !/Planning|Drafting|Checking/i.test(txt.slice(-400))) break;
        await sleep(800);
      }
      await sleep(1500);
    });
    take.event("the plan: what the kitchen has, what it will order, what it can't get, at fixed prices");
    await sleep(2500);
    for (let i = 0; i < 5; i++) {
      await scrollBy(k.page, 320, { at: { x: 500, y: 400 } });
      await sleep(1700);
    }
    await take.stop();
    deliver(take, { id: "c04-03b-menu-planner", chapter: "c04", what: "Hotel Lumo: the Menu planner tab, 'Salmon soup for 40 on Friday, lactose-free': ingredients drafted, products found and checked by code, a fixed-price order ready" });
  }
  await k?.ctx.close();

  if (on("offer")) {
    // A fresh kitchen with a sample history, the selling agent run now (staged, marked as such on screen)
    const ctx = await context(browser, base, "desktop");
    const page = await ctx.newPage();
    await passkey(page);
    await page.goto("/k");
    await quiet(page);
    await page.getByRole("button", { name: "Start a fresh kitchen" }).first().click();
    await page.waitForURL(/\/k\/fresh-/, { timeout: 60_000 });
    const kitchen = new URL(page.url()).pathname.split("/")[2];
    const api = (body: unknown) => ctx.request.post(`${base}/ui-api/kitchens/${kitchen}/demo`, { data: body, headers: { origin: base } });
    console.log("  sample:", (await api({ action: "sample" })).status());
    const st = await api({ action: "stage", kind: "offer" });
    console.log("  stage offer:", st.status(), (await st.text()).slice(0, 300));
    await page.goto(`/k/${kitchen}`);
    const fk = new Kitchen(browser, base, kitchen);
    fk.ctx = ctx;
    fk.page = page;
    await quiet(page);
    await fk.settle();
    await sleep(1500);
    await pointerAt(page, 820, 420);
    const take = new Take("c04-08");
    await take.record(page);
    await sleep(800);
    const offer = page.getByText(/offer/i).first();
    if (await offer.count()) await reveal(offer, { block: "center" }).catch(() => undefined);
    take.event("the kitchen's opening notes");
    await sleep(2500);
    const t1 = await fk.say(take, "Yes, switch it.", { label: "typed: yes to the watch's switch: an order is placed" });
    const hasOffer = lastAgent(t1)?.cards.some((c) => c.type === "offer");
    console.log("  offer shown:", hasOffer);
    const card = k0(fk.page);
    if (await card.count()) await reveal(card, { block: "center" }).catch(() => undefined);
    take.event("the wholesaler's selling agent adds one signed offer with its reason, never a purchase");
    await sleep(5500);
    const oc = lastAgent(t1)?.cards.find((c) => c.type === "offer");
    const short = oc?.type === "offer" ? oc.name.split(/\s+/).slice(0, 2).join(" ") : "";
    if (hasOffer) await fk.say(take, `No receipt. And yes, add the ${short}.`);
    take.event("answered in words");
    await sleep(4000);
    await take.stop();
    deliver(take, { id: "c04-08-offer", chapter: "c04", what: "A fresh kitchen with a sample history: the wholesaler's selling agent's offer (staged for the demo, marked so), answered in words" });
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
