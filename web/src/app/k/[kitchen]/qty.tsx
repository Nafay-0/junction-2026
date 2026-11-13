"use client";

import { quantityText, stepOf, unitWord } from "./units";
import type { Product } from "./types";

/** Quantity in the unit the wholesaler sells, with what it means for the kitchen: "3 cases = 30 L". */
export function Quantity({ p, value, onChange, id, disabled }: { p: Product; value: number; onChange: (n: number) => void; id: string; disabled?: boolean }) {
  const step = stepOf(p);
  const set = (n: number) => onChange(Math.max(step, Math.min(9999, Math.round(n / step) * step || step)));
  return (
    <div>
      <div className="flex items-stretch">
        <button type="button" aria-label={`One ${unitWord(p, 1)} less`} disabled={disabled || value <= step} onClick={() => set(value - step)} className="min-h-11 w-11 border-2 border-ink bg-paper text-[1.2rem] font-bold disabled:opacity-40">
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
          className="min-h-11 w-16 border-y-2 border-ink bg-paper text-center font-semibold tabular"
        />
        <button type="button" aria-label={`One ${unitWord(p, 1)} more`} disabled={disabled} onClick={() => set(value + step)} className="min-h-11 w-11 border-2 border-ink bg-paper text-[1.2rem] font-bold disabled:opacity-40">
          +
        </button>
        <span className="ml-2 self-center text-[0.95rem]">{unitWord(p, value)}</span>
      </div>
      <p className="mt-1 text-[0.9rem] text-ink-soft tabular">{quantityText(p, value)}{step > 1 ? `, sold in steps of ${step}` : ""}</p>
    </div>
  );
}
