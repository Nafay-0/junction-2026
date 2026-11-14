"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useText } from "../_i18n/provider";
import { IconButton } from "../_ui/kit";
import { TRY_TEXT } from "./try.text";

/** A command or a sentence to paste elsewhere: readable, scrolls sideways inside itself, one tap copies it. */
export function CopyCode({ text, label, mono = true }: { text: string; label: string; mono?: boolean }) {
  const tx = useText(TRY_TEXT);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-surface py-2 pl-4 pr-2">
      {mono ? <pre className="min-w-0 overflow-x-auto py-1.5 font-mono text-[0.85rem] leading-relaxed text-ink">{text}</pre> : <p className="min-w-0 py-1.5 leading-relaxed">{text}</p>}
      <IconButton label={copied ? tx.copied : tx.copyWhat(label)} onClick={() => void copy()}>
        {copied ? <Check aria-hidden size={17} strokeWidth={2.5} className="text-good" /> : <Copy aria-hidden size={17} />}
      </IconButton>
    </div>
  );
}
