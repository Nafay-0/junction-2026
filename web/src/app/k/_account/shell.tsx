import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_NOTES } from "../../_ui/brand";
import { Wordmark } from "../../_ui/wordmark";
import type { Lang } from "../../_i18n/lang";

/** A plain page around the account forms: the demo note, the sign, one column. */
export function DoorShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="bg-petrol-deep px-4 py-1 text-center text-[0.8rem] text-paper/85">{DEMO_NOTES[lang]}</p>
      <header className="bg-paper">
        <div className="mx-auto flex max-w-[860px] items-center px-4 py-3 sm:px-8">
          <Link href="/k" aria-label="AimoPilot">
            <Wordmark size={32} />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[860px] space-y-6 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
