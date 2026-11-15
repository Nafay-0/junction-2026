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

async function main() {
  const browser = await launch();
  const needLumo = ["watch", "backup", "menu", "memory", "tabs"].some(on);
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
    take.event("the menu planner asks what it needs");
    await sleep(3500);
    for (let i = 0; i < 4; i++) {
      const a = lastAgent(t);
      const types = a?.cards.map((c) => c.type) ?? [];
      console.log("  menu cards:", types.join(","), "status", a?.status);
      if (types.includes("menu") && a?.status !== "waiting_buyer") break;
      const isDishes = types.includes("dishes");
      t = await k.say(take, isDishes ? "The first one." : "Something warming with fish.");
      take.event(isDishes ? "picked the first dish" : "answered: something warming with fish");
      await sleep(3500);
    }
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
    const close = panel.getByRole("button", { name: /close/i });
    if (await close.isVisible().catch(() => false)) await click(close);
    take.event("the Catalogue: the shop the kitchen already knows");
    const search = k.page.getByRole("searchbox").first().or(k.page.locator("main input[type=search]").first());
    if (await search.count()) {
      await type(search.first(), "lactose-free milk", { enter: true });
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
    take.event("the wholesaler's selling agent: one signed offer with its reason");
    await sleep(4500);
    await fk.say(take, "Yes, add it.");
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
