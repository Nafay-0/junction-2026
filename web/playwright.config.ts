import { defineConfig, devices, type Project } from "@playwright/test";

/**
 * Browser suite for the live demo (see e2e/README.md).
 *
 *   pnpm e2e                 build, then the whole suite: demo paths on Chromium, WebKit and Firefox at phone and
 *                            desktop size, room conditions, accessibility, visual comparison
 *   pnpm e2e:quick           the demo paths on Chromium phone + WebKit phone only (before a deploy)
 *   pnpm e2e --project=webkit-phone e2e/demo/approval.spec.ts    one engine, one file
 *   E2E_BASE_URL=https://<host> pnpm exec playwright test --project=chromium-phone e2e/demo   a deployed server
 *
 * Servers: e2e/support/start-server.mjs starts a hermetic production server (seed catalogue, no model, no partner,
 * no Aiven, no secrets from .env.local) on E2E_PORT (default 4601), and a second one with the public rate limits on,
 * on E2E_PORT + 1, for the crowd tests in e2e/room. Both from the existing `.next` build.
 * Needs the browsers once: `pnpm exec playwright install chromium webkit firefox`.
 */
const port = Number(process.env.E2E_PORT ?? 4601);
const limitsPort = port + 1;
const remote = process.env.E2E_BASE_URL?.replace(/\/$/, "");
export const LIMITS_URL = process.env.E2E_LIMITS_URL ?? (remote ? undefined : `http://localhost:${limitsPort}`);
process.env.E2E_LIMITS_URL = LIMITS_URL ?? "";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

// Fake microphone: Chromium and Firefox can feed a synthetic audio device and skip the permission prompt.
// WebKit has no fake media device in Playwright; the call-screen microphone tests skip there.
const chromiumMedia = { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] };
const firefoxMedia = {
  firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true, "permissions.default.microphone": 1 },
};

const demo = (name: string, use: Project["use"]): Project => ({ name, testDir: "e2e/demo", use });

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? (process.env.CI ? 2 : 4)),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }], ["github"]]
    : [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: remote ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "en-GB",
    timezoneId: "Europe/Helsinki",
  },
  projects: [
    demo("chromium-phone", { ...devices["Pixel 7"], launchOptions: chromiumMedia, permissions: ["microphone"] }),
    demo("webkit-phone", { ...devices["iPhone 15"] }),
    demo("firefox-phone", { browserName: "firefox", viewport: PHONE, hasTouch: true, launchOptions: firefoxMedia }),
    demo("chromium-desktop", { ...devices["Desktop Chrome"], viewport: DESKTOP, launchOptions: chromiumMedia, permissions: ["microphone"] }),
    demo("webkit-desktop", { ...devices["Desktop Safari"], viewport: DESKTOP }),
    demo("firefox-desktop", { ...devices["Desktop Firefox"], viewport: DESKTOP, launchOptions: firefoxMedia }),
    // The room: slow network, hidden page, dropped stream, a crowd behind one address. Chromium (network
    // emulation and CDP are Chromium-only), phone size.
    { name: "room", testDir: "e2e/room", use: { ...devices["Pixel 7"], launchOptions: chromiumMedia } },
    { name: "a11y", testDir: "e2e/a11y", use: { ...devices["Desktop Chrome"], viewport: DESKTOP } },
    { name: "visual", testDir: "e2e/visual", use: { ...devices["Desktop Chrome"], viewport: DESKTOP } },
    // The old single-file specs at e2e/*.spec.ts (restart proof needs a deployed server).
    { name: "legacy", testMatch: /e2e\/[^/]+\.spec\.ts$/, testDir: "e2e", use: { ...devices["Pixel 7"] } },
  ],
  webServer: remote
    ? undefined
    : [
        { command: `node e2e/support/start-server.mjs ${port}`, url: `http://localhost:${port}/api/v1`, reuseExistingServer: !!process.env.E2E_REUSE, timeout: 90_000 },
        {
          command: `node e2e/support/start-server.mjs ${limitsPort}`,
          url: `http://localhost:${limitsPort}/api/v1`,
          reuseExistingServer: !!process.env.E2E_REUSE,
          timeout: 90_000,
          env: { E2E_SERVER_ENV: JSON.stringify({ DOCK_RATE_LIMITS: "on" }) },
        },
      ],
});
