"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Lang } from "../../_i18n/lang";
import { usePortal } from "./portal";
import type { Product, ProductPage } from "./types";

/**
 * Product names in the buyer's language where the server wrote the English one (an order line, an option card, a
 * standing order). The catalogue has the partner's Finnish and Swedish names; this fetches a product's master data
 * once per visit (the product route: no live call) and keeps it for every screen. English shows the server's own
 * text untouched; until a name arrives, or when the catalogue has none, the English name stays.
 */

type Names = { fi?: string; sv?: string; en?: string };
const names = new Map<string, Names | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version += 1;
  listeners.forEach((l) => l());
}

/** Seed the cache from products the page already has (catalogue tiles, basket lines). */
export function rememberNames(products: Product[]) {
  let changed = false;
  for (const p of products) {
    if (!p.names || names.get(p.id)) continue;
    names.set(p.id, p.names);
    changed = true;
  }
  if (changed) bump();
}

const clean = (s: string) => s.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();

export function useProductName(): (id: string | undefined, english: string) => string {
  const { lang, ui } = usePortal();
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  const [wanted, setWanted] = useState<string[]>([]);
  useEffect(() => {
    if (lang === "en") return;
    const todo = wanted.filter((id) => !asked.has(id)).slice(0, 12);
    if (!todo.length) return;
    todo.forEach((id) => asked.add(id));
    void Promise.all(
      todo.map((id) =>
        ui<ProductPage>("GET", `catalog/product/${encodeURIComponent(id)}`).then((r) => {
          names.set(id, r.ok ? (r.data.product.names ?? null) : null);
        }),
      ),
    ).then(bump);
  }, [wanted, lang, ui]);
  return useCallback(
    (id: string | undefined, english: string) => {
      void v;
      if (lang === "en" || !id) return english;
      const n = names.get(id);
      if (n === undefined && !asked.has(id)) queueMicrotask(() => setWanted((w) => (w.includes(id) ? w : [...w, id])));
      const local = n?.[lang as Exclude<Lang, "en">];
      return local ? clean(local) : english;
    },
    [lang, v],
  );
}
