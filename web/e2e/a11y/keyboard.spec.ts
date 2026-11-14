import { expect, test, type Page } from "@playwright/test";
import { approvalState } from "../support/dock";
import { note, openApproval, PHONE, settle } from "../support/a11y-kit";
import { stageThread } from "../support/thread";

/**
 * Keyboard only (Tab, Shift+Tab, Enter, Space; no mouse, no fill): take a request through the store's thread
 * (suggested request, mistake check, options; a choice fixes the price and goes to the gate),
 * and approve and decline on the phone's sign-off page (the passkey prompt itself belongs to the authenticator).
 * Records how many Tab presses each step took and where focus was after each action. Focus lost to <body> (the pressed
 * button unmounts): Chromium resumes Tab near where it was, but a screen reader loses its place and hears nothing.
 */

test.use({ viewport: PHONE });

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return "<body>";
    return (e.getAttribute("aria-label") || e.innerText || (e as HTMLInputElement).placeholder || "").replace(/\s+/g, " ").trim().slice(0, 80);
  });
}

/** Press Tab until the focused control's name matches (the nth match), and return how many presses it took. */
async function tabTo(page: Page, re: RegExp, nth = 1, max = 120): Promise<number> {
  let hits = 0;
  for (let i = 0; i <= max; i++) {
    if (i > 0) await page.keyboard.press("Tab");
    const name = await focusedName(page);
    if (re.test(name) && ++hits === nth) return i;
  }
  throw new Error(`Tab never reached ${re} (#${nth}) within ${max} presses; last focus "${await focusedName(page)}"`);
}

test("the thread: request to gate with the keyboard only", async ({ page, baseURL }) => {
  const release = await stageThread(page, "kaari", baseURL);
  try {
    await page.goto("/k/kaari/order");
    await expect(page.getByRole("heading", { name: "Order with your agent" })).toBeVisible();
    await settle(page);
    const log: string[] = [];
    const step = async (label: string, re: RegExp, key: "Enter" | " ", wait: () => Promise<unknown>, nth = 1) => {
      const presses = await tabTo(page, re, nth);
      await page.keyboard.press(key);
      await wait();
      const after = await focusedName(page);
      log.push(`${label}: ${presses} Tab presses, ${key === " " ? "Space" : "Enter"}; focus afterwards: ${after}`);
    };

    // A suggested request (the kitchen's own example) is a button in the thread.
    await step("suggested request", /^1,000 litres of lactose-free milk by Monday$/, "Enter", () => expect(page.getByRole("button", { name: /^(Yes, that is right|Choose)$/ }).first()).toBeVisible({ timeout: 20_000 }));
    // The mistake check (one card per concern; a duplicate check can follow on a shared server), until the options.
    for (let n = 1; n <= 4; n++) {
      await page.waitForTimeout(800);
      const presses = await tabTo(page, /^(Yes, that is right|Choose)$/);
      if ((await focusedName(page)) !== "Yes, that is right") break;
      await page.keyboard.press("Enter");
      log.push(`mistake check ${n}: ${presses} Tab presses, Enter; focus afterwards: ${await focusedName(page)}`);
    }
    await expect(page.getByRole("button", { name: "Choose" }).first()).toBeVisible({ timeout: 20_000 });
    // "Best", the first option: a choice orders it, the price is fixed and the gate decides.
    await step("first option (best)", /^Choose$/, " ", () => expect(page.getByText(/^(Waiting for |Placed by the agent alone|Refused: )/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 }));

    for (const l of log) note(test.info(), "keyboard", l);
    await test.info().attach("keyboard-thread.txt", { body: log.join("\n"), contentType: "text/plain" });
    const lost = log.filter((l) => l.endsWith("<body>"));
    if (lost.length) note(test.info(), "focus lost", `${lost.length} of ${log.length} steps drop focus to <body> (the pressed button unmounts and nothing takes focus)`);
    // Taken back with the keyboard, so Kaari keeps no waiting order from this test.
    const back = page.getByRole("button", { name: "Take it back" });
    if (await back.isVisible()) {
      await tabTo(page, /^Take it back$/);
      await page.keyboard.press("Enter");
      await expect(page.getByText("Taken back").first()).toBeVisible({ timeout: 20_000 });
    }
  } finally {
    release();
  }
});

test("sign-off: approve with Tab and Enter", async ({ page }) => {
  const id = await openApproval(page);
  const presses = await tabTo(page, /^Approve \d/);
  note(test.info(), "keyboard", `Approve reached after ${presses} Tab presses`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible({ timeout: 30_000 });
  expect((await approvalState(page.request, id)).view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });
});

test("sign-off: decline with a reason using Tab and Space", async ({ page }) => {
  const id = await openApproval(page);
  await tabTo(page, /^Add reason$/);
  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Too expensive" })).toBeVisible();
  note(test.info(), "keyboard", `focus after opening the reasons: ${await focusedName(page)}`);
  await tabTo(page, /^Too expensive$/);
  await page.keyboard.press(" ");
  await tabTo(page, /^Decline/);
  await page.keyboard.press(" ");
  await expect(page.getByRole("heading", { name: "Declined" })).toBeVisible({ timeout: 30_000 });
  expect((await approvalState(page.request, id)).view?.state).toMatch(/declined/);
});
