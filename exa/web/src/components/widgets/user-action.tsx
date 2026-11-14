"use client";

import * as React from "react";
import { Check, CreditCard, Hand, KeyRound, MonitorPlay, ScanFace, ShieldCheck, SkipForward, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import type { HandoverAnswer, HandoverKind } from "@/lib/browser/protocol";

export type UserActionInput = { kind?: HandoverKind; reason?: string; site?: string };

const COPY: Record<HandoverKind, { icon: React.ComponentType<{ className?: string }>; title: (site: string) => string; done: string; skip: string; doneLine: string; note: string }> = {
  login: {
    icon: KeyRound,
    title: (site) => (site ? `Your turn: sign in to ${site}` : "Your turn: sign in"),
    done: "I have signed in",
    skip: "Skip this",
    doneLine: "You signed in",
    note: `What you type goes straight to the site. ${APP_NAME} does not see or store it.`,
  },
  captcha: {
    icon: ScanFace,
    title: (site) => (site ? `Your turn: ${site} wants to check you are human` : "Your turn: a check that you are human"),
    done: "Done, carry on",
    skip: "Skip this",
    doneLine: "You passed the check",
    note: `${APP_NAME} does not solve these checks. Only you can.`,
  },
  verification: {
    icon: Smartphone,
    title: (site) => (site ? `Your turn: enter the code ${site} sent you` : "Your turn: enter the code you were sent"),
    done: "Done, carry on",
    skip: "Skip this",
    doneLine: "You entered the code",
    note: `Codes stay between you and the site. ${APP_NAME} does not see them.`,
  },
  payment: {
    icon: CreditCard,
    title: () => "Payment is yours",
    done: "I am done",
    skip: "Stop here",
    doneLine: "You took it from the payment page",
    note: `${APP_NAME} never pays. You can pay in the live browser yourself: nothing you type there is read by the agent or stored.`,
  },
  other: {
    icon: Hand,
    title: () => "Your turn",
    done: "Done, carry on",
    skip: "Skip this",
    doneLine: "You took care of it",
    note: "You are in control of the live browser until you hand it back.",
  },
};

/**
 * The agent has stopped and handed the live browser to the user: to sign in, pass a check, enter a
 * code, or pay. The user does it in the live browser and says when they are done.
 */
export function UserAction({
  input,
  answer,
  loading,
  onResult,
  onOpenBrowser,
}: {
  input: UserActionInput;
  /** Set once answered: renders the read-only result. */
  answer?: HandoverAnswer;
  /** The request is still streaming in. */
  loading?: boolean;
  onResult?: (answer: HandoverAnswer) => void;
  onOpenBrowser?: () => void;
}) {
  const [local, setLocal] = React.useState<HandoverAnswer | null>(null);
  const final = answer ?? local;
  const kind: HandoverKind = input.kind && input.kind in COPY ? input.kind : "other";
  const copy = COPY[kind];
  const Icon = copy.icon;

  if (final) {
    const done = final.status === "done";
    return (
      <div className="flex w-full animate-fade items-center gap-3 rounded-2xl border border-border bg-surface/70 px-4 py-3">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", done ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {done ? <Check className="size-4" strokeWidth={2.5} /> : <SkipForward className="size-3.5" />}
        </span>
        <p className="min-w-0 text-[0.85rem] leading-snug">
          <span className="font-medium">{done ? copy.doneLine : final.status === "interrupted" ? "The app was closed before this was done" : kind === "payment" ? "You stopped before paying" : "You skipped this"}</span>
          <span className="text-muted-foreground">{done ? `, and handed the browser back to ${APP_NAME}.` : final.status === "interrupted" ? `. ${APP_NAME} is picking it up again.` : "."}</span>
        </p>
      </div>
    );
  }

  const finish = (status: HandoverAnswer["status"]) => {
    const result: HandoverAnswer = { status };
    setLocal(result);
    onResult?.(result);
  };

  return (
    <section className="w-full animate-rise overflow-hidden rounded-2xl border border-brass/40 bg-card shadow-card" aria-live="polite">
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brass/15 text-brass">
          <Icon className="size-[1.1rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.95rem] leading-6 font-medium tracking-tight">{copy.title(input.site ?? "")}</h3>
          {input.reason ? <p className="mt-0.5 text-[0.88rem] leading-relaxed text-foreground/90">{input.reason}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-4 sm:px-5">
        {onOpenBrowser ? (
          <button
            type="button"
            onClick={onOpenBrowser}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            <MonitorPlay className="size-4" />
            Open the live browser
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => finish("done")}
          disabled={loading}
          className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Check className="size-4 text-brand" strokeWidth={2.5} />
          {copy.done}
        </button>
        <button
          type="button"
          onClick={() => finish("skipped")}
          disabled={loading}
          className="h-9 rounded-full px-3 text-[0.85rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {copy.skip}
        </button>
      </div>

      <p className="flex items-center gap-1.5 border-t border-border/70 bg-surface/60 px-4 py-2 text-[0.72rem] leading-snug text-muted-foreground sm:px-5">
        <ShieldCheck className="size-3.5 shrink-0" />
        {copy.note}
      </p>
    </section>
  );
}
