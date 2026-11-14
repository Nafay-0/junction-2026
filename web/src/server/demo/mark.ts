/**
 * Whether accounts opened on this deployment are demo accounts (DOCK_DEMO_ACCOUNTS, default on: the public deployment
 * runs on synthetic data only). A demo account may take a sample history, stage conditions for its own kitchen and
 * start over (server/demo/service.ts); the permission is keyed on the account's own mark (accounts/store.ts `demo`),
 * never on this switch alone, so turning it off later leaves accounts already marked as they are.
 */
export function demoAccountsOn(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.DOCK_DEMO_ACCOUNTS?.trim() ?? "");
}

/** Per account, per day: how many conditions it may stage, and how many times it may start over. */
export const DEMO_STAGINGS_PER_DAY = Number(process.env.DOCK_DEMO_STAGINGS_PER_DAY?.trim() || 30) || 30;
export const DEMO_RESETS_PER_DAY = Number(process.env.DOCK_DEMO_RESETS_PER_DAY?.trim() || 10) || 10;
