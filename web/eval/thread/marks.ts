/**
 * No mark left in sight: the agent writes **a figure** and {{a day}} for the store to render, and every place a reply
 * is shown must render them. This opens each kitchen's conversation as it stands on a server (after an evaluation run,
 * so its recorded conversations), at 390 px and 1440 px, opens every "Show the list" and "N steps" under the replies,
 * and fails if any visible text holds "{{", "}}" or a stray "**". The spoken path too: every reply in the thread to a
 * turn that came by voice (the read-back, what the call said) must be plain, since a voice reads it as it is; what
 * the voice model itself is given is made plain at its one door (server/channels/voice/tools.ts runTool, spokenOf).
 *
 *   pnpm tsx eval/thread/marks.ts --url http://localhost:4830 [--kitchens hotel-lumo,kahvila-sointu,koulu-metsola] [--shots dir]
 */
import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = opt("--url") ?? "http://localhost:4830";
const kitchens = (opt("--kitchens") ?? "hotel-lumo,kahvila-sointu,koulu-metsola").split(",").map((s) => s.trim());
const shots = opt("--shots");
const MARK = /\{\{|\}\}|\*\*/;

async function signIn(page: Page, slug: string): Promise<void> {
  await page.goto(`${url}/k`);
  const card = page.locator("li").filter({ hasText: slug }).filter({ has: page.getByRole("button", { name: /^Sign in as / }) }).first();
  await card.getByRole("button", { name: /^Sign in as / }).click();
  await page.waitForURL(`**/k/${slug}**`, { timeout: 30_000 });
}

async function check(slug: string, width: number): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    await signIn(page, slug);
    await page.goto(`${url}/k/${slug}`);
    await page.locator("ol[role=log]").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    // Open what the replies fold away: the lists and the steps.
    for (const b of await page.locator("ol[role=log] button[aria-expanded=false]").all()) await b.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    if (shots) await page.screenshot({ path: `${shots}/marks-${slug}-${width}.png`, fullPage: true });
    const text = await page.locator("body").innerText();
    const seen = text.split("\n").filter((l) => MARK.test(l)).map((l) => `${slug} @${width}: ${l.trim().slice(0, 160)}`);
    // The spoken path: replies to voice turns, from the thread itself.
    const t = (await (await page.request.get(`${url}/ui-api/kitchens/${slug}/thread`)).json()) as { thread?: { turns: { turnId: string; role: string; door?: string; replyTo?: string; line?: string }[] } };
    const turns = t.thread?.turns ?? [];
    const voiced = new Set(turns.filter((x) => x.role === "buyer" && x.door === "voice").map((x) => x.turnId));
    for (const x of turns) if (x.role === "agent" && x.replyTo && voiced.has(x.replyTo) && MARK.test(x.line ?? "")) seen.push(`${slug} (spoken): ${(x.line ?? "").slice(0, 160)}`);
    return seen;
  } finally {
    await browser.close();
  }
}

void (async () => {
  const found: string[] = [];
  for (const k of kitchens) for (const w of [390, 1440]) found.push(...(await check(k, w)));
  if (found.length) {
    console.error(`FAIL: ${found.length} visible line(s) with a mark left unrendered:\n${found.join("\n")}`);
    process.exit(1);
  }
  console.log(`PASS: no "{{", "}}" or "**" in sight on ${kitchens.length} kitchens at 390 and 1440 px.`);
})();
