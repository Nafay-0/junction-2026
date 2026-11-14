import { TEST_ACCOUNTS } from "./test-accounts";
import type { AccountService } from "./service";

/**
 * The public test accounts are shared, so they are put back to their seed on a schedule:
 * DOCK_TEST_ACCOUNTS_RESET_MINUTES (default 60; 0 turns it off). Not under tests or during a build. One timer per
 * process; it never keeps the process alive.
 */
const g = globalThis as typeof globalThis & { __dockTestResetTimer?: NodeJS.Timeout };

export function testResetMinutes(): number {
  const v = Number(process.env.DOCK_TEST_ACCOUNTS_RESET_MINUTES?.trim() || 60);
  return Number.isFinite(v) && v >= 0 ? v : 60;
}

export function scheduleTestAccountResets(accounts: AccountService): void {
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build" || TEST_ACCOUNTS.length === 0) return;
  const minutes = testResetMinutes();
  if (g.__dockTestResetTimer) clearInterval(g.__dockTestResetTimer);
  if (minutes === 0) return;
  g.__dockTestResetTimer = setInterval(() => {
    void accounts.resetTestAccounts(`automatically, every ${minutes} min`).catch((err) => console.warn("test account reset failed", (err as Error).message));
  }, minutes * 60_000);
  g.__dockTestResetTimer.unref();
}

/** Whether the sign-in page lists the test accounts with their credentials (DOCK_TEST_ACCOUNTS_SHOWN=1). */
export function testAccountsShown(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.DOCK_TEST_ACCOUNTS_SHOWN?.trim() ?? "");
}
