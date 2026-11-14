import type { Metadata } from "next";
import { AccountsScreen } from "./accounts";

export const metadata: Metadata = { title: "Accounts" };

/** /ops/accounts: every account as a kitchen, when it signed up and last ordered; reset the shared test accounts. */
export default function AccountsPage() {
  return <AccountsScreen />;
}
