"use client";

import { Minus, Plus } from "lucide-react";
import { useLang, useText } from "../../_i18n/provider";
import { QTY_TEXT } from "./qty.text";
import { contentOf, measureText, stepOf, unitWord } from "./units";
import type { Product } from "./types";

/**
 * Quantity in the unit the wholesaler sells, with what it means for the kitchen as it changes: "3 cases = 30 L".
 * The meaning is set as large as the number, and washes briefly when it changes.
 */
export function Quantity({ p, value, onChange, id, disabled, compact = false }: { p: Product; value: number; onChange: (n: number) => void; id: string; disabled?: boolean; compact?: boolean }) {
  const tx = useText(QTY_TEXT);
  const { lang } = useLang();
  const step = stepOf(p);
  const set = (n: number) => onChange(Math.max(step, Math.min(9999, Math.round(n / step) * step || step)));
  const m = contentOf(p, value);
  const showMeaning = m && !(p.salesUnit === "KG" && m.unit === "kg");
  const btn = "flex size-11 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:bg-surface active:bg-petrol-soft disabled:text-ink-faint disabled:hover:bg-transparent";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="inline-flex items-center rounded-full border border-line-strong bg-paper focus-within:border-petrol focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-petrol)_22%,transparent)]">
          <button type="button" aria-label={tx.less(unitWord(p, 1, lang))} disabled={disabled || value <= step} onClick={() => set(value - step)} className={btn}>
            <Minus aria-hidden size={18} />
          </button>
          <label htmlFor={id} className="sr-only">
            {tx.quantityIn(unitWord(p, 1, lang), unitWord(p, 2, lang))}
          </label>
          <input
            id={id}
            inputMode="numeric"
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ""));
              if (Number.isFinite(n) && n > 0) onChange(Math.min(9999, n));
            }}
            onBlur={() => set(value)}
            className="min-h-11 w-12 rounded-none bg-transparent text-center text-[1.05rem] font-semibold tabular focus:outline-none disabled:text-ink-soft"
          />
          <button type="button" aria-label={tx.more(unitWord(p, 1, lang))} disabled={disabled} onClick={() => set(value + step)} className={btn}>
            <Plus aria-hidden size={18} />
          </button>
        </div>
        <p className="flex items-baseline gap-1.5" aria-live="polite">
          <span className="text-[1rem]">{unitWord(p, value, lang)}</span>
          {showMeaning && (
            <>
              <span className="text-ink-soft">=</span>
              <span key={value} className={`changed rounded-xs px-1 ${compact ? "text-[1.05rem] font-semibold" : "display text-[1.5rem]"} text-petrol-deep tabular`}>
                {measureText(m, lang)}
              </span>
            </>
          )}
        </p>
      </div>
      {step > 1 && <p className="mt-1 text-[0.85rem] text-ink-soft">{tx.steps(step)}</p>}
    </div>
  );
}
