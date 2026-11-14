"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarClock, ChartNoAxesCombined, ChevronsUpDown, LogOut, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialsOf, signOut, useUser } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationSettings } from "@/components/notifications/settings";

/** The account's initials in a small round badge. */
export function AccountBadge({ user, className }: { user: Pick<SessionUser, "name" | "email">; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.72rem] font-semibold tracking-wide text-brand", className)}>
      {initialsOf(user)}
    </span>
  );
}

/** The pages the menu leads to. The first two are the admin's. */
const PAGES = [
  { href: "/admin", label: "Usage", icon: ChartNoAxesCombined, admin: true },
  { href: "/admin/accounts", label: "Accounts", icon: Users, admin: true },
  { href: "/jobs", label: "Jobs", icon: CalendarClock, admin: false },
] as const;

/** True when `pathname` is that page or one beneath it. "/admin" is only itself: the accounts page is its own entry. */
const isOn = (pathname: string, href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

/**
 * Who is signed in, and where they can go. It is the same list wherever it is shown: Usage and
 * Accounts for the admin, then Jobs, Notifications and Sign out for everyone. In the conversation
 * list it is a full row at the bottom; in a page's bar (the chat's included) it is just the badge.
 */
export function AccountMenu({ variant = "row" }: { variant?: "row" | "badge" }) {
  const user = useUser();
  const pathname = usePathname() ?? "/";
  const [leaving, setLeaving] = React.useState(false);
  const [notifications, setNotifications] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        {variant === "row" ? (
          <DropdownMenuTrigger
            aria-label={`Account: ${user.name}`}
            className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
          >
            <AccountBadge user={user} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.84rem] leading-tight font-medium">{user.name}</span>
              <span className="block truncate text-[0.72rem] leading-tight text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown className="mr-1 size-3.5 shrink-0 text-subtle" />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger aria-label={`Account: ${user.name}`} className="shrink-0 rounded-full outline-none transition-opacity hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/40">
            <AccountBadge user={user} className="size-9 text-[0.76rem]" />
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent align={variant === "row" ? "start" : "end"} side={variant === "row" ? "top" : "bottom"} className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="flex items-center gap-2 truncate text-[0.85rem] font-medium text-foreground">
              <span className="truncate">{user.name}</span>
              {user.role === "admin" ? <span className="rounded-full bg-brand-soft px-1.5 py-px text-[0.62rem] font-semibold tracking-wider text-brand uppercase">Admin</span> : null}
            </span>
            <span className="truncate text-[0.76rem] text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PAGES.filter((page) => !page.admin || user.role === "admin").map((page) => {
            const here = isOn(pathname, page.href);
            return (
              <DropdownMenuItem key={page.href} asChild>
                <Link href={page.href} aria-current={here ? "page" : undefined} className={cn(here && "font-medium text-foreground")}>
                  <page.icon className="size-4" />
                  {page.label}
                  {/* The page you are on is marked, not left out: the list is the same everywhere. */}
                  {here ? <span aria-hidden className="ml-auto size-1.5 rounded-full bg-brand" /> : null}
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuItem onSelect={() => setNotifications(true)}>
            <Bell className="size-4" />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={leaving}
            onSelect={() => {
              setLeaving(true);
              void signOut();
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NotificationSettings open={notifications} onOpenChange={setNotifications} />
    </>
  );
}
