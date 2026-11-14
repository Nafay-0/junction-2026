/**
 * pnpm exec tsx scripts/edge-cost.ts --url http://localhost:3302 [--kitchen kaari] [--wait 60]
 *
 * What one ordinary order through the kitchen store costs at the edge (src/proxy.ts): a phone-sized browser opens
 * the shop, browses the catalogue and one product, asks the purchasing agent for milk in its own words, takes the
 * cards to a fixed price, places the order, then waits on the sign-off screen for `--wait` seconds (the page polls).
 * Every request the browser sends through the proxy is counted against the rules it hits (rulesFor), per rule.
 * Run it against a production build (`pnpm build && pnpm start -p 3302`); it makes one model call (the reader)
 * and a few live price lookups.
 */
import { chromium, devices } from "@playwright/test";
import { rulesFor } from "@/proxy";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const base = arg("url", "http://localhost:3302").replace(/\/$/, "");
const kitchen = arg("kitchen", "kaari");
const waitSeconds = Number(arg("wait", "60"));

type Phase = "browse" | "ask" | "order" | "wait";
const counts = new Map<string, Record<Phase, number>>();
const paths = new Map<string, number>();
let phase: Phase = "browse";
const ZERO = (): Record<Phase, number> => ({ browse: 0, ask: 0, order: 0, wait: 0 });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!url.href.startsWith(base)) return;
    if (/^\/(_next\/static|_next\/image|favicon\.ico|ui-api\/scan\/)/.test(url.pathname)) return; // not through the proxy
    for (const [rule] of rulesFor(r.method(), url.pathname)) {
      const c = counts.get(rule.name) ?? ZERO();
      c[phase]++;
      counts.set(rule.name, c);
    }
    const key = `${r.method()} ${url.pathname.replace(/(req|ord|apr|sbx)_[a-z0-9]+/gi, "$1_…")}`;
    paths.set(key, (paths.get(key) ?? 0) + 1);
  });

  await page.goto(`${base}/k/${kitchen}`);
  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Catalogue" }).click();
  await page.locator("main ul li").first().waitFor();
  await page.locator("main ul li a").first().click().catch(() => undefined);
  await page.waitForTimeout(1500);

  phase = "ask";
  await page.getByRole("button", { name: "Ask the purchasing agent" }).click();
  const field = page.getByLabel("Ask, or say what the kitchen needs");
  await field.fill("100 litres of lactose-free milk for next Thursday, cheapest");
  await field.press("Enter");

  phase = "order";
  const steps: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    const place = page.getByRole("button", { name: "Place the order" });
    if (await place.isVisible().catch(() => false)) {
      await place.click();
      steps.push("place");
      break;
    }
    for (const name of ["Continue with this", "Yes, I meant that", "Get a fixed price for this"]) {
      const b = page.getByRole("button", { name }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click();
        steps.push(name);
        break;
      }
    }
    const answer = page.locator("form button, section button").filter({ hasText: /lowest price|cheapest|no preference/i }).first();
    if (await answer.isVisible().catch(() => false)) {
      await answer.click();
      steps.push("answer");
    }
  }
  await page.waitForTimeout(3000);
  phase = "wait";
  await page.waitForTimeout(waitSeconds * 1000);
  await browser.close();

  const total = ZERO();
  console.log(`One ordinary order on /k/${kitchen} (${steps.join(" > ")}), then ${waitSeconds} s on the sign-off screen:`);
  console.log(`${"rule".padEnd(24)} browse  ask  order  wait(${waitSeconds}s)  total`);
  for (const [name, c] of [...counts.entries()].sort()) {
    const sum = c.browse + c.ask + c.order + c.wait;
    console.log(`${name.padEnd(24)} ${String(c.browse).padStart(6)} ${String(c.ask).padStart(4)} ${String(c.order).padStart(6)} ${String(c.wait).padStart(9)} ${String(sum).padStart(6)}`);
    if (name === "any") for (const p of ["browse", "ask", "order", "wait"] as Phase[]) total[p] += c[p];
  }
  console.log("\nBy path:");
  for (const [p, n] of [...paths.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${p}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
