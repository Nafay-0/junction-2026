import { expect, test } from "@playwright/test";
import { watchErrors } from "../support/dock";

/**
 * The address opens on the landing page; the wall moved to /wall. Both are checked here, on every engine and size of
 * the demo projects: the landing page's ways in lead where they say, nothing scrolls sideways, every picture has
 * words for a screen reader and a size so nothing shifts, and the wall still shows its join code at its new address.
 */

test("/ is the landing page: the ways in, no sideways scroll, every picture described and sized", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Let AI do the buying. Keep the last word." })).toBeVisible();
  await expect(page.getByText(/demo on synthetic data/i).first()).toBeVisible();
  await expect(page.getByText(/Built for Valio Aimo's Trusted Trade Agents challenge, Junction 2026\./)).toBeVisible();

  // The primary button, in the header, the hero and at the foot of the page, all to the test kitchens.
  const talk = page.getByRole("link", { name: /^Talk to the agent/ });
  expect(await talk.count()).toBeGreaterThanOrEqual(3);
  for (const href of await talk.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) expect(href).toBe("/k");
  await expect(page.getByRole("link", { name: "Sign up your restaurant" }).first()).toHaveAttribute("href", "/k/signup");
  await expect(page.getByRole("link", { name: "Watch it live" }).first()).toHaveAttribute("href", "/wall");

  // Every section is there, in order.
  const h2 = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(h2).toEqual([
    "Watch the agent work",
    "Search that reads the requirement",
    "Never trust the model",
    "Six agents, one gate",
    "Each one, at work",
    "One product, every screen",
    "Run it like a business",
    "Mail a business would send",
    "The two-minute film",
    "Honest about what it is",
    "Talk to the agent",
  ]);
  // The four facts and the comparison carry the measured figures.
  await expect(page.getByText("97 % right first.")).toBeAttached();
  await expect(page.getByText(/attacks on the gate\. \d+ held\./)).toBeAttached();

  // Sideways scroll would mean something does not fit the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);

  // Every screenshot: real alt text and explicit dimensions.
  const imgs = await page.locator("main img").evaluateAll((els) =>
    els.map((e) => ({ src: e.getAttribute("src"), alt: e.getAttribute("alt") ?? "", w: e.getAttribute("width"), h: e.getAttribute("height") })),
  );
  expect(imgs.length).toBeGreaterThan(30);
  for (const i of imgs.filter((x) => x.alt !== "")) {
    expect(i.alt.length, `alt text of ${i.src}`).toBeGreaterThan(20);
    expect(Number(i.w), `width of ${i.src}`).toBeGreaterThan(0);
    expect(Number(i.h), `height of ${i.src}`).toBeGreaterThan(0);
  }
  // Pictures without words repeat a described one (the reel's frames, the story's stage, the phone half of a pair).
  for (const i of imgs.filter((x) => x.alt === "")) expect(await page.locator(`main img[src="${i.src}"][alt=""]`).first().evaluate((e) => !!e.closest("[aria-hidden=true]") || e.getAttribute("aria-hidden") === "true" || !!e.closest("[data-morph]"))).toBe(true);

  // The search chart's figures are the document's.
  await expect(page.getByRole("link", { name: "How we measured" }).first()).toHaveAttribute("href", "/docs/smart-search");
  const doc = await page.request.get("/docs/smart-search");
  expect(doc.status()).toBe(200);
  expect(errors).toEqual([]);
});

test("the first version stays at /landing/classic", async ({ page }) => {
  await page.goto("/landing/classic");
  await expect(page.getByRole("heading", { level: 1, name: /An AI buyer for every kitchen/ })).toBeVisible();
});

test("with reduced motion every step of the story and every figure is on the page at rest", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("[data-step]")).toHaveCount(11);
  for (const step of await page.locator("[data-step]").all()) await expect(step).toHaveCSS("opacity", "1");
  await expect(page.locator(".l2-bar-ours [data-count-to]")).toHaveText("97");
  expect(await page.evaluate(() => document.querySelector(".l2")?.classList.contains("l2-js"))).toBe(false);
  await ctx.close();
});

test("/wall is the wall, with its join code; /screen goes there too", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/wall");
  await expect(page.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
  await expect(page.locator("figure svg").first()).toBeVisible();
  await page.goto("/screen");
  await expect(page).toHaveURL(/\/wall$/);
  await expect(page.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
});
