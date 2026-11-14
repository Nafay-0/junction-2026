"use client";

import Link from "next/link";
import { ListChecks, Sparkles } from "lucide-react";
import { useText } from "../../_i18n/provider";
import { usePortal } from "./portal";
import { GUIDE_TEXT } from "./guide.text";
import { FRESH_TEXT } from "./fresh.text";

/**
 * On the agent's landing, for a demo account's own kitchen: one quiet line to "Try everything" (guide.tsx). A fresh
 * kitchen (server/demo/fresh.ts) says what it is in one sentence, that it lives in this browser, and "Keep it".
 */
export function GuideLink() {
  const { kitchen, base, account } = usePortal();
  const tx = useText(GUIDE_TEXT);
  const fx = useText(FRESH_TEXT);
  if (!account?.demo || account.kitchen !== kitchen.slug) return null;
  if (account.free)
    return (
      <div className="mx-auto w-full max-w-[40rem] px-5 pt-3" data-testid="fresh-opening">
        <div className="rounded-2xl border border-line bg-paper px-4 py-3">
          <p className="flex items-start gap-2.5 font-semibold leading-snug">
            <Sparkles aria-hidden size={18} className="mt-0.5 shrink-0 text-petrol" />
            <span>{fx.opening}</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-[0.9rem]">
            <Link href={`${base}/guide`} data-testid="guide-link" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
              <ListChecks aria-hidden size={16} />
              {fx.guide}
            </Link>
            {!account.free.kept && (
              <Link href={`${base}/agent#fresh`} className="inline-flex min-h-11 items-center text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                {fx.keep}
              </Link>
            )}
          </p>
          <p className="pl-7 text-[0.8rem] text-ink-faint">{account.free.kept ? fx.kept : fx.lives}</p>
        </div>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-[40rem] px-5 pt-3">
      <Link href={`${base}/guide`} data-testid="guide-link" className="flex min-h-11 items-center gap-2.5 rounded-full border border-line bg-paper px-4 text-[0.92rem] font-medium text-petrol-deep transition-colors hover:bg-petrol-soft">
        <ListChecks aria-hidden size={17} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{tx.landing}</span>
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
