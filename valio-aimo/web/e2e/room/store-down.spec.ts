import { expect, test, type Page } from "@playwright/test";
import { addPasskey, joinAsApprover } from "../support/dock";

/**
 * The database away, as the phone sees it. The server's answer while PostgreSQL is refused or partitioned is a
 * 503 `store_unavailable` with a sentence (src/server/aiven/pg/errors.ts; measured end to end by
 * tests-live/deps --only pg). Here the browser gets that exact answer for the screens' own calls, and each screen
 * must say what is wrong (not "check your connection", not a blank page) and come back by itself.
 */
const STORE_DOWN = {
  status: 503,
  contentType: "application/json",
  headers: { "retry-after": "10" },
  body: JSON.stringify({
    error: { code: "store_unavailable", rule: "store", message: "AimoPilot cannot reach its database right now, so nothing was saved or changed. Please try again in a few seconds.", details: { retryable: true, retryAfterSeconds: 10 } },
  }),
};

/** Answer `pattern` with store_unavailable until the returned function is called. */
async function storeAway(page: Page, pattern: RegExp) {
  let away = true;
  await page.route(pattern, (route) => (away ? route.fulfill(STORE_DOWN) : route.continue()));
  return () => {
    away = false;
  };
}

test("join while the database is away: it says so, then works by itself when it is back", async ({ page }) => {
  test.setTimeout(90_000);
  await addPasskey(page);
  const back = await storeAway(page, /\/api\/v1\/join$/);
  await page.goto("/join");
  await expect(page.getByText("AimoPilot can't save right now")).toBeVisible();
  await expect(page.getByText(/no kitchen or passkey was created/)).toBeVisible();
  back();
  // the page asks again by itself within about 10 s
  await expect(page.getByRole("button", { name: "Create my passkey and start" })).toBeVisible({ timeout: 20_000 });
});

test("the approver's screen keeps what it showed, says the database is away, and recovers", async ({ page }) => {
  test.setTimeout(90_000);
  await addPasskey(page);
  await joinAsApprover(page);
  const back = await storeAway(page, /\/api\/v1\/approver$/);
  // the screen asks every 5 s; the next answer is store_unavailable
  await expect(page.getByText(/database is not answering/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Waiting for requests")).toBeVisible(); // what it showed is still there
  await expect(page.getByText("Can't reach AimoPilot")).toHaveCount(0);
  back();
  await expect(page.getByText(/database is not answering/)).toHaveCount(0, { timeout: 15_000 });
});

test("opening a sign-off while the database is away names it and retries", async ({ page }) => {
  test.setTimeout(60_000);
  const back = await storeAway(page, /\/api\/v1\/approvals\/apr_storedown/);
  await page.goto("/approve/apr_storedown");
  await expect(page.getByText("AimoPilot can't save right now")).toBeVisible();
  await expect(page.getByText(/nothing was signed or changed/)).toBeVisible();
  back();
  // after the next automatic try, the real answer: no such request
  await expect(page.getByText("No such request")).toBeVisible({ timeout: 20_000 });
});
