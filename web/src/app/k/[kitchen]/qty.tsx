"use client";

import { contentOf, measureText, stepOf, unitWord } from "./units";
import type { Product } from "./types";

/**
 * Quantity in the unit the wholesaler sells, with what it means for the kitchen as it changes: "3 cases = 30 L".
 * The meaning is set as large as the number, and washes briefly when it changes.
 */
export function Quantity({ p, value, onChange, id, disabled, compact = false }: { p: Product; value: number; onChange: (n: number) => void; id: string; disabled?: boolean; compact?: boolean }) {
  const step = stepOf(p);
  const set = (n: number) => onChange(Math.max(step, Math.min(9999, Math.round(n / step) * step || step)));
  const m = contentOf(p, value);
  const showMeaning = m && !(p.salesUnit === "KG" && m.unit === "kg");
  const btn = "flex min-h-11 w-11 items-center justify-center border-2 border-petrol bg-paper text-[1.3rem] font-bold text-petrol hover:bg-petrol-soft disabled:border-line disabled:text-ink-soft disabled:hover:bg-paper";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-stretch">
          <button type="button" aria-label={`One ${unitWord(p, 1)} less`} disabled={disabled || value <= step} onClick={() => set(value - step)} className={btn}>
            −
          </button>
          <label htmlFor={id} className="sr-only">
            Quantity in {unitWord(p, 2)}
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
            className="min-h-11 w-16 border-y-2 border-petrol bg-paper text-center text-[1.1rem] font-semibold tabular disabled:border-line"
          />
          <button type="button" aria-label={`One ${unitWord(p, 1)} more`} disabled={disabled} onClick={() => set(value + step)} className={btn}>
            +
          </button>
        </div>
        <p className="flex items-baseline gap-1.5" aria-live="polite">
          <span className="text-[1rem]">{unitWord(p, value)}</span>
          {showMeaning && (
            <>
              <span className="text-ink-soft">=</span>
              <span key={value} className={`changed px-0.5 ${compact ? "text-[1.05rem] font-semibold" : "display text-[1.6rem]"} text-petrol-deep tabular`}>
                {measureText(m)}
              </span>
            </>
          )}
        </p>
      </div>
      {step > 1 && <p className="mt-1 text-[0.85rem] text-ink-soft">Sold in steps of {step}.</p>}
    </div>
  );
}
