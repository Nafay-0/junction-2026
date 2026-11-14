import type { ReactNode } from "react";
import { DEMO_NOTE } from "./brand";
import { Target } from "./target";
import { Wordmark } from "./wordmark";

/**
 * The phone pages (/join, /approver, /approve/<id>, /call): one column, one large control at the bottom, the demo
 * note at the foot. The sign-off screen opens with the same hazard band, the same mark and the same words as the
 * gate on the kitchen's screen, so scanning the code reads as one continuous act.
 */
export function PhoneShell({ children, context, tone = "plain" }: { children: ReactNode; context?: string; tone?: "plain" | "gate" }) {
  return (
    <div className={`flex min-h-dvh flex-col ${tone === "gate" ? "bg-paper" : "bg-mist"}`}>
      {tone === "gate" && <div aria-hidden className="hazard h-3 shrink-0" />}
      <header className="flex items-center justify-between gap-3 bg-paper px-5 py-3">
        <Wordmark size={26} />
        {context && <span className="truncate text-[0.95rem] text-ink-soft">{context}</span>}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-5 text-[1.08rem] text-ink">{children}</main>
      <p className="px-5 pb-4 text-center text-[0.78rem] leading-snug text-ink-soft">{DEMO_NOTE}</p>
    </div>
  );
}

/** The gate, as the phone shows it: the black slab, the mark, the words the kitchen's screen used. */
export function GateHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <section className="on-dark -mx-5 -mt-5 bg-safety-ink px-5 pb-6 pt-5 text-paper">
      <div className="flex items-center gap-3">
        <Target size={44} tone="safety" />
        <p className="display text-[2.2rem] leading-[0.95] text-safety">{title}</p>
      </div>
      {sub && <p className="mt-2 text-[1.08rem] leading-snug text-paper/90">{sub}</p>}
      {children}
    </section>
  );
}

/** The one large control at the bottom of a phone page. */
export function bigButton(kind: "go" | "secondary" | "dark" | "demo" = "go"): string {
  const look =
    kind === "go"
      ? "bg-lime text-ink hover:bg-lime-hover"
      : kind === "dark"
        ? "bg-petrol text-paper hover:bg-petrol-deep"
        : kind === "demo"
          ? "border-2 border-dashed border-ink-soft text-ink"
          : "border-2 border-ink bg-paper text-ink";
  return `flex min-h-16 w-full items-center justify-center gap-2 px-4 text-center text-[1.2rem] font-semibold disabled:opacity-50 ${look}`;
}

/** A plain notice on a phone page: a title and what to do next. */
export function PhoneNotice({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="mt-10">
      <h1 className="display text-[2.4rem] text-ink">{title}</h1>
      {body && <p className="mt-3 leading-snug">{body}</p>}
      {children}
    </div>
  );
}

export function PhoneProblem({ title, body, quiet = false }: { title: string; body: string; quiet?: boolean }) {
  return (
    <div role="alert" className={`mt-4 border-l-[6px] p-3 ${quiet ? "border-ink-soft bg-mist" : "border-safety-ink bg-safety/25"}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[1rem] leading-snug">{body}</p>
    </div>
  );
}
