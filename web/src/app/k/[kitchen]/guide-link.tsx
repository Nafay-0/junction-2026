"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useText } from "../../_i18n/provider";
import { usePortal } from "./portal";
import { GUIDE_TEXT } from "./guide.text";

/** On the agent's landing, for a demo account's own kitchen: one quiet line to "Try everything" (guide.tsx). */
export function GuideLink() {
  const { kitchen, base, account } = usePortal();
  const tx = useText(GUIDE_TEXT);
  if (!account?.demo || account.kitchen !== kitchen.slug) return null;
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
