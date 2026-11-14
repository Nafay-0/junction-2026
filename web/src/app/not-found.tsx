import Link from "next/link";
import { Suspense } from "react";
import { SearchX } from "lucide-react";
import { DEMO_NOTES } from "./_ui/brand";
import { IconDisc } from "./_ui/kit";
import { LINK_PRIMARY, LINK_SECONDARY } from "./k/_account/links";
import { Wordmark } from "./_ui/wordmark";
import type { Lang } from "./_i18n/lang";
import { requestLang } from "./_i18n/server";
import { NOT_FOUND_TEXT } from "./not-found.text";

/**
 * An address that does not exist: the product's own page, in the visitor's language, with a way on. The English page
 * is prerendered; the visitor's language (a cookie) streams in.
 */
export default function NotFound() {
  return (
    <Suspense fallback={<NotFoundPage lang="en" />}>
      <Localized />
    </Suspense>
  );
}

async function Localized() {
  return <NotFoundPage lang={await requestLang()} />;
}

function NotFoundPage({ lang }: { lang: Lang }) {
  const tx = NOT_FOUND_TEXT[lang];
  return (
    <div className="flex min-h-dvh flex-col bg-mist text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-xl items-center px-4 py-3">
          <Link href="/" aria-label="AimoPilot" className="rounded-md">
            <Wordmark size={26} />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12">
        <IconDisc size={56} tone="muted">
          <SearchX size={26} />
        </IconDisc>
        <h1 className="display mt-5 text-[2rem] leading-tight">{tx.title}</h1>
        <p className="mt-2 max-w-[52ch] leading-relaxed text-ink-soft">{tx.body}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/k" className={LINK_PRIMARY}>
            {tx.store}
          </Link>
          <Link href="/" className={LINK_SECONDARY}>
            {tx.home}
          </Link>
        </div>
      </main>
      <p className="mx-auto max-w-xl px-4 pb-5 text-center text-[0.78rem] leading-snug text-ink-soft">{DEMO_NOTES[lang]}</p>
    </div>
  );
}
