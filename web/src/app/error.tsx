"use client";

import { useEffect } from "react";

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
      <h1 className="display text-[1.8rem] leading-tight">This page could not be loaded</h1>
      <p className="leading-relaxed text-ink-soft">
        AimoPilot did not get what it needed to show it, most often because its database did not answer for a moment. Nothing you did was lost or
        sent twice. The page tries again by itself in 10 seconds.
      </p>
      <button type="button" onClick={() => reset()} className="min-h-12 self-start rounded-lg bg-ink px-5 font-semibold text-paper">
        Try again now
      </button>
    </main>
  );
}
