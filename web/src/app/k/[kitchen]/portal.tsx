"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ApiResult } from "../../_client/api";
import { useLive, type Live } from "../../_client/use-live";
import { DEMO_NOTE, PRODUCT_NAME } from "../../_ui/brand";
import { Kbd } from "../../_ui/kit";
import { day, helsinkiToday, money, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { AssistantPanel, type Turn } from "./assistant";
import type { KitchenChoice, KitchenInfo, LiveReply, LiveResult, Overview, PortalRequest, Product } from "./types";

/**
 * The kitchen portal around every /k/<kitchen> page: the kitchen's name, the shop's navigation, the agent's
 * request field (on every page), the basket, and the data the pages share. The agent is the kitchen's own
 * purchasing agent working in the shop: one field, then its work as cards on the Order page. Not a chat.
 */

export type Lang = "en" | "fi" | "sv";
export type BasketLine = { productId: string; packs: number; product: Product };

/** What the agent bar hands to the Order page. */
export type Pending =
  | { kind: "ask"; text: string; followUp?: PortalRequest; product?: Product }
  | { kind: "repeat"; request: PortalRequest };

type Ctx = {
  kitchen: KitchenInfo;
  kitchens: KitchenChoice[];
  base: string;
  call: <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<ApiResult<T>>;
  ui: <T>(method: "GET" | "POST", sub: string, body?: unknown) => Promise<ApiResult<T>>;
  overview: Live<Overview>;
  lang: Lang;
  setLang: (l: Lang) => void;
  basket: {
    lines: BasketLine[];
    add: (product: Product, packs?: number) => void;
    set: (productId: string, packs: number) => void;
    remove: (productId: string) => void;
    clear: () => void;
  };
  live: {
    results: Record<string, LiveResult & { checkedAt: string }>;
    /** Live price, stock and cut-off for products not checked yet. Returns how many calls it made (0 or 1). */
    check: (ids: string[]) => Promise<number>;
    busy: string[];
    error?: string;
    calls: number;
    products: number;
  };
  agent: {
    draft: string;
    setDraft: (s: string) => void;
    followUp?: PortalRequest;
    setFollowUp: (r: PortalRequest | undefined) => void;
    product?: Product;
    setProduct: (p: Product | undefined) => void;
    busy: boolean;
    setBusy: (b: boolean) => void;
    pending?: Pending;
    send: (p: Pending) => void;
    take: () => Pending | undefined;
    focus: () => void;
    /** Open the assistant panel and put the cursor in its field. */
    open: () => void;
    panelOpen: boolean;
    setPanelOpen: (b: boolean) => void;
    turns: Turn[];
    setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  };
  /** The agent bar's input element (kept apart from `agent`, which renders). */
  fieldRef: React.RefObject<HTMLInputElement | null>;
};

const PortalContext = createContext<Ctx | null>(null);

export function usePortal(): Ctx {
  const c = useContext(PortalContext);
  if (!c) throw new Error("usePortal outside the kitchen portal");
  return c;
}

const NAV: { href: string; label: string }[] = [
  { href: "", label: "Home" },
  { href: "/order", label: "Order" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/menu", label: "Menu planner" },
  { href: "/orders", label: "Orders" },
  { href: "/agent", label: "Agent and rules" },
];

export function readSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function readBasket(slug: string): BasketLine[] {
  try {
    const raw = sessionStorage.getItem(`dock-basket:${slug}`);
    return raw ? (JSON.parse(raw) as BasketLine[]) : [];
  } catch {
    return [];
  }
}

export function Portal({ kitchen, kitchens, children }: { kitchen: KitchenInfo; kitchens: KitchenChoice[]; children: ReactNode }) {
  const slug = kitchen.slug;
  const base = `/k/${slug}`;
  const router = useRouter();
  const pathname = usePathname();

  const call = useCallback(<T,>(method: "GET" | "POST", path: string, body?: unknown) => api<T>("POST", `/ui-api/kitchens/${encodeURIComponent(slug)}/call`, { method, path, body }), [slug]);
  const ui = useCallback(<T,>(method: "GET" | "POST", sub: string, body?: unknown) => api<T>(method, `/ui-api/kitchens/${encodeURIComponent(slug)}/${sub}`, body), [slug]);

  const overview = useLive(
    async () => {
      const r = await ui<Overview>("GET", "portal");
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    { events: `/api/v1/events?orgId=${encodeURIComponent(kitchen.orgId)}`, pollMs: 15_000, pollMsStreaming: 30_000 },
  );

  // ----- language (product names, speech) -----
  const [lang, setLang] = useState<Lang>("en");

  // ----- basket, kept for this browser tab -----
  const [lines, setLines] = useState<BasketLine[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    queueMicrotask(() => {
      setLines(readBasket(slug));
      loaded.current = true;
    });
  }, [slug]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(`dock-basket:${slug}`, JSON.stringify(lines));
    } catch {
      // private window: the basket lives as long as the page
    }
  }, [lines, slug]);
  const basket = useMemo<Ctx["basket"]>(
    () => ({
      lines,
      add: (product, packs = 1) =>
        setLines((ls) => (ls.some((l) => l.productId === product.id) ? ls.map((l) => (l.productId === product.id ? { ...l, packs: l.packs + packs } : l)) : [...ls, { productId: product.id, packs, product }].slice(0, 10))),
      set: (productId, packs) => setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, packs: Math.max(1, Math.min(9999, Math.round(packs))) } : l))),
      remove: (productId) => setLines((ls) => ls.filter((l) => l.productId !== productId)),
      clear: () => setLines([]),
    }),
    [lines],
  );

  // ----- live checks: only for products the buyer opens or adds, each product once per visit -----
  const [results, setResults] = useState<Ctx["live"]["results"]>({});
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [liveError, setLiveError] = useState<string>();
  const [counts, setCounts] = useState({ calls: 0, products: 0 });
  const asked = useRef(new Set<string>());
  const check = useCallback(
    async (ids: string[]) => {
      const todo = [...new Set(ids)].filter((id) => !asked.current.has(id)).slice(0, 5);
      if (todo.length === 0) return 0;
      todo.forEach((id) => asked.current.add(id));
      setBusyIds((b) => [...b, ...todo]);
      setLiveError(undefined);
      const r = await ui<LiveReply>("POST", "catalog/live", { productIds: todo });
      setBusyIds((b) => b.filter((id) => !todo.includes(id)));
      if (!r.ok) {
        todo.forEach((id) => asked.current.delete(id));
        setLiveError(r.error.message);
        return 0;
      }
      setResults((m) => {
        const next = { ...m };
        for (const x of r.data.results) next[x.productId] = { ...x, checkedAt: r.data.checkedAt };
        return next;
      });
      setCounts((c) => ({ calls: c.calls + 1, products: c.products + todo.length }));
      return 1;
    },
    [ui],
  );
  const live = useMemo<Ctx["live"]>(() => ({ results, check, busy: busyIds, error: liveError, ...counts }), [results, check, busyIds, liveError, counts]);

  // ----- the agent bar -----
  const [draft, setDraft] = useState("");
  const [followUp, setFollowUp] = useState<PortalRequest>();
  const [product, setProduct] = useState<Product>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const pendingRef = useRef<Pending | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const send = useCallback(
    (p: Pending) => {
      pendingRef.current = p;
      setPending(p);
      if (!pathname?.endsWith("/order")) router.push(`${base}/order`);
    },
    [base, pathname, router],
  );
  const take = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = undefined;
    if (p) queueMicrotask(() => setPending(undefined));
    return p;
  }, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const restored = useRef(false);
  useEffect(() => {
    // Docked and open on wide screens; a sheet behind a button on narrow ones. What the buyer chose survives a reload.
    queueMicrotask(() => {
      const wide = window.matchMedia("(min-width: 1280px)").matches;
      const saved = readSession<{ open?: boolean; turns?: Turn[] }>(`dock-agent:${slug}`);
      setPanelOpen(wide ? (saved?.open ?? true) : false);
      if (saved?.turns) setTurns(saved.turns.filter((t) => t.kind !== "pending"));
      try {
        const l = localStorage.getItem("dock-lang");
        if (l === "fi" || l === "sv" || l === "en") setLang(l);
      } catch {
        // storage blocked: English
      }
      restored.current = true;
    });
  }, [slug]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(`dock-agent:${slug}`, JSON.stringify({ open: panelOpen, turns: turns.slice(-12) }));
      localStorage.setItem("dock-lang", lang);
    } catch {
      // private window: the conversation lives as long as the page
    }
  }, [panelOpen, turns, lang, slug]);
  const focus = useCallback(() => {
    setPanelOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);
  const agent = useMemo<Ctx["agent"]>(
    () => ({ draft, setDraft, followUp, setFollowUp, product, setProduct, busy, setBusy, pending, send, take, focus, open: focus, panelOpen, setPanelOpen, turns, setTurns }),
    [draft, followUp, product, busy, pending, send, take, focus, panelOpen, turns],
  );

  const value = useMemo<Ctx>(() => ({ kitchen, kitchens, base, call, ui, overview, lang, setLang, basket, live, agent, fieldRef: inputRef }), [kitchen, kitchens, base, call, ui, overview, lang, basket, live, agent]);

  // ----- the keyboard: the agent from anywhere (Ctrl or Cmd + K), the catalogue search with "/" -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focus();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("shop-search")?.focus();
      } else if (e.key === "Escape" && panelOpen && !window.matchMedia("(min-width: 1280px)").matches) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, panelOpen]);

  return (
    <PortalContext.Provider value={value}>
      <div className={`min-h-dvh overflow-x-clip bg-mist text-ink ${panelOpen ? "xl:pr-[25rem]" : ""}`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-paper focus:p-2">
          Skip to the page
        </a>
        <p className="on-dark bg-petrol-deep px-4 py-1 text-center text-[0.8rem] leading-snug text-paper/85 sm:px-6">{DEMO_NOTE}</p>
        <Header />
        <main id="main" className="mx-auto min-w-0 max-w-[1440px] px-4 pb-24 sm:px-6 xl:px-8">
          {children}
        </main>
        <footer className="border-t border-line bg-paper">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-[0.85rem] text-ink-soft sm:px-6 xl:px-8">
            <p>
              {PRODUCT_NAME}, a demo for the Junction 2026 challenge. Synthetic kitchens; the catalogue and prices come from the partner&apos;s test interface.
            </p>
            <p className="hidden items-center gap-2 md:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd> the agent, <Kbd>/</Kbd> search
            </p>
          </div>
        </footer>
        <AssistantPanel />
      </div>
    </PortalContext.Provider>
  );
}

// ---------- header and navigation ----------

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdaysText(days: number[]): string {
  const s = [...days].sort();
  if (s.length >= 3 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${WEEKDAY[s[0]]}–${WEEKDAY[s.at(-1)!]}`;
  return s.map((d) => WEEKDAY[d]).join(" and ");
}

function Header() {
  const { kitchen, kitchens, base, overview, basket, live, agent } = usePortal();
  const router = useRouter();
  const pathname = usePathname() ?? base;
  const params = useSearchParams();
  const waiting = (overview.data?.orders ?? []).filter((o) => o.status === "pending_approval");
  const approver = kitchen.mandate.approvers[0];
  const days = overview.data?.memory.deliveryWeekdays;
  const basketTotal = basket.lines.reduce((s, l) => s + (live.results[l.productId]?.offer?.unitPriceCents ?? 0) * l.packs, 0);
  const priced = basket.lines.length > 0 && basket.lines.every((l) => live.results[l.productId]?.offer);
  const onCatalogue = pathname.startsWith(`${base}/catalogue`);
  const [q, setQ] = useState(onCatalogue ? (params.get("q") ?? "") : "");
  const [forPath, setForPath] = useState(pathname);
  if (forPath !== pathname) {
    setForPath(pathname);
    if (!onCatalogue) setQ("");
  }
  return (
    <header className="bg-paper">
      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(13rem,1fr)_minmax(14rem,28rem)_auto] xl:px-8">
        <Link href="/k" className="flex shrink-0 items-baseline gap-2" aria-label={`${PRODUCT_NAME}: all demo kitchens`}>
          <span aria-hidden className="size-3 translate-y-[-0.1em] bg-lime" />
          <span className="display text-[1.9rem] text-petrol">{PRODUCT_NAME}</span>
        </Link>
        <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:row-start-auto lg:border-l lg:border-line lg:pl-4">
          <label htmlFor="kitchen-switch" className="sr-only">
            Kitchen
          </label>
          <select
            id="kitchen-switch"
            className="-ml-1 max-w-full truncate bg-transparent pr-1 font-display text-[1.3rem] font-bold leading-tight text-ink"
            value={kitchen.slug}
            onChange={(e) => router.push(`/k/${e.target.value}`)}
          >
            {kitchens.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.name}
                {k.kind === "visitor" ? ` (${k.approverName})` : ""}
              </option>
            ))}
          </select>
          <p className="truncate text-[0.85rem] text-ink-soft">
            {days ? `Deliveries ${weekdaysText(days)}. ` : ""}
            {approver ? `Signs off: ${approver.name}.` : ""}
            {kitchen.kind === "visitor" && kitchen.expiresAt ? " Your demo kitchen, open for 90 minutes." : ""}
          </p>
        </div>
        <form
          role="search"
          aria-label="Catalogue"
          className="col-span-2 row-start-3 flex border-2 border-petrol bg-paper focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-petrol lg:col-span-1 lg:row-start-auto"
          onSubmit={(e) => {
            e.preventDefault();
            const t = q.trim();
            router.push(t ? `${base}/catalogue?q=${encodeURIComponent(t)}` : `${base}/catalogue`);
          }}
        >
          <label htmlFor="shop-search" className="sr-only">
            Search the catalogue
          </label>
          <input
            id="shop-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search 17 546 products: maito, mjölk, milk"
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-[1rem] placeholder:text-ink-soft focus:outline-none"
          />
          <button type="submit" className="flex min-h-11 items-center bg-petrol px-4 font-semibold text-paper hover:bg-petrol-deep" aria-label="Search">
            <SearchIcon />
          </button>
        </form>
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 lg:col-start-auto lg:row-start-auto">
          <button
            type="button"
            onClick={() => (agent.panelOpen ? agent.setPanelOpen(false) : agent.open())}
            aria-expanded={agent.panelOpen}
            aria-controls="assistant"
            aria-keyshortcuts="Control+K Meta+K"
            className={`flex min-h-11 items-center gap-2 px-3 font-semibold ${agent.panelOpen ? "bg-lavender-deep text-paper" : "bg-lavender text-lavender-deep hover:bg-[#e3daf0]"}`}
          >
            <AgentIcon />
            <span className="hidden sm:inline">Agent</span>
            <span className="hidden items-center gap-0.5 2xl:flex">
              <Kbd dark={agent.panelOpen}>Ctrl K</Kbd>
            </span>
          </button>
          <Link
            href={`${base}/basket`}
            aria-current={pathname === `${base}/basket` ? "page" : undefined}
            className="flex min-h-11 items-center gap-2 bg-petrol px-3 font-semibold text-paper hover:bg-petrol-deep"
            aria-label={`Basket, ${basket.lines.length} product${basket.lines.length === 1 ? "" : "s"}${priced ? `, ${money(basketTotal)}` : ""}`}
          >
            <BasketIcon />
            <span key={basket.lines.length} className="changed min-w-5 bg-lime px-1 text-center text-ink tabular">
              {basket.lines.length}
            </span>
            {basket.lines.length > 0 && <span className="hidden tabular sm:inline">{priced ? money(basketTotal) : "not priced"}</span>}
          </Link>
        </div>
      </div>
      <nav aria-label="Shop" className="on-dark bg-petrol">
        <div className="mx-auto flex max-w-[1440px] items-stretch gap-3 px-4 sm:px-6 xl:px-8">
          <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap">
            {NAV.map((n) => {
              const href = `${base}${n.href}`;
              const active = n.href === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={n.label}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-12 items-center px-3 text-[1.02rem] ${active ? "font-bold text-paper" : "text-paper/80 hover:text-paper"}`}
                  >
                    {n.label}
                    <span aria-hidden className={`absolute inset-x-3 bottom-0 h-1 ${active ? "bg-lime" : ""}`} />
                  </Link>
                </li>
              );
            })}
          </ul>
          {waiting.length > 0 && (
            <Link href={`${base}/orders?show=waiting`} className="my-1.5 flex shrink-0 items-center gap-2 bg-safety px-3 text-[0.95rem] font-semibold text-safety-ink">
              <Target size={18} tone="safety" />
              <span className="hidden sm:inline">
                {waiting.length === 1 ? `Waiting for ${waiting[0].authorised.by === "waiting" ? waiting[0].authorised.name : "a sign-off"}` : `${waiting.length} orders waiting for sign-off`}
              </span>
              <span className="sm:hidden">{waiting.length} waiting</span>
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square">
      <path d="M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 5 5" />
    </svg>
  );
}

function BasketIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="miter">
      <path d="M3 9h18l-2 11H5L3 9Zm4 0 3-6m7 6-3-6M9 13v4m6-4v4" />
    </svg>
  );
}

/** The agent: a speech mark with a spark, on lavender. */
export function AgentIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="miter">
      <path d="M3 4h18v12H9l-5 4v-4H3V4Z" />
      <path d="M12 7v6M9 10h6" />
    </svg>
  );
}

/** "100 L lactose-free milk for Thursday" (Tue 10.11.) or the order it stands for. */
export function requestLabel(r: PortalRequest): string {
  const d = day(helsinkiToday(new Date(r.at)));
  if (r.text) return `“${r.text.length > 70 ? `${r.text.slice(0, 67)}…` : r.text}”, ${d}`;
  const l = r.order?.lines[0];
  return l ? `${l.quantity} × ${shortProduct(l.name)}, ${d}` : `Order of ${d}`;
}
