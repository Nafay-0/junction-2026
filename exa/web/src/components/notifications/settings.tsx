"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { useUser } from "@/lib/auth/client";
import { fetchNotifyPrefs, saveNotifyPrefs } from "@/lib/notifications/client";
import type { NotifyPrefs } from "@/lib/notifications/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

/*
 * Which emails the account gets. Notifications always show in the app; email is for when the
 * user is away. Every switch is saved the moment it is turned.
 */

type Key = keyof NotifyPrefs;

const KINDS: Array<{ key: Key; label: string; hint: string }> = [
  { key: "chats", label: "Chats I asked to hear about", hint: "When a long chat finishes and you chose to be told." },
  { key: "browser", label: "The browser needs me", hint: "When the desktop app waits for your approval, a sign-in or a code." },
  { key: "jobs", label: "Job results", hint: "What a job found, each time it runs." },
];

export function NotificationSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const user = useUser();
  const [prefs, setPrefs] = React.useState<NotifyPrefs | null>(null);

  // Read them each time the dialog opens: they may have been changed on another device.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchNotifyPrefs().then((found) => {
      if (!cancelled) setPrefs(found);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const change = (key: Key, value: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    void saveNotifyPrefs({ [key]: value }).then((saved) => {
      if (saved) setPrefs(saved);
      else {
        setPrefs(before);
        toast.error("That could not be saved. Try again.");
      }
    });
  };

  const off = !prefs?.email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[28rem]">
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-4 text-left sm:px-6 sm:pt-6">
          <DialogTitle className="text-[1.15rem] leading-tight font-semibold tracking-tight">Notifications</DialogTitle>
          <DialogDescription className="text-[0.86rem] leading-relaxed text-muted-foreground">
            You always see notifications in {APP_NAME}. Email is for when you&apos;re away.
          </DialogDescription>
        </DialogHeader>

        <div className="border-t border-border px-5 py-1 sm:px-6">
          <Row
            label="Email notifications"
            hint={
              <>
                Sent to <span className="font-medium break-all text-foreground/90">{user.email}</span>
              </>
            }
            checked={prefs?.email ?? false}
            disabled={!prefs}
            onChange={(value) => change("email", value)}
            strong
          />
        </div>

        <div className={cn("border-t border-border px-5 py-1 transition-opacity sm:px-6", off && "opacity-55")}>
          {KINDS.map((kind) => (
            <Row key={kind.key} label={kind.label} hint={kind.hint} checked={Boolean(prefs?.[kind.key])} disabled={!prefs || off} onChange={(value) => change(kind.key, value)} />
          ))}
        </div>

        <div className={cn("border-t border-border bg-surface/60 px-5 py-1 transition-opacity sm:px-6", off && "opacity-55")}>
          <Row
            label={`Hold emails while I have ${APP_NAME} open`}
            hint="No email about chats or the browser while you're here. Job results are sent either way."
            checked={Boolean(prefs?.quietWhenHere)}
            disabled={!prefs || off}
            onChange={(value) => change("quietWhenHere", value)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
  strong,
}: {
  label: string;
  hint: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  /** The main switch reads a little heavier than the ones under it. */
  strong?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-4 py-3">
      <label htmlFor={id} className={cn("min-w-0 flex-1", disabled ? "cursor-default" : "cursor-pointer")}>
        <span className={cn("block text-[0.88rem] leading-snug", strong ? "font-semibold" : "font-medium")}>{label}</span>
        <span className="mt-0.5 block text-[0.78rem] leading-snug text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
