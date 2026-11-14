"use client";

import Link from "next/link";
import { useText } from "../../_i18n/provider";
import { SignOutButton } from "../_account/forms";
import { ACCOUNT_TEXT } from "./account.text";
import type { KitchenInfo } from "./types";

export type PortalAccount = { username: string; restaurant: string; kitchen?: string; shared: boolean; kind: string };

/** One line over the store's header: who is signed in and for which restaurant, with sign-out; or how to sign in or keep. */
export function AccountBar({ kitchen, account }: { kitchen: KitchenInfo; account?: PortalAccount }) {
  const tx = useText(ACCOUNT_TEXT);
  return (
    <div className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-[0.9rem] sm:px-6 xl:px-8">
        <p className="min-w-0 leading-snug" data-testid="signed-in-as">
          {account ? (
            <>
              {tx.signedInAs(account.username, account.restaurant)}
              {account.shared ? <span className="text-ink-soft">{tx.shared}</span> : null}
            </>
          ) : kitchen.kind === "visitor" ? (
            <span className="text-ink-soft">{tx.keepVisitorNote}</span>
          ) : (
            <span className="text-ink-soft">{tx.notSignedIn}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {account ? (
            <SignOutButton />
          ) : kitchen.kind === "visitor" ? (
            <Link href="/k/keep" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
              {tx.keepVisitor}
            </Link>
          ) : (
            <Link href="/k" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
              {tx.signIn}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
