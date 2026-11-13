import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end test of the phone approval flow in Chromium with a virtual passkey authenticator.
 *   pnpm e2e          builds, starts `next start` on E2E_PORT (default 3107) and runs e2e/*.spec.ts
 *   E2E_BASE_URL=https://<app-host> pnpm exec playwright test   the same against a deployed server (no local server)
 * Needs Playwright's Chromium (`pnpm exec playwright install chromium` once).
 */
const port = Number(process.env.E2E_PORT ?? 3107);
const remote = process.env.E2E_BASE_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: remote ?? `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: remote
    ? undefined
    : {
        command: `pnpm exec next start -p ${port}`,
        url: `http://localhost:${port}/join`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { DOCK_DEMO_TAP_APPROVAL: "", DOCK_PUBLIC_URL: "" },
      },
});
