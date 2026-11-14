"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
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
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
      <label className="flex min-h-11 min-w-0 flex-1 basis-full items-center gap-2.5 rounded-full border border-line-strong bg-paper pl-4 pr-3 transition-[border-color,box-shadow] duration-150 focus-within:border-petrol focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-petrol)_22%,transparent)] sm:max-w-[26rem] sm:basis-[16rem]">
        <Search aria-hidden size={17} className="shrink-0 text-ink-soft" />
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
          className="min-w-0 flex-1 rounded-none bg-transparent text-[0.95rem] outline-none placeholder:text-ink-soft"
        />
        <span className="hidden sm:block">
          <Kbd>/</Kbd>
        </span>
      </label>
      {options && setValue && (
        <div role="group" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1">
          {options.map((o) => {
            const on = value === o.id;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => setValue(o.id)}
                className={`inline-flex min-h-9 max-sm:min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[0.86rem] font-medium transition-[background-color,color,box-shadow] duration-150 pointer-coarse:min-h-10 ${on ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}
              >
                {o.label}
                {o.count !== undefined && <span className={`ml-1.5 text-[0.78rem] tabular ${on ? "text-ink-soft" : "text-ink-faint"}`}>{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {result && (
        <p className="ml-auto text-[0.84rem] text-ink-soft tabular" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
