"use client";

import * as React from "react";
import { BellRing, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { fetchNotifyWhenDone, setNotifyWhenDone } from "@/lib/notifications/client";
import { SLOW_AFTER_MS } from "@/lib/notifications/types";

/** How long after it starts working a chat asks the server where things stand: long enough that a quick answer never asks. */
const ASK_AFTER_MS = 4000;

/**
 * "This is taking a while." Shown just above the message box once a chat has been working for a
 * while in one go, with a way to be told when it is done, so the user can go and do something
 * else. Saying yes puts a notice in the app when the chat finishes, and an email if they are away
 * by then.
 *
 * It is mounted while the chat is working and taken down when it stops, so its clock starts with
 * the work. After a reload the work may have been going for longer than this view has existed,
 * and the user may already have said yes: the server is asked for both.
 */
export function SlowNote({ conversationId }: { conversationId: string }) {
  const [slow, setSlow] = React.useState(false);
  const [asked, setAsked] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let gone = false;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const ask = setTimeout(() => {
      void fetchNotifyWhenDone(conversationId).then((state) => {
        if (gone) return;
        if (state.on) setAsked(true);
        if (state.on || (state.workingForMs ?? 0) >= SLOW_AFTER_MS) setSlow(true);
      });
    }, ASK_AFTER_MS);
    return () => {
      gone = true;
      clearTimeout(timer);
      clearTimeout(ask);
    };
  }, [conversationId]);

  const set = (on: boolean) => {
    setSaving(true);
    void setNotifyWhenDone(conversationId, on).then((saved) => {
      setSaving(false);
      if (saved) setAsked(on);
      else toast.error("That did not work. Try again.");
    });
  };

  if (!slow) return null;
  return (
    <div role="status" className="mb-2 flex animate-fade flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-card px-3.5 py-2 text-[0.82rem] shadow-card">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {asked ? <Check className="size-4 shrink-0 text-brand" strokeWidth={2.5} /> : <BellRing className="size-4 shrink-0 text-brand" />}
        <span className="leading-snug">{asked ? "You'll get a notification when it's done." : "This is taking a while."}</span>
      </span>
      {asked ? (
        <button type="button" disabled={saving} onClick={() => set(false)} className="rounded-full px-2 py-1 text-[0.78rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60">
          Undo
        </button>
      ) : (
        <button
          type="button"
          disabled={saving}
          onClick={() => set(true)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[0.8rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Notify me when it&apos;s done
        </button>
      )}
    </div>
  );
}
