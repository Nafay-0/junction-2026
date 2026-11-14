import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Restart proof for the phone path (run against a deployed server; skipped otherwise):
 *
 *   RESTART_PHASE=before RESTART_STATE=<file> E2E_BASE_URL=https://<host> pnpm exec playwright test e2e/restart.spec.ts
 *     a visitor joins with a passkey (virtual authenticator), the agent's order waits for their sign-off;
 *     the passkey (private key included, it is a throwaway test credential), the phone's cookies and the
 *     approval id go to <file>
 *   ... restart the app (node infra/aiven-deploy.mjs --restart) ...
 *   RESTART_PHASE=after  RESTART_STATE=<file> ... the same phone, with the same passkey, signs off: committed.
 *
 * Keep <file> outside the repository (it holds the test passkey and session cookie).
 */
const phase = process.env.RESTART_PHASE;
const stateFile = process.env.RESTART_STATE ?? "";

type Saved = { approvalId: string; credential: Record<string, unknown>; storage: Awaited<ReturnType<ReturnType<Page["context"]>["storageState"]>> };

async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

test.describe("restart proof", () => {
  test.skip(!phase || !stateFile || !process.env.E2E_BASE_URL, "set RESTART_PHASE, RESTART_STATE and E2E_BASE_URL");

  test("before the restart: join with a passkey, an order waits for sign-off", async ({ page }) => {
    test.skip(phase !== "before");
    const { cdp, authenticatorId } = await authenticator(page);
    await page.goto("/join");
    await page.getByRole("button", { name: "Create my passkey and start" }).click();
    await page.waitForURL("**/approver");
    await expect(page.getByText("Waiting for requests")).toBeVisible();
    await page.getByRole("button", { name: /ask my agent for 1,000 L of milk/ }).click();
    await page.waitForURL("**/approve/**");
    await expect(page.getByRole("button", { name: /^Approve €/ })).toBeEnabled();
    const approvalId = page.url().split("/approve/")[1];
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials).toHaveLength(1);
    const saved: Saved = { approvalId, credential: credentials[0] as unknown as Record<string, unknown>, storage: await page.context().storageState() };
    writeFileSync(stateFile, JSON.stringify(saved));
  });

  test("after the restart: the same passkey signs off and the order commits", async ({ browser }) => {
    test.skip(phase !== "after");
    expect(existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, "utf8")) as Saved;
    const context = await browser.newContext({ storageState: saved.storage });
    const page = await context.newPage();
    const { cdp, authenticatorId } = await authenticator(page);
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: saved.credential as never });

    const before = await (await page.request.get(`/api/v1/approvals/${saved.approvalId}`)).json();
    expect(before.view?.state).toBe("pending");
    await page.goto(`/approve/${saved.approvalId}`);
    await page.getByRole("button", { name: /^Approve €/ }).click();
    await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
    const view = await (await page.request.get(`/api/v1/approvals/${saved.approvalId}`)).json();
    expect(view.view).toMatchObject({ state: "committed", outcome: { method: "passkey", verified: true } });
    await context.close();
  });
});
