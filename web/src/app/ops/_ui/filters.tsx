"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd } from "../../_ui/kit";

/**
 * Search and filters that answer at once and survive a reload: the state lives in the URL's query (replaceState, so
 * the back button is not flooded), and "/" puts the cursor in the search field from anywhere on the page.
 */
export function useUrlState(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(key);
    if (v !== null) queueMicrotask(() => setValue(v));
  }, [key]);
  const set = useCallback(
    (v: string) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (!v || v === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, v);
      window.history.replaceState(window.history.state, "", url);
    },
    [key, fallback],
  );
  return [value, set];
}

export function FilterBar({
  q,
  setQ,
  placeholder,
  options,
  value,
  setValue,
  result,
  label = "Show",
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  options?: { id: string; label: string; count?: number }[];
  value?: string;
  setValue?: (v: string) => void;
  result?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex min-h-11 min-w-[18rem] flex-1 items-center gap-2 border-2 border-line bg-paper px-3 focus-within:border-petrol sm:max-w-[30rem]">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-ink-soft">
          <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M10.5 10.5 L15 15" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="sr-only">Search</span>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQ("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[0.98rem] outline-none placeholder:text-ink-soft"
        />
        <Kbd>/</Kbd>
      </label>
      {options && setValue && (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1">
          {options.map((o) => {
            const on = value === o.id;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => setValue(o.id)}
                className={`min-h-9 px-3 text-[0.9rem] font-semibold ${on ? "bg-petrol text-paper" : "border-2 border-line bg-paper text-ink hover:border-petrol"}`}
              >
                {o.label}
                {o.count !== undefined && <span className={`ml-1.5 tabular ${on ? "text-paper/80" : "text-ink-soft"}`}>{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {result && (
        <p className="ml-auto text-[0.88rem] text-ink-soft tabular" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
