/**
 * c06 (the wholesaler's side, every tab) on the LOCAL server, with the sample activity on: each page for a few
 * seconds, clicked through the side rail like a member of staff would, with one real interaction on Orders (a
 * timeline), Trace (stepping through), Time machine (scrubbing back) and Control (suspend and resume).
 *
 *   npx tsx scripts/demo-video/c06.ts --url http://localhost:5142 [--only live,orders,agents,trust,trace,time,setup,control]
 */
import type { Page } from "@playwright/test";
import { signInOps } from "./kit";
import { click, context, deliver, hover, launch, moveTo, opt, pointerAt, quiet, reveal, scrollBy, sleep, Take } from "./rec";

const base = opt("--url", "http://localhost:5142")!;
const only = opt("--only")?.split(",");
const on = (s: string) => !only || only.includes(s);

async function rail(take: Take, page: Page, href: string, label: string) {
  const link = page.locator(`nav a[href="${href}"], aside a[href="${href}"]`).first();
  if (await link.isVisible().catch(() => false)) await click(link, { pause: 100 });
  else await page.goto(href);
  await take.wait(async () => {
    await page.waitForURL((u) => u.pathname + u.hash === href || u.pathname === href.split("#")[0], { timeout: 20_000 }).catch(() => undefined);
    await quiet(page);
  });
  await sleep(600);
  take.event(label);
}

async function browse(page: Page, steps: number, dy = 320, pause = 1300) {
  for (let i = 0; i < steps; i++) {
    await scrollBy(page, dy, { at: { x: 760, y: 420 } });
    await sleep(pause);
  }
}

async function main() {
  const browser = await launch();
  const ctx = await context(browser, base, "desktop");
  await signInOps(ctx, base, "Operations desk");
  const page = await ctx.newPage();
  await page.goto("/ops");
  await quiet(page);
  await sleep(2000);
  await pointerAt(page, 760, 380);

  if (on("live")) {
    const take = new Take("c06-01");
    await take.record(page);
    await sleep(1000);
    take.event("Live: every agent at the door, as it happens");
    await sleep(2500);
    await browse(page, 3);
    await sleep(800);
    await take.stop();
    deliver(take, { id: "c06-01-live", chapter: "c06", what: "Operations, Live: every agent at the door (sample activity marked as such)" });
  }

  if (on("orders")) {
    const take = new Take("c06-02");
    await take.record(page);
    await rail(take, page, "/ops/orders", "Orders: every order and its whole life");
    await sleep(2000);
    // The order just placed in c02 (Hotel Lumo, 1 010,00 €) if it is there, else the newest.
    const mine = page.locator("main a[href^='/ops/orders/']").filter({ hasText: /1\s?010,00/ }).first();
    const row = (await mine.count()) ? mine : page.locator("main a[href^='/ops/orders/']").first();
    if (await row.count()) {
      await click(row, { pause: 100 });
      await take.wait(() => quiet(page));
      await sleep(800);
      take.event("the order just placed: its full timeline");
      await sleep(1800);
      await browse(page, 3, 300, 1500);
      const confirm = page.getByRole("button", { name: /Confirm for delivery/i }).first();
      if (await confirm.count()) {
        await reveal(confirm, { block: "center" });
        await sleep(900);
        await click(confirm);
        await take.wait(() => quiet(page));
        await sleep(600);
        // a second step (a confirm dialog) if the page asks for one
        const again = page.getByRole("button", { name: /^(Confirm|Yes, confirm)/i }).last();
        if (await again.isVisible().catch(() => false)) {
          await click(again);
          await take.wait(() => quiet(page));
        }
        take.event("staff confirm it for delivery; the timeline gains the step");
        await sleep(2500);
        await browse(page, 2, 300, 1500);
      }
    }
    await rail(take, page, "/ops/control#waiting", "Waiting for a person: sign-offs not given yet");
    await sleep(2500);
    await take.stop();
    deliver(take, { id: "c06-02-orders", chapter: "c06", what: "Orders: the list, one order's full timeline; then Waiting for a person" });
  }

  if (on("agents")) {
    const take = new Take("c06-03");
    await take.record(page);
    await rail(take, page, "/ops/agents", "Agents: the scorecard (who performs, who fails, who escalates)");
    await sleep(1800);
    await browse(page, 4, 330, 1400);
    await rail(take, page, "/ops/conversation", "Conversations: a kitchen and its agent, turn by turn");
    await sleep(1500);
    await browse(page, 2);
    await rail(take, page, "/ops/offers", "Selling agent: what it offered, to whom, why");
    await sleep(1500);
    await browse(page, 2);
    await rail(take, page, "/ops/watch", "Kitchen watch: stock-outs, drift, renewals");
    await sleep(1500);
    await browse(page, 2);
    await take.stop();
    deliver(take, { id: "c06-03-agents", chapter: "c06", what: "Agents group: the scorecard and crash-test licences, Conversations, Selling agent, Kitchen watch" });
  }

  if (on("trust")) {
    const take = new Take("c06-04");
    await take.record(page);
    await rail(take, page, "/ops/safeguards", "Safeguards: each rule of the gate and how often it fired");
    await sleep(1800);
    await browse(page, 3, 330, 1500);
    await rail(take, page, "/ops/audit", "Audit: the hash-chained ledger, verified");
    await sleep(1800);
    const verify = page.getByRole("button", { name: /verify|check/i }).first();
    if (await verify.isVisible().catch(() => false)) {
      await click(verify);
      await take.wait(() => quiet(page));
      take.event("the chain verified");
      await sleep(2200);
    }
    await browse(page, 2);
    await rail(take, page, "/ops/radar", "Recall radar: recalls, holds, drills");
    await sleep(1500);
    await browse(page, 2);
    await take.stop();
    deliver(take, { id: "c06-04-trust", chapter: "c06", what: "Trust group: Safeguards (each rule and how often it fired), Audit (the hash-chained ledger, verified), Recall radar" });
  }

  if (on("trace")) {
    const take = new Take("c06-05");
    await take.record(page);
    await rail(take, page, "/ops/trace", "Trace: replay any request step by step");
    await sleep(1200);
    const req = page.locator("main a[href^='/ops/trace/']").first();
    if (await req.isVisible().catch(() => false)) {
      await click(req, { pause: 100 });
      await take.wait(() => quiet(page));
    }
    await sleep(1000);
    await page.locator("main h1, main h2").first().click({ position: { x: 2, y: 2 } }).catch(() => undefined);
    await page.keyboard.press("Home");
    await sleep(800);
    const replay = page.getByRole("button", { name: /^(Replay|Play)/ }).first();
    if (await replay.count()) {
      await click(replay);
      take.event("replaying the request step by step");
      await sleep(9000);
    } else {
      take.event("stepping through the request");
      for (let i = 0; i < 8; i++) {
        await sleep(1000);
        await page.keyboard.press("ArrowRight");
      }
    }
    await browse(page, 2, 300, 1500);
    await take.stop();
    deliver(take, { id: "c06-05-trace", chapter: "c06", what: "Trace: one request replayed step by step (the request read, search, live price, the gate's rules, the sign-off)" });
  }

  if (on("time")) {
    const take = new Take("c06-06");
    await take.record(page);
    await rail(take, page, "/ops/time-machine", "Time machine: the rules and state as they stood at any moment");
    await sleep(1800);
    const slider = page.getByRole("slider", { name: "Moment to look at" });
    if (await slider.count()) {
      await reveal(slider, { block: "center" });
      const b = (await slider.boundingBox())!;
      const y = b.y + b.height / 2;
      await moveTo(page, b.x + b.width - 6, y);
      await sleep(500);
      await page.mouse.down();
      take.event("scrubbing back in time");
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(b.x + b.width - 6 - (b.width * 0.75 * i) / 40, y);
        await sleep(55);
      }
      await page.mouse.up();
      await sleep(2200);
      await browse(page, 2, 300, 1600);
      await scrollBy(page, -600);
      await sleep(600);
      await moveTo(page, b.x + b.width * 0.25, y);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(b.x + b.width * 0.25 + (b.width * 0.5 * i) / 30, y);
        await sleep(55);
      }
      await page.mouse.up();
      await sleep(2200);
    }
    await take.stop();
    deliver(take, { id: "c06-06-time-machine", chapter: "c06", what: "Time machine: the slider dragged back, the rules and state as they stood at that moment" });
  }

  if (on("setup")) {
    const take = new Take("c06-07");
    await take.record(page);
    await rail(take, page, "/ops/customers", "Customers: what kitchens share");
    await sleep(1500);
    await browse(page, 2);
    await rail(take, page, "/ops/accounts", "Accounts: kitchens with an account");
    await sleep(1500);
    await browse(page, 1);
    await rail(take, page, "/ops/mail", "Mail: receipts and alerts to kitchens");
    await sleep(1500);
    await browse(page, 2);
    await take.stop();
    deliver(take, { id: "c06-07-setup", chapter: "c06", what: "Setup group: Customers, Accounts, Mail (receipts and alerts sent to kitchens)" });
  }

  if (on("control")) {
    const take = new Take("c06-08");
    await take.record(page);
    await rail(take, page, "/ops/control", "Control: suspend an agent");
    await sleep(1500);
    const sel = page.locator("#suspend select, form select").first();
    if (await sel.count()) {
      await reveal(sel, { block: "center" });
      await hover(sel);
      const values = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
      const pick = values.find((o) => /lumo/i.test(o.t)) ?? values.find((o) => o.v);
      if (pick) await sel.selectOption(pick.v);
      take.event(`chose ${pick?.t ?? "an agent"}`);
      await sleep(1000);
      const reason = page.getByLabel(/reason/i).first();
      if (await reason.count()) {
        const { type } = await import("./rec");
        await type(reason, "Odd orders overnight: hold it while we look.", { cps: 22 });
      }
      await sleep(500);
      await click(page.locator("form button[type=submit]").first());
      await sleep(1200);
      take.event("read exactly what will happen, then confirm");
      await sleep(2000);
      const confirm = page.getByRole("button", { name: /^Suspend the agent$|^Suspend the organisation$/ });
      if (await confirm.count()) {
        await click(confirm);
        await take.wait(() => quiet(page));
        take.event("suspended: its next call is refused");
        await sleep(2500);
      }
      const resume = page.getByRole("button", { name: /^Resume$/ }).first();
      if (await resume.count()) {
        await reveal(resume, { block: "center" });
        await sleep(1000);
        await click(resume);
        await take.wait(() => quiet(page));
        take.event("resumed; both acts in the ledger");
        await sleep(2500);
      }
    }
    await take.stop();
    deliver(take, { id: "c06-08-control", chapter: "c06", what: "Control: suspend an agent with a reason (read what will happen, confirm), then resume it; both written to the ledger" });
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
