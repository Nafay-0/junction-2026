import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

/** The passcode e2e/support/start-server.mjs gives the server it starts (E2E_OPS_PASSCODE for a server you run). */
export const OPS_PASSCODE = process.env.E2E_OPS_PASSCODE ?? "e2e-ops";

const SOFT = readFileSync(path.join(__dirname, "soft-passkey.js"), "utf8");

export type Passkey = {
  kind: "virtual" | "soft";
  /** Passkeys this phone holds. */
  count(): Promise<number>;
  /** Forget every passkey (a phone without this passkey). */
  clear(): Promise<void>;
  /** The next passkey prompt fails as a dismissed Face ID sheet does (NotAllowedError). */
  cancelNext(): Promise<void>;
};

/**
 * Give the page's browser context a passkey authenticator. Chromium: the DevTools virtual authenticator (the
 * browser's own WebAuthn stack). WebKit and Firefox have no such hook in Playwright, so they get the software
 * authenticator in soft-passkey.js (a real ES256 credential the server verifies; only the OS sheet is missing).
 * Call before the first navigation. E2E_SOFT_PASSKEY=1 uses the software one on Chromium too.
 */
export async function addPasskey(page: Page): Promise<Passkey> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName === "chromium" && !process.env.E2E_SOFT_PASSKEY) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    return {
      kind: "virtual",
      count: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length,
      clear: async () => void (await cdp.send("WebAuthn.clearCredentials", { authenticatorId })),
      cancelNext: async () => void (await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false })),
    };
  }
  await page.context().addInitScript({ content: SOFT });
  const run = <T>(fn: string) => page.evaluate(fn) as Promise<T>;
  return {
    kind: "soft",
    count: () => run<number>("window.__softPasskey.count()"),
    clear: () => run<void>("window.__softPasskey.clear()"),
    cancelNext: () => run<void>("window.__softPasskey.mode = 'cancel'"),
  };
}

/** Scan the wall's code: /join, one tap for a passkey, land on /approver as the kitchen's approver. */
export async function joinAsApprover(page: Page): Promise<void> {
  await page.goto("/join");
  await expect(page.getByRole("heading", { name: /Become the purchasing manager/ })).toBeVisible();
  await page.getByRole("button", { name: "Create my passkey and start" }).click();
  await page.waitForURL("**/approver", { timeout: 30_000 });
  await expect(page.getByText("Waiting for requests")).toBeVisible();
}

/** The phone asks its own agent for 1,000 L of milk (over the 500 € limit): the request opens by itself. */
export async function askForMilkAndWaitForSignOff(page: Page): Promise<string> {
  await page.getByRole("button", { name: /ask my agent for 1[,  ]?000 L of milk/i }).click();
  await page.waitForURL("**/approve/**", { timeout: 30_000 });
  return page.url().split("/approve/")[1].split(/[?#]/)[0];
}

export const approveButton = (page: Page) => page.getByRole("button", { name: /^Approve \d/ });

/** Open the wall (/) in its own context at big-screen size. */
export async function openWall(context: BrowserContext): Promise<Page> {
  const wall = await context.newPage();
  await wall.setViewportSize({ width: 1920, height: 1080 });
  await wall.goto("/");
  await expect(wall.getByRole("heading", { name: "Scan to become the approver" })).toBeVisible();
  return wall;
}

/** Enter the operations desk with the passcode. */
export async function enterOps(page: Page, name = "E2E operator"): Promise<void> {
  await page.goto("/ops/enter");
  await page.getByLabel("Your name, for the record").fill(name);
  const passcode = page.getByLabel("Passcode");
  if (await passcode.isVisible()) await passcode.fill(OPS_PASSCODE);
  await page.getByRole("button", { name: "Enter as operations staff" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ops/enter"), { timeout: 20_000 });
}

export async function approvalState(request: APIRequestContext, approvalId: string) {
  const res = await request.get(`/api/v1/approvals/${approvalId}`);
  return (await res.json()) as { view?: { state: string; outcome?: { method?: string; verified?: boolean }; details?: { orderId?: string } } };
}

/** Engine name for skips and notes. */
export const engine = (info: TestInfo) => info.project.use.browserName ?? (info.project.use.defaultBrowserType as string) ?? "chromium";

/** Collect uncaught page errors and console errors; assert none at the end of a test. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|net::|NotAllowedError|status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return errors;
}
