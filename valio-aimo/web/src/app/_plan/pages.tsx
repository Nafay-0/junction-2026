"use client";

import Link from "next/link";
import { ChefHat } from "lucide-react";
import { Empty, IconDisc, PageHeader, buttonClass } from "../_ui/kit";
import { Wordmark } from "../_ui/wordmark";
import { LangSwitch, useText } from "../_i18n/provider";
import { PLAN_PAGES_TEXT } from "./pages.text";

/**
 * The words around the planner on the two pages that mount it, as client components so they follow the language
 * switch without a reload. The pages themselves stay server components (they check the kitchen slug).
 */

/** /k/<kitchen>/menu: the heading and the one-paragraph explanation. */
export function StorePlanIntro() {
  const tx = useText(PLAN_PAGES_TEXT);
  return (
    <PageHeader title={tx.heading} lead={tx.intro} />
  );
}

/** /k/<kitchen>/menu for a kitchen the planner does not know (a visitor's kitchen): where to try it instead. */
export function StorePlanUnavailable({ kitchens }: { kitchens: readonly string[] }) {
  const tx = useText(PLAN_PAGES_TEXT);
  return (
    <Empty
      title={tx.onlyDemoTitle}
      glyph={
        <IconDisc tone="muted">
          <ChefHat size={21} />
        </IconDisc>
      }
      action={kitchens.map((k) => (
        <Link key={k} href={`/k/${k}/menu`} className={buttonClass("primary", "sm")}>
          {tx.kitchenLink[k] ?? k}
        </Link>
      ))}
    >
      {tx.onlyDemoBody}
    </Empty>
  );
}

/** /plan/<kitchen>: the header with the word mark, the kitchen switch and the language switch. */
export function StandaloneHeader({ kitchen, kitchens, names }: { kitchen: string; kitchens: readonly string[]; names: Record<string, string> }) {
  const tx = useText(PLAN_PAGES_TEXT);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/k/${kitchen}/menu`} className="flex shrink-0 items-center rounded-md">
            <Wordmark size={28} />
          </Link>
          <span className="truncate border-l border-line pl-3 font-semibold">{tx.heading}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1" aria-label={tx.kitchensNav}>
            {kitchens.map((k) => (
              <Link
                key={k}
                href={`/plan/${k}`}
                aria-current={k === kitchen ? "page" : undefined}
                title={tx.kitchenKind[k]}
                className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[0.9rem] font-medium transition-colors pointer-coarse:min-h-10 ${k === kitchen ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}
              >
                {names[k]}
                <span className="sr-only">: {tx.kitchenKind[k]}</span>
              </Link>
            ))}
          </nav>
          <LangSwitch />
        </div>
      </div>
    </header>
  );
}

/** /plan/<kitchen>: the note above the planner. */
export function StandaloneNote() {
  const tx = useText(PLAN_PAGES_TEXT);
  return <p className="mb-6 max-w-[75ch] text-[0.86rem] leading-relaxed text-ink-soft">{tx.standaloneNote}</p>;
}
