"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useUser } from "@/lib/auth/client";
import { APP_NAME } from "@/lib/brand";
import { AccountMenu } from "@/components/account/account-menu";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { NotificationBell } from "@/components/notifications/bell";
import { Logo } from "@/components/brand/logo";
import { BrowserWorkspace } from "@/components/browser/workspace";

/**
 * The frame of the Jobs page: the name, the way back to the chat, the theme and the account.
 *
 * In the desktop app a link pressed anywhere in the window opens in the app's live browser, and
 * a run is full of links to its sources. So there the page sits in the same workspace the chat
 * does: the browser opens beside it, and the page narrows to make room. What is inside lays
 * itself out by the width of this column (`@container/jobs`), not of the window, for that reason.
 */
export function JobsShell({ inApp, children }: { inApp: boolean; children: React.ReactNode }) {
  const user = useUser();
  const page = (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-1 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}: back to the chat`}>
            <Logo size={32} className="rounded-[0.6rem] shadow-card" />
            <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
          </Link>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[0.66rem] font-semibold tracking-wider text-brand uppercase">Jobs</span>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Link
              href="/"
              aria-label="Back to the chat"
              className="mr-1 flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.82rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Back to the chat</span>
            </Link>
            {/* Notices reach every page, and a window open here counts as "the user is here". */}
            <NotificationBell />
            <ThemeToggle />
            <AccountMenu variant="badge" />
          </div>
        </div>
      </header>

      <main className="@container/jobs mx-auto w-full max-w-[1180px] flex-1 px-4 pt-6 pb-[max(env(safe-area-inset-bottom),3rem)] sm:px-6 sm:pt-8">{children}</main>
    </>
  );

  if (!inApp) return <div className="backdrop-room flex min-h-dvh flex-col bg-background">{page}</div>;
  return (
    <div className="flex h-dvh bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Nothing here asks the user to step in on a page, so there is never a hand-over to answer. */}
        <BrowserWorkspace accountId={user.id} onHandoverDone={() => {}}>
          <div data-jobs-scroll className="backdrop-room flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {page}
          </div>
        </BrowserWorkspace>
      </div>
    </div>
  );
}
