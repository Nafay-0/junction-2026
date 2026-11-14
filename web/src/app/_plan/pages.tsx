"use client";

import Link from "next/link";
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
    <div>
      <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">{tx.heading}</h1>
      <p className="max-w-[64ch] text-[1.02rem] leading-snug text-ink-soft">{tx.intro}</p>
    </div>
  );
}

/** /k/<kitchen>/menu for a kitchen the planner does not know (a visitor's kitchen): where to try it instead. */
export function StorePlanUnavailable({ kitchens }: { kitchens: readonly string[] }) {
  const tx = useText(PLAN_PAGES_TEXT);
  return (
    <div className="bg-paper p-5">
      <p className="text-[1.08rem] font-semibold">{tx.onlyDemoTitle}</p>
      <p className="mt-1 max-w-[62ch] leading-snug text-ink-soft">{tx.onlyDemoBody}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {kitchens.map((k) => (
          <Link key={k} href={`/k/${k}/menu`} className="inline-flex min-h-11 items-center bg-petrol px-4 font-semibold text-paper hover:bg-petrol-deep">
            {tx.kitchenLink[k] ?? k}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** /plan/<kitchen>: the header with the word mark, the kitchen switch and the language switch. */
export function StandaloneHeader({ kitchen, kitchens, names }: { kitchen: string; kitchens: readonly string[]; names: Record<string, string> }) {
  const tx = useText(PLAN_PAGES_TEXT);
  return (
    <header className="border-b-4 border-petrol bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href={`/k/${kitchen}/menu`} className="flex items-center">
            <Wordmark size={32} />
          </Link>
          <span className="display text-[1.5rem]">{tx.heading}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-2" aria-label={tx.kitchensNav}>
            {kitchens.map((k) => (
              <Link key={k} href={`/plan/${k}`} aria-current={k === kitchen ? "page" : undefined} className={`border-2 px-3 py-1.5 text-[0.95rem] font-semibold ${k === kitchen ? "border-petrol bg-petrol text-paper" : "border-line hover:border-petrol"}`}>
                {names[k]}
                <span className={`block text-[0.75rem] font-medium ${k === kitchen ? "text-paper/80" : "text-ink-soft"}`}>{tx.kitchenKind[k]}</span>
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
  return <p className="mb-4 text-[0.85rem] text-ink-soft">{tx.standaloneNote}</p>;
}
