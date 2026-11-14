import { expect, test } from "@playwright/test";

/**
 * The Platform pages for a visitor without the passcode (the opsTry door, server/ops/try-caps.ts): the actions named
 * there are open, capped per address, and say what they cost; on this hermetic server Aiven is not configured, so the
 * agent plays a recording and the copilot says the data does not say. Every other action stays staff only.
 */

test("a visitor can send in the agent and ask the platform; suspending an agent stays staff only", async ({ page }) => {
  // Send in an Aiven agent: no "Staff only", a button that works, a recording clearly marked as one.
  await page.goto("/ops/platform/agent");
  await expect(page.getByText("Each button plays a recording of a real run here")).toBeVisible();
  await expect(page.getByText("Staff only", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Play the recording" }).first().click();
  await expect(page.getByText(/Recording of a real run/)).toBeVisible();
  await expect(page.getByText(/Playing a recording of a real run instead/)).toBeVisible();

  // Ask the platform: the question is answered with a card, and the page says what is left from this address.
  await page.goto("/ops/platform/ask");
  await expect(page.getByText(/From this address: \d+ of 20 questions an hour left/)).toBeVisible();
  await page.locator("#copilot-q").fill("How many orders were committed today?");
  await page.getByRole("button", { name: "Ask the platform" }).click();
  await expect(page.getByText(/The data does not say\. Neither the read-only database user nor the Aiven MCP server is configured on this server/)).toBeVisible();
  await expect(page.getByText("Staff only", { exact: false })).toHaveCount(0);

  // A staff action through the same browser: refused with the reason.
  const res = await page.request.post("/ops-api/control", { data: { action: "suspend", scope: "agent", target: "agent_demo", reason: "a visitor tries" } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("staff_only");
});
