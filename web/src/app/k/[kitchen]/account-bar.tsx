"use client";

import Link from "next/link";
import { CircleUserRound, Timer, UsersRound } from "lucide-react";
import { useText } from "../../_i18n/provider";
import { SignOutButton } from "../_account/forms";
import { ACCOUNT_TEXT } from "./account.text";
import type { KitchenInfo } from "./types";

export type PortalAccount = { username: string; restaurant: string; kitchen?: string; shared: boolean; kind: string };

const LINK = "inline-flex min-h-10 shrink-0 items-center font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol pointer-coarse:min-h-11";

/**
 * One slim line over the store's header: who is signed in and for which restaurant, with sign-out; or how to sign in
 * or keep a visitor kitchen. On a phone the sentence is shortened so the strip stays one line; the full one is there
 * from a tablet up.
 */
export function AccountBar({ kitchen, account }: { kitchen: KitchenInfo; account?: PortalAccount }) {
  const tx = useText(ACCOUNT_TEXT);
  const Icon = account ? CircleUserRound : kitchen.kind === "visitor" ? Timer : UsersRound;
  return (
    <div className="border-b border-line bg-paper">
      <div className="mx-auto flex min-h-10 max-w-[1320px] items-center gap-3 px-4 text-[0.85rem] sm:px-6 xl:px-8">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-ink-soft" data-testid="signed-in-as">
          <Icon aria-hidden size={16} className="shrink-0 text-petrol" />
          {account ? (
            <span className="min-w-0 truncate">
              <span className="text-ink">{tx.signedInAs(account.username, account.restaurant)}</span>
              {account.shared ? <span className="hidden lg:inline">{tx.shared}</span> : null}
            </span>
          ) : kitchen.kind === "visitor" ? (
            <>
              <span className="min-w-0 truncate sm:hidden">{tx.keepVisitorShort}</span>
              <span className="hidden min-w-0 truncate sm:inline">{tx.keepVisitorNote}</span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate sm:hidden">{tx.notSignedInShort}</span>
              <span className="hidden min-w-0 truncate sm:inline">{tx.notSignedIn}</span>
            </>
          )}
        </p>
        {account ? (
          <SignOutButton />
        ) : kitchen.kind === "visitor" ? (
          <Link href="/k/keep" className={LINK}>
            {tx.keepVisitor}
          </Link>
        ) : (
          <Link href="/k" className={LINK}>
            {tx.signIn}
          </Link>
        )}
      </div>
    </div>
  );
}
