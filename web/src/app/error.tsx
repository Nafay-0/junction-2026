"use client";

import { useEffect } from "react";
import { DEMO_NOTE } from "./_ui/brand";
import { buttonClass } from "./_ui/kit";
import { Wordmark } from "./_ui/wordmark";

/**
 * Any page whose server side failed (most often: AimoPilot's database not answering for a moment) gets this, not
 * Next's blank "Application error". In production the cause is hidden from the browser, so the page says what is
 * likely and honest, tries again by itself after 10 s, and offers a button.
 */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => reset(), 10_000);
    return () => clearTimeout(t);
  }, [reset]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 bg-mist px-4 py-10 text-ink">
      <Wordmark size={26} />
      <h1 className="display mt-4 text-[1.8rem] leading-tight">This page could not be loaded</h1>
      <p className="leading-relaxed text-ink-soft">
        AimoPilot did not get what it needed to show it, most often because its database did not answer for a moment. Nothing you did was lost or
        sent twice. The page tries again by itself in 10 seconds.
      </p>
      <button type="button" onClick={() => reset()} className={buttonClass("primary", "md", "self-start")}>
        Try again now
      </button>
      <p className="mt-6 text-[0.78rem] leading-snug text-ink-soft">{DEMO_NOTE}</p>
    </main>
  );
}
