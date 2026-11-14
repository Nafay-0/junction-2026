"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarCheck, CalendarX, CircleCheck, Hand, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearNotifications, markNotificationsRead, useNotifications } from "@/lib/notifications/client";
import type { NotificationItem, NotifyKind } from "@/lib/notifications/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationSettings } from "./settings";

/*
 * The bell: what the account has been told, newest first. A chat it asked to hear about has
 * finished, the live browser is waiting for it, a job has run. A press on a notice opens what
 * it is about and marks it read.
 */

const ICONS: Record<NotifyKind, React.ComponentType<{ className?: string }>> = {
  chat_done: CircleCheck,
  needs_you: Hand,
  job_done: CalendarCheck,
  job_failed: CalendarX,
};

/** "5 min ago", for a list that is looked at now and then. */
function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Open what a notice is about: the chat, or the job's page with that run. `onOpenChat` is the
 * shell's way of opening a chat; where there is none (another page), the chat opens by address.
 */
export function useOpenNotification(onOpenChat?: (conversationId: string) => void): (item: NotificationItem) => void {
  const router = useRouter();
  return React.useCallback(
    (item: NotificationItem) => {
      void markNotificationsRead([item.id]);
      if (item.jobId) router.push(`/jobs?job=${encodeURIComponent(item.jobId)}${item.runId ? `&run=${encodeURIComponent(item.runId)}` : ""}`);
      else if (item.conversationId) {
        if (onOpenChat) onOpenChat(item.conversationId);
        else router.push(`/chat/${encodeURIComponent(item.conversationId)}`);
      }
    },
    [router, onOpenChat],
  );
}

export function NotificationBell({ onOpenChat, className }: { onOpenChat?: (conversationId: string) => void; className?: string }) {
  const { items, unread, loaded } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  // The moment the list was opened: what "5 min ago" is counted from.
  const [now, setNow] = React.useState(0);
  const openItem = useOpenNotification(onOpenChat);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setNow(Date.now());
          setOpen(next);
        }}
      >
        <PopoverTrigger
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          title="Notifications"
          className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 data-[state=open]:bg-muted data-[state=open]:text-foreground", className)}
        >
          <Bell className="size-[1.05rem]" />
          {unread > 0 ? (
            <span aria-hidden className="nums absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.6rem] leading-none font-semibold text-primary-foreground ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[min(23rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-2xl p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <p className="flex-1 text-[0.9rem] font-semibold tracking-tight">Notifications</p>
            {unread > 0 ? (
              <button type="button" onClick={() => void markNotificationsRead("all")} className="rounded-full px-2 py-1 text-[0.75rem] font-medium text-brand transition-colors hover:bg-brand-soft">
                Mark all read
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSettings(true);
              }}
              aria-label="Notification settings"
              title="Notification settings"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings2 className="size-4" />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Bell className="size-[1.1rem]" />
              </span>
              <p className="mt-3 text-[0.88rem] font-medium">{loaded ? "Nothing yet" : "Loading"}</p>
              {loaded ? <p className="mx-auto mt-1 max-w-[17rem] text-[0.78rem] leading-snug text-muted-foreground">You&apos;ll see it here when a chat you asked about finishes, the browser needs you, or a job runs.</p> : null}
            </div>
          ) : (
            <ul className="max-h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain py-1">
              {items.map((item) => {
                const Icon = ICONS[item.kind] ?? Bell;
                const opens = Boolean(item.jobId || item.conversationId);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={!opens && item.read}
                      onClick={() => {
                        setOpen(false);
                        openItem(item);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/70 disabled:hover:bg-transparent"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl",
                          item.kind === "needs_you" ? "bg-brass/15 text-brass" : item.kind === "job_failed" ? "bg-destructive/10 text-destructive" : "bg-brand-soft text-brand",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[0.84rem] leading-snug", item.read ? "text-foreground/80" : "font-medium text-foreground")}>{item.title}</span>
                        {item.body ? <span className="mt-0.5 line-clamp-3 text-[0.78rem] leading-snug text-muted-foreground">{item.body}</span> : null}
                        <span className="mt-1 block text-[0.7rem] text-subtle">{ago(item.createdAt, now)}</span>
                      </span>
                      {item.read ? null : <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {items.length > 0 ? (
            <div className="flex items-center justify-between border-t border-border px-4 py-2">
              <span className="text-[0.72rem] text-subtle">Emails only go out when you&apos;re away.</span>
              <button type="button" onClick={() => void clearNotifications()} className="rounded-full px-2 py-1 text-[0.75rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Clear all
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <NotificationSettings open={settings} onOpenChange={setSettings} />
    </>
  );
}
