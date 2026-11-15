/**
 * The hosted site, as a visitor only (read-only: no sign-in, no passcode, no passkey, no orders): the landing page
 * (c00, c10, c08's search and map sections), /try and /docs (c07), the Platform tabs with the Aiven services live
 * (c08), one "Send in the agent" run (c07: there are 12 a day for everyone, so ONE), and Trace / Time machine (c06).
 *
 *   npx tsx scripts/demo-video/hosted.ts [--only landing,end,search,try,docs,platform,observe,stream,ask,agent,history,tested]
 */
import type { Page } from "@playwright/test";
import { click, context, deliver, hover, launch, moveTo, opt, pointerAt, quiet, reveal, scrollBy, sleep, Take, type } from "./rec";

const HOST = "https://aimopilot.zeroanomaly.tech";
const only = opt("--only")?.split(",");
const on = (s: string) => !only || only.includes(s);

async function go(page: Page, path: string) {
  await page.goto(HOST + path, { waitUntil: "domcontentloaded" });
  await quiet(page, 30_000);
  await sleep(1800);
}

async function slow(page: Page, total: number, step = 240, pause = 650) {
  for (let y = 0; y < total; y += step) {
    await scrollBy(page, step, { ms: 900, at: { x: 640, y: 380 } });
    await sleep(pause);
  }
}

async function main() {
  const browser = await launch();
  const ctx = await context(browser, HOST, "desktop");
  const page = await ctx.newPage();
  await pointerAt(page, 900, 420);

  if (on("landing")) {
    await go(page, "/");
    const take = new Take("c00-01");
    await take.record(page);
    take.event("the landing page: AimoPilot, built for Valio Aimo at Junction 2026");
    await sleep(3500);
    const shop = page.locator("#webshop");
    const top = await shop.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const h = await shop.evaluate((el) => el.getBoundingClientRect().height);
    await page.evaluate(async (to) => {
      const from = window.scrollY;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const f = (n: number) => {
          const k = Math.min(1, (n - t0) / 2200);
          window.scrollTo(0, from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
          if (k < 1) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
    }, top - 20);
    take.event("How it looks on your webshop: the agent docked in the shop the kitchen already uses");
    await sleep(1500);
    await slow(page, Math.max(600, h - 700), 200, 700);
    await sleep(1500);
    await take.stop();
    deliver(take, { id: "c00-01-landing", chapter: "c00", what: "Hosted landing page: the hero, then a slow scroll through 'How it looks on your webshop' (the agent docked in the store)" });
  }

  if (on("end")) {
    await go(page, "/");
    const take = new Take("c10-01");
    const shop = page.locator("#webshop");
    const bottom = await shop.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y - window.innerHeight - 60), bottom);
    await sleep(2500);
    await take.record(page);
    take.event("the webshop section at its end state");
    await sleep(3500);
    const end = page.locator("#end-t");
    await reveal(end, { block: "start", offset: 140, ms: 2600 });
    take.event("the end: the ways in and the address");
    await sleep(2500);
    await scrollBy(page, 2000, { ms: 1800 });
    await sleep(3000);
    await take.stop();
    deliver(take, { id: "c10-01-webshop-end", chapter: "c10", what: "Hosted landing: 'How it looks on your webshop' at its end state, then the page's end with the ways in, the address and the synthetic-data note" });
  }

  if (on("search")) {
    await go(page, "/");
    const take = new Take("c08-01");
    await page.evaluate(() => document.getElementById("search")?.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -80));
    await sleep(2000);
    await take.record(page);
    take.event("Search: right-first on the same requests, step by step");
    await sleep(2500);
    await slow(page, 900, 200, 900);
    const map = page.locator("#map");
    await reveal(map, { block: "start", offset: 60, ms: 1800 });
    take.event("the map: which Aiven service does which job");
    await sleep(2500);
    await slow(page, 700, 200, 900);
    await take.stop();
    deliver(take, { id: "c08-01-landing-search-map", chapter: "c08", what: "Hosted landing: the search section (each step and its right-first share) and the map of agents and Aiven services" });
  }

  if (on("try")) {
    await go(page, "/try");
    const take = new Take("c07-01");
    await take.record(page);
    take.event("/try: connect your own agent with one address and a signed mandate");
    await sleep(3000);
    await slow(page, 1600, 220, 900);
    await take.stop();
    deliver(take, { id: "c07-01-try", chapter: "c07", what: "Hosted /try: the open door for an outside agent (MCP address, mandate, the tools)" });
  }

  if (on("docs")) {
    await go(page, "/docs");
    const take = new Take("c07-02");
    await take.record(page);
    take.event("/docs: the OpenAPI document and the MCP tools");
    await sleep(3000);
    await slow(page, 1600, 240, 900);
    await take.stop();
    deliver(take, { id: "c07-02-docs", chapter: "c07", what: "Hosted /docs: the documented interface (OpenAPI, MCP tools)" });
  }

  for (const [key, path, id, what, label] of [
    ["platform", "/ops/platform", "c08-02-platform", "Hosted Platform: The platform (what runs on Aiven, live)", "The platform: eight Aiven services, one job each, live"],
    ["observe", "/ops/platform/observe", "c08-03-observe", "Hosted Platform: Observe (dashboards and alerts)", "Observe: dashboards and alerts"],
    ["stream", "/ops/platform/stream", "c08-04-stream", "Hosted Platform: The stream (dock.actions on Kafka, arriving live)", "The stream: every action on Kafka"],
  ] as const) {
    if (!on(key)) continue;
    await go(page, path);
    await sleep(2500);
    const take = new Take(id);
    await take.record(page);
    take.event(label);
    await sleep(3000);
    await slow(page, 1400, 240, 1100);
    await take.stop();
    deliver(take, { id, chapter: "c08", what });
  }

  if (on("ask")) {
    await go(page, "/ops/platform/ask");
    const take = new Take("c08-05");
    await take.record(page);
    take.event("Ask the platform: the copilot answers from the records");
    await sleep(1500);
    const field = page.locator("#copilot-q");
    await type(field, "How many orders were refused in the last hour, and by which rule?", { enter: true, cps: 22 });
    take.event("question asked");
    await take.wait(async () => {
      await sleep(4000);
      await quiet(page, 90_000);
      await sleep(3000);
    });
    take.event("the answer, with the query it ran");
    await sleep(2000);
    await slow(page, 900, 220, 1300);
    await take.stop();
    deliver(take, { id: "c08-05-ask", chapter: "c08", what: "Hosted Platform: Ask the platform, one question answered from the records" });
  }

  if (on("agent")) {
    await go(page, "/ops/platform/agent");
    const take = new Take("c07-03");
    await take.record(page);
    take.event("Send in an Aiven agent: a buyer AimoPilot does not run");
    await sleep(3000);
    const send = page.getByRole("button", { name: /^Send in the agent$/ }).first();
    if (await send.isEnabled().catch(() => false)) {
      await click(send);
      take.event("sent in: it connects over MCP with a mandate minted for this run");
      // its steps arrive on the right; wait until the run has ended (compressed)
      await take.wait(async () => {
        const end = Date.now() + 240_000;
        while (Date.now() < end) {
          if (await page.getByRole("button", { name: /^Send in the agent$/ }).first().isEnabled().catch(() => false)) break;
          await sleep(1500);
        }
      });
      take.event("the run ended: stopped at a person's sign-off like every other agent");
      await sleep(2500);
      await moveTo(page, 1000, 500);
      await slow(page, 900, 220, 1300);
    } else {
      take.event("(the button was not available: a run was going or the day's runs were used)");
      await sleep(4000);
    }
    await take.stop();
    deliver(take, { id: "c07-03-aiven-agent", chapter: "c07", what: "Hosted: Send in an Aiven agent, one live run: an agent on Aiven Managed Agents connects over MCP, searches, quotes, tries to order and stops at the sign-off" });
  }

  if (on("history")) {
    await go(page, "/ops/trace");
    const take = new Take("c06-09");
    await take.record(page);
    take.event("hosted Trace: requests from the real site");
    await sleep(2500);
    await slow(page, 700, 220, 900);
    await go(page, "/ops/time-machine");
    take.event("hosted Time machine");
    await sleep(2500);
    await slow(page, 700, 220, 900);
    await take.stop();
    deliver(take, { id: "c06-09-hosted-trace-time", chapter: "c06", what: "Hosted (visitor): Trace list and Time machine with the site's own history" });
  }
  if (on("tested")) {
    await go(page, "/ops/agents");
    const take = new Take("c09-01");
    const crash = page.locator("#crash");
    if (await crash.count()) await crash.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -90));
    await sleep(1500);
    await take.record(page);
    take.event("the crash test: thirteen hard purchasing situations; the worst run sets the licence");
    await sleep(3000);
    await slow(page, 700, 220, 1100);
    await go(page, "/ops/safeguards");
    take.event("Safeguards: the gate's rules and how often each fired");
    await sleep(2500);
    await slow(page, 700, 220, 1100);
    await take.stop();
    deliver(take, { id: "c09-01-crash-safeguards", chapter: "c09", what: "Hosted (visitor): the Agents page's crash-test ratings, then Safeguards with how often each rule fired" });
  }
  void hover;
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
