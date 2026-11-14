/**
 * A judge presses "Start a fresh kitchen" and plays:
 *
 *   pnpm tsx eval/demo/fresh-walkthrough.ts --url http://localhost:4790 [--out dir]
 *
 * Sign-in page and the fresh kitchen's opening at 390 and 1440 px; then, at 390 px with a virtual passkey: three
 * unrelated orders in words (one non-food, one large), a dish planned, a sample history added, a limit given, an
 * order over it OK'd with this browser's passkey. Writes report.json with what the agent said at each step.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import type { Thread } from "@/server/thread/types";

const args = process.argv.slice(2);
const opt = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const base = opt("--url", "http://localhost:4790")!;
const out = opt("--out", "/Users/macbookair/dock-shots/free-kitchen")!;
fs.mkdirSync(out, { recursive: true });
const steps: { step: string; ok: boolean; said: string[]; note?: string }[] = [];

async function context(browser: import("@playwright/test").Browser, width: number): Promise<{ ctx: BrowserContext; page: Page }> {
  const phone = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: "en-GB" });
  await ctx.addCookies([{ name: "aimopilot-lang", value: "en", url: base }]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { ctx, page };
}

async function main() {
  const browser = await chromium.launch();
  // ---------- the sign-in page and the opening at 1440 ----------
  {
    const { ctx, page } = await context(browser, 1440);
    await page.goto(`${base}/k`);
    await page.getByTestId("way-fresh").waitFor();
    await page.screenshot({ path: path.join(out, "signin-1440.png"), fullPage: true });
    await page.getByRole("button", { name: /^Start a fresh kitchen$/ }).click();
    await page.waitForURL(/\/k\/fresh-/, { timeout: 60_000 });
    await page.getByTestId("fresh-opening").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(out, "opening-1440.png") });
    await ctx.close();
  }
  const { page } = await context(browser, 390);
  await page.goto(`${base}/k`);
  await page.getByTestId("way-fresh").waitFor();
  await page.screenshot({ path: path.join(out, "signin-390.png"), fullPage: true });
  await page.getByRole("button", { name: /^Start a fresh kitchen$/ }).click();
  await page.waitForURL(/\/k\/fresh-/, { timeout: 60_000 });
  const username = new URL(page.url()).pathname.split("/")[2];
  await page.getByTestId("fresh-opening").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(out, "opening-390.png") });
  steps.push({ step: "start", ok: true, said: [((await page.getByTestId("fresh-opening").textContent()) ?? "").trim()], note: username });

  // Pressing the button again in the same browser gives the same kitchen back.
  const again = await page.request.post(`${base}/ui-api/account/fresh`, { data: {}, headers: { origin: base } });
  steps.push({ step: "same browser again", ok: ((await again.json()) as { next: string }).next === `/k/${username}`, said: [] });

  const thread = async () => {
    const r = await page.request.get(`${base}/ui-api/kitchens/${username}/thread`);
    return r.ok() ? ((await r.json()) as { thread: Thread }).thread : undefined;
  };
  const agentPage = async () => {
    if (!page.url().endsWith(`/k/${username}`)) await page.goto(`${base}/k/${username}`);
    await page.getByRole("log").first().waitFor({ timeout: 30_000 });
  };
  const say = async (words: string) => {
    await agentPage();
    const before = (await thread())?.turns.length ?? 0;
    const field = page.getByRole("textbox").last();
    await field.fill(words);
    await field.press("Enter");
    const end = Date.now() + 150_000;
    let last: Thread | undefined;
    while (Date.now() < end) {
      await page.waitForTimeout(1500);
      last = await thread();
      const agent = (last?.turns ?? []).slice(before).filter((t) => t.role === "agent");
      if (agent.length && agent.every((t) => t.role === "agent" && t.status !== "working")) break;
    }
    await page.waitForTimeout(800);
    const turns = (last?.turns ?? []).slice(before);
    const lines = turns.flatMap((t) => (t.role === "agent" ? [t.line ?? "", ...t.cards.map((c) => `[${c.type}${"status" in c && typeof c.status === "string" ? `:${c.status}` : ""}]`)] : [])).filter(Boolean);
    return { lines, status: turns.filter((t) => t.role === "agent").map((t) => (t.role === "agent" ? t.status : "")).at(-1) ?? "none" };
  };
  const asks = (r: { lines: string[]; status: string }) => r.status === "waiting_buyer" || r.lines.some((l) => /\?\s*$/.test(l));
  const signHere = async () => {
    const b = page.getByRole("log").first().getByRole("button", { name: /(OK with|Sign with|Add this device and sign)/ }).last();
    await b.scrollIntoViewIfNeeded().catch(() => undefined);
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      await page.waitForTimeout(5000);
      return true;
    }
    return false;
  };
  const order = async (step: string, words: string, yes = "Yes, order it.") => {
    let r = await say(words);
    const said = [...r.lines];
    for (let i = 0; i < 3 && asks(r) && !said.some((l) => /\[order:committed\]/.test(l)); i++) {
      r = await say(yes);
      said.push(...r.lines);
    }
    const ok = said.some((l) => /\[order:(committed|pending_approval)\]/.test(l));
    steps.push({ step, ok, said });
    await page.screenshot({ path: path.join(out, `${step.replace(/\W+/g, "-")}-390.png`) });
    console.log(JSON.stringify(steps.at(-1)).slice(0, 600));
  };

  await order("milk", "Order 20 litres of milk for Friday.");
  await order("non-food", "Order 3 packs of paper napkins for Friday.");
  await order("large", "Order 800 litres of lactose-free milk for Monday.", "Yes, 800 litres is right. Order it.");
  {
    const a = await say("Plan a dish for 30 covers for Friday.");
    const said = [...a.lines];
    if (asks(a)) said.push(...(await say("Surprise me.")).lines);
    said.push(...(await say("The first one.")).lines);
    steps.push({ step: "plan a dish", ok: said.some((l) => /Which one shall I plan|\[menu\]|\[dish/.test(l)), said });
    await page.screenshot({ path: path.join(out, "dish-390.png") });
    console.log(JSON.stringify(steps.at(-1)).slice(0, 600));
  }
  {
    const r = await page.request.post(`${base}/ui-api/kitchens/${username}/demo`, { data: { action: "sample" }, headers: { origin: base } });
    const body = (await r.json()) as { sample?: { orders: number } };
    steps.push({ step: "sample history", ok: r.ok() && (body.sample?.orders ?? 0) > 0, said: [`${body.sample?.orders ?? 0} sample orders`] });
    await page.goto(`${base}/k/${username}/guide`);
    await page.locator('[data-row="flow"]').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(out, "guide-390.png"), fullPage: true });
  }
  {
    await page.goto(`${base}/k/${username}/agent#fresh`);
    await page.getByTestId("fresh-limits").waitFor({ timeout: 30_000 });
    const before = (await page.getByTestId("fresh-limits").textContent()) ?? "";
    await page.screenshot({ path: path.join(out, "rules-before-limit-390.png") });
    await page.getByRole("button", { name: /Give it a 250 € limit/ }).click();
    await page.getByText(/orders over 250 € now wait/).waitFor({ timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await page.reload();
    await page.getByTestId("fresh-limits").waitFor({ timeout: 30_000 });
    const after = (await page.getByTestId("fresh-limits").textContent()) ?? "";
    steps.push({ step: "give a limit", ok: /250/.test(after), said: [before, after] });
    await page.screenshot({ path: path.join(out, "rules-after-limit-390.png") });
    console.log(JSON.stringify(steps.at(-1)));
  }
  {
    const r = await say("Order 400 litres of milk for Friday.");
    const said = [...r.lines];
    let s = r;
    for (let i = 0; i < 5 && asks(s) && !(await page.getByRole("log").first().getByRole("button", { name: /OK with/ }).last().isVisible().catch(() => false)); i++) {
      s = await say("Yes, order it.");
      said.push(...s.lines);
    }
    await page.screenshot({ path: path.join(out, "over-limit-390.png") });
    const signed = await signHere();
    const t = await thread();
    const last = (t?.turns ?? []).flatMap((x) => (x.role === "agent" ? x.cards : [])).filter((c) => c.type === "order").at(-1) as { status?: string; authorised?: { by: string } } | undefined;
    steps.push({ step: "over the limit, signed here", ok: signed && last?.status === "committed" && last.authorised?.by === "person", said: [...said, `order card: ${last?.status} by ${last?.authorised?.by}`] });
    await page.screenshot({ path: path.join(out, "signed-390.png") });
    console.log(JSON.stringify(steps.at(-1)).slice(0, 600));
  }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ username, steps }, null, 2));
  console.log(`DONE ${username}: ${steps.filter((s) => s.ok).length} of ${steps.length} ok`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ error: String(err), steps }, null, 2));
  process.exit(1);
});
