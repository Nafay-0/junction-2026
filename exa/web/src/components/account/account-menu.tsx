"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CalendarClock, ChevronsUpDown, LayoutDashboard, LogOut, MessagesSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialsOf, signOut, useUser } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

/**
 * Who is signed in, and what they can do about it: see their jobs, choose which emails they get,
 * go to the admin area (the admin only), clear their conversations, sign out. In the conversation list it is a full row at the bottom; in the
 * admin area's header it is just the badge.
 */
export function AccountMenu({
  variant = "row",
  conversationCount = 0,
  onDeleteAll,
  toChat = false,
}: {
  variant?: "row" | "badge";
  /** How many conversations "Delete all conversations" would delete. The item is hidden at 0 or without `onDeleteAll`. */
  conversationCount?: number;
  onDeleteAll?: () => void;
  /** In the admin area: offer the way back to the chat instead of the way to the admin area. */
  toChat?: boolean;
}) {
  const user = useUser();
  const [confirming, setConfirming] = React.useState(false);
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
          <DropdownMenuTrigger aria-label={`Account: ${user.name}`} className="rounded-full outline-none transition-opacity hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/40">
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
          {toChat ? (
            <DropdownMenuItem asChild>
              <Link href="/">
                <MessagesSquare className="size-4" />
                Back to the chat
              </Link>
            </DropdownMenuItem>
          ) : user.role === "admin" ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <LayoutDashboard className="size-4" />
                Usage and Accounts
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/jobs">
              <CalendarClock className="size-4" />
              Jobs
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setNotifications(true)}>
            <Bell className="size-4" />
            Notifications
          </DropdownMenuItem>
          {onDeleteAll && conversationCount > 0 ? (
            <DropdownMenuItem onSelect={() => setConfirming(true)}>
              <Trash2 className="size-4" />
              Delete all conversations
            </DropdownMenuItem>
          ) : null}
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

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[1.2rem]">Delete all conversations?</DialogTitle>
            <DialogDescription>
              {conversationCount === 1 ? "The one conversation" : `All ${conversationCount} conversations`} saved to your account will be deleted, on every device you use. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted">
              Keep them
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDeleteAll?.();
              }}
              className="h-9 rounded-full bg-destructive/10 px-4 text-[0.85rem] font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              Delete all
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
