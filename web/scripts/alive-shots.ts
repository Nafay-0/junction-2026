/**
 * Screenshots of every operations page and the kitchen's store pages on a running server, at 1440 x 900 and 390 x 844,
 * headless (the repo's own Playwright), to check that no page is empty and each says what it is for.
 *
 *   pnpm tsx scripts/alive-shots.ts --url http://localhost:4870 --passcode alive-ops [--out ~/dock-shots/alive]
 *
 * It signs in to the operations portal with the passcode and to the store as the public test account hotel-lumo,
 * waits for the sample activity to have played (GET /ops-api/sample), and writes one PNG per page and size, plus
 * report.json: per page, whether the purpose line was found and how much text the page shows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";

const args = process.argv.slice(2);
const opt = (f: string, d: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const BASE = opt("--url", "http://localhost:4870");
const PASSCODE = opt("--passcode", "alive-ops");
const OUT = opt("--out", path.join(os.homedir(), "dock-shots/alive"));
const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function json(ctx: BrowserContext, p: string): Promise<Json> {
  const r = await ctx.request.get(new URL(p, BASE).toString());
  return (await r.json()) as Json;
}

async function shoot(page: Page, name: string, url: string, results: Json[]) {
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto(new URL(url, BASE).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const file = path.join(OUT, `${name}-${s.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const info = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
      const purpose = (document.querySelector("h1")?.parentElement?.querySelector("p")?.textContent ?? "").trim();
      return { h1, purpose: purpose.slice(0, 160), chars: (main.textContent ?? "").replace(/\s+/g, " ").length, samplePills: [...document.querySelectorAll("span")].filter((x) => x.textContent?.trim().toLowerCase() === "sample").length, loading: /Reading|Loading|Connecting/.test(main.textContent ?? "") };
    });
    results.push({ name, size: s.name, url, file, ...info });
    console.log(`${name.padEnd(28)} ${s.name.padEnd(7)} h1="${info.h1}" chars=${info.chars} pills=${info.samplePills}${info.purpose ? "" : " NO PURPOSE LINE"}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results: Json[] = [];
  try {
    // ---------- operations ----------
    const ops = await browser.newContext({ baseURL: BASE });
    const enter = await ops.request.post(new URL("/ops-api/session", BASE).toString(), { data: { passcode: PASSCODE, name: "Screenshot script" } });
    if (!enter.ok()) throw new Error(`ops sign-in: HTTP ${enter.status()}`);
    let status: Json = {};
    for (let i = 0; i < 40; i++) {
      status = await json(ops, "/ops-api/sample");
      if (status.current && !status.running) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`sample: ${status.current ? `set ${status.current.set}` : "none"} (setting ${status.setting})`);
    const ids = (status.ids ?? {}) as Record<string, string>;
    const convs = (await json(ops, "/ops-api/conversation")) as Json;
    const thread = (convs.conversations ?? convs.list ?? convs.items ?? [])[0]?.threadId;
    const page = await ops.newPage();
    const opsPages: [string, string][] = [
      ["ops-live", "/ops"],
      ["ops-orders", "/ops/orders"],
      ["ops-order-timeline", `/ops/orders/${ids.approved ?? ""}`],
      ["ops-order-waiting", `/ops/orders/${ids.waiting2 ?? ids.waiting1 ?? ""}`],
      ["ops-order-refused", `/ops/orders/${ids.partnerRefused ?? ""}`],
      ["ops-agents", "/ops/agents"],
      ["ops-watch", "/ops/watch"],
      ["ops-offers", "/ops/offers"],
      ["ops-mail", "/ops/mail"],
      ["ops-conversations", "/ops/conversation"],
      ...(thread ? ([["ops-conversation", `/ops/conversation/${thread}`]] as [string, string][]) : []),
      ["ops-time-machine", "/ops/time-machine"],
      ["ops-platform", "/ops/platform"],
      ["ops-safeguards", "/ops/safeguards"],
      ["ops-audit", "/ops/audit"],
      ["ops-control", "/ops/control"],
      ["ops-customers", "/ops/customers"],
      ["ops-accounts", "/ops/accounts"],
      ["ops-radar", "/ops/radar"],
      ["ops-trace", "/ops/trace"],
    ];
    for (const [name, url] of opsPages) await shoot(page, name, url, results);
    // The same Orders page with the sample hidden: the empty state says what the page is for.
    await ops.addCookies([{ name: "aimopilot-sample", value: "hidden", url: BASE }]);
    await shoot(page, "ops-orders-sample-hidden", "/ops/orders", results);
    await ops.clearCookies({ name: "aimopilot-sample" });

    // ---------- the kitchen's store, as the test account hotel-lumo ----------
    const store = await browser.newContext({ baseURL: BASE });
    const lumo = TEST_ACCOUNTS.find((t) => t.username === "hotel-lumo")!;
    const signin = await store.request.post(new URL("/ui-api/account/signin", BASE).toString(), { data: { username: lumo.username, password: lumo.password } });
    if (!signin.ok()) throw new Error(`store sign-in: HTTP ${signin.status()} ${await signin.text()}`);
    const sp = await store.newPage();
    const k = "/k/hotel-lumo";
    const storePages: [string, string][] = [
      ["store-agent-landing", k],
      ["store-orders", `${k}/orders`],
      ...(ids.lumoWaiting ? ([["store-order-waiting", `${k}/orders/${ids.lumoWaiting}`]] as [string, string][]) : []),
      ["store-basket", `${k}/basket`],
      ["store-catalogue", `${k}/catalogue`],
      ["store-week", `${k}/week`],
      ["store-menu", `${k}/menu`],
      ["store-agent-rules", `${k}/agent`],
    ];
    for (const [name, url] of storePages) await shoot(sp, name, url, results);
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} screenshots in ${OUT}`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
