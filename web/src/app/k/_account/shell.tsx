import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_NOTES } from "../../_ui/brand";
import { Wordmark } from "../../_ui/wordmark";
import type { Lang } from "../../_i18n/lang";
import { EntryLangSwitch } from "../entry-lang";
import { PORTAL_TEXT } from "../[kitchen]/portal.text";

/** A quiet page around the account forms: the demo note, a white bar with the mark and the language, one column. */
export function DoorShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">
        <span className="sm:hidden">{PORTAL_TEXT[lang].demoShort}</span>
        <span className="hidden sm:inline">{DEMO_NOTES[lang]}</span>
      </p>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/k" aria-label="AimoPilot" className="flex min-h-11 items-center rounded-md">
            <Wordmark size={28} />
          </Link>
          <EntryLangSwitch rendered={lang} tone="light" />
        </div>
      </header>
      <main className="mx-auto max-w-[760px] space-y-6 px-4 pb-16 pt-7 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}
