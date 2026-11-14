"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChartNoAxesCombined, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { AccountMenu } from "@/components/account/account-menu";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { NotificationBell } from "@/components/notifications/bell";
import { Logo } from "@/components/brand/logo";

const TABS = [
  { href: "/admin", label: "Usage", icon: <ChartNoAxesCombined /> },
  { href: "/admin/accounts", label: "Accounts", icon: <Users /> },
];

/**
 * The frame of the admin area: the name, the two sections, the way back to the chat. On a phone
 * the sections move to a row of their own under the bar, so nothing has to shrink.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tabs = (
    <nav aria-label="Admin sections" className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-card">
      {TABS.map((tab) => {
        const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-[0.84rem] font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="backdrop-room flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-1 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}: back to the chat`}>
            <Logo size={32} className="rounded-[0.6rem] shadow-card" />
            <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
          </Link>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[0.66rem] font-semibold tracking-wider text-brand uppercase">Admin</span>

          <div className="mx-auto hidden md:block">{tabs}</div>

          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            <Link
              href="/"
              className="mr-1 hidden h-9 items-center gap-1.5 rounded-full px-3 text-[0.82rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
            >
              <ArrowLeft className="size-4" />
              Back to the chat
            </Link>
            {/* Notices reach every page, and a window open here counts as "the user is here". */}
            <NotificationBell />
            <ThemeToggle />
            <AccountMenu variant="badge" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1120px] px-4 pb-3 md:hidden">{tabs}</div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 pb-[max(env(safe-area-inset-bottom),3rem)] sm:px-6 sm:pt-8">{children}</main>
    </div>
  );
}

/** The heading of an admin page: a title, a line under it, and room on the right for a control. */
export function PageHeading({ title, lead, action }: { title: string; lead: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] leading-[1.15] sm:text-[2.1rem]">{title}</h1>
        <p className="mt-1.5 text-[0.9rem] text-muted-foreground">{lead}</p>
      </div>
      {action}
    </div>
  );
}

/** A panel: the card every figure and table on these pages sits in. */
export function Panel({ title, note, action, className, children }: { title?: string; note?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card/80 p-4 shadow-card backdrop-blur-sm sm:p-5", className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-[0.95rem] font-medium tracking-tight">{title}</h2>
            {note ? <p className="mt-0.5 text-[0.76rem] text-muted-foreground">{note}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** What a panel says when there is nothing to show yet. */
export function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface/50 px-5 py-9 text-center">
      <span className="mb-1 text-subtle [&_svg]:size-5">{icon}</span>
      <p className="text-[0.86rem] font-medium">{title}</p>
      <p className="max-w-[26rem] text-[0.8rem] leading-snug text-muted-foreground">{children}</p>
    </div>
  );
}
