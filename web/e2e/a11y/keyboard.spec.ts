import { expect, test, type Page } from "@playwright/test";
import { approvalState } from "../support/dock";
import { note, openApproval, PHONE, settle } from "../support/a11y-kit";

/**
 * Keyboard only (Tab, Shift+Tab, Enter, Space; no mouse, no fill): complete an order on the store's order lane
 * (suggested request, offline example reader since the model is off, mistake check, options, fixed price, the gate),
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

test("order lane: request to gate with the keyboard only", async ({ page }) => {
  await page.goto("/k/kaari/order");
  await expect(page.getByRole("button", { name: "Write a request" })).toBeVisible();
  await settle(page);
  const log: string[] = [];
  const step = async (label: string, re: RegExp, key: "Enter" | " ", wait: () => Promise<unknown>, nth = 1) => {
    const presses = await tabTo(page, re, nth);
    await page.keyboard.press(key);
    await wait();
    const after = await focusedName(page);
    log.push(`${label}: ${presses} Tab presses, ${key === " " ? "Space" : "Enter"}; focus afterwards: ${after}`);
  };

  await step("suggested request", /^1,000 litres of lactose-free milk by Monday$/, "Enter", () =>
    expect(page.getByRole("button", { name: "Use the offline example reader" })).toBeVisible({ timeout: 20_000 }),
  );
  await step("offline example reader", /^Use the offline example reader$/, " ", () => expect(page.getByRole("button", { name: "Yes, I meant that" })).toBeVisible({ timeout: 20_000 }));
  // One concern at a time; on a shared server a second one can follow ("you already asked a moment ago").
  const options = page.getByRole("button", { name: "Get a fixed price for this" }).filter({ visible: true });
  const yes = page.getByRole("button", { name: "Yes, I meant that" }).filter({ visible: true });
  for (let n = 1; n <= 3 && !(await options.count()); n++)
    await step(`mistake check ${n}`, /^Yes, I meant that$/, "Enter", () => expect(options.nth(2).or(yes.first())).toBeVisible({ timeout: 20_000 }));
  await expect(options.nth(2)).toBeVisible({ timeout: 20_000 });
  await step("third option (best)", /^Get a fixed price for this$/, " ", () => expect(page.getByRole("button", { name: "Place the order" })).toBeVisible({ timeout: 20_000 }), 3);
  await step("place the order", /^Place the order$/, "Enter", () =>
    expect(page.getByText(/Refused at the gate|Stopped|Waiting for|Signed order/).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 }),
  );

  for (const l of log) note(test.info(), "keyboard", l);
  await test.info().attach("keyboard-order-lane.txt", { body: log.join("\n"), contentType: "text/plain" });
  const lost = log.filter((l) => l.endsWith("<body>"));
  if (lost.length) note(test.info(), "focus lost", `${lost.length} of ${log.length} steps drop focus to <body> (the pressed button unmounts and nothing takes focus)`);
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
