"use client";

import type { ReactNode } from "react";
import { CircleAlert, Info } from "lucide-react";
import { LangSwitch, useLang } from "../_i18n/provider";
import type { Lang } from "../_i18n/lang";
import { DEMO_NOTES } from "./brand";
import { buttonClass, Skeleton } from "./kit";
import { Target } from "./target";
import { Wordmark } from "./wordmark";

/**
 * The phone pages (/join, /approver, /approve/<id>, /answer): one calm column on the mist ground, white surfaces, the
 * main action at the bottom under the thumb, the demo note at the foot. The sign-off screen opens with the gate's own
 * slab (`GateHead`): the same mark, words and hazard band as the gate on the kitchen's screen, so scanning the code
 * reads as one continuous act. Nowhere else on these pages is yellow.
 *
 * `context` is a short word for the page ("Sign-off"), given in all three languages by a server page; it sits beside
 * the word mark and gives way first when the line is short. `tone` is kept for the server pages that pass it; the
 * hazard band itself belongs to `GateHead`, so it disappears once nobody needs to sign.
 */
export function PhoneShell({ children, context }: { children: ReactNode; context?: string | Record<Lang, string>; tone?: "plain" | "gate" }) {
  const { lang } = useLang();
  const ctx = typeof context === "string" ? context : context?.[lang];
  return (
    <div className="flex min-h-dvh flex-col bg-mist">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-2.5">
          <Wordmark size={24} />
          <span className="min-w-0 flex-1 truncate border-l border-line pl-3 text-[0.9rem] leading-tight text-ink-soft">{ctx}</span>
          <LangSwitch />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-6 pt-6 text-[1.02rem] leading-normal text-ink sm:pt-10">{children}</main>
      <p className="mx-auto max-w-md px-4 pb-5 pt-2 text-center text-[0.78rem] leading-snug text-ink-soft">{DEMO_NOTES[lang]}</p>
    </div>
  );
}

/** A fixed text from a server page, in the buyer's language: `<LangText t={{ en: "…", fi: "…", sv: "…" }} />`. */
export function LangText({ t }: { t: Record<Lang, string> }) {
  return <>{t[useLang().lang]}</>;
}

/**
 * The gate, as the phone shows it: the dark slab with the hazard band along its top edge, the quartered mark and the
 * words the kitchen's screen used. The one loud thing on a phone page, and only while a person must decide.
 */
export function GateHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <section className="hazard-frame on-dark text-paper shadow-md">
      <div className="px-5 pb-6 pt-5">
        <div className="flex items-center gap-3">
          <Target size={34} tone="safety" />
          <p className="display min-w-0 text-[1.7rem] leading-[1.02] text-safety [overflow-wrap:break-word] hyphens-manual">{title}</p>
        </div>
        {sub && <p className="mt-3 text-[1.02rem] leading-snug text-paper/85">{sub}</p>}
        {children}
      </div>
    </section>
  );
}

/** The one large control at the bottom of a phone page: a full-width pill from the kit's buttons. */
export function bigButton(kind: "go" | "secondary" | "dark" | "demo" = "go"): string {
  const base = "w-full min-h-14 text-center text-[1.08rem] disabled:opacity-50";
  if (kind === "go") return buttonClass("go", "lg", base);
  if (kind === "dark") return buttonClass("primary", "lg", base);
  if (kind === "demo") return buttonClass("secondary", "lg", `${base} border-dashed text-[0.95rem] font-medium`);
  return buttonClass("secondary", "lg", base);
}

/** A plain notice on a phone page: an optional mark, a title and what to do next. */
export function PhoneNotice({ title, body, children, mark }: { title: string; body?: string; children?: ReactNode; mark?: ReactNode }) {
  return (
    <div className="mt-6 flex flex-1 flex-col">
      {mark && <div className="mb-5">{mark}</div>}
      <h1 className="display text-[2.1rem] leading-[1.05] text-ink hyphens-manual [overflow-wrap:break-word]">{title}</h1>
      {body && <p className="mt-3 max-w-[38ch] leading-relaxed text-ink-soft">{body}</p>}
      {children}
    </div>
  );
}

/**
 * Something did not work, or a passkey prompt was closed. `quiet` for a cancel the person chose (a tinted note);
 * otherwise the error's own colour. Never the gate's yellow: that is for the gate.
 */
export function PhoneProblem({ title, body, quiet = false }: { title: string; body: string; quiet?: boolean }) {
  return (
    <div role="alert" className={`mt-4 flex items-start gap-3 rounded-lg px-4 py-3.5 ${quiet ? "bg-surface" : "border border-bad/20 bg-bad-soft"}`}>
      {quiet ? <Info aria-hidden size={20} className="mt-0.5 shrink-0 text-ink-soft" /> : <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-bad" />}
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-[0.95rem] leading-snug text-ink-soft">{body}</p>
      </div>
    </div>
  );
}

/** A phone page on its way: the shape of a title, a lead and a card. `label` is read out while it loads. */
export function PhoneSkeleton({ label, gate = false }: { label: string; gate?: boolean }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      {gate ? (
        <div className="hazard-frame h-60 opacity-90" />
      ) : (
        <>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </>
      )}
      <Skeleton className="mt-2 h-32 !rounded-xl" />
      <Skeleton className="h-20 !rounded-xl" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
