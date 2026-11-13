"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ApiResult } from "../../_client/api";
import { useLive, type Live } from "../../_client/use-live";
import { DEMO_NOTE } from "../../_ui/brand";
import { day, eur, helsinkiToday, shortProduct } from "../../_ui/plain";
import { Target, Wordmark } from "../../_ui/target";
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
  { href: "/orders", label: "Orders" },
  { href: "/agent", label: "Agent and rules" },
];

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
  useEffect(() => {
    // Docked and open on wide screens; a sheet behind a button on narrow ones.
    queueMicrotask(() => setPanelOpen(window.matchMedia("(min-width: 1280px)").matches));
  }, []);
  const focus = useCallback(() => {
    setPanelOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);
  const agent = useMemo<Ctx["agent"]>(
    () => ({ draft, setDraft, followUp, setFollowUp, product, setProduct, busy, setBusy, pending, send, take, focus, open: focus, panelOpen, setPanelOpen, turns, setTurns }),
    [draft, followUp, product, busy, pending, send, take, focus, panelOpen, turns],
  );

  const value = useMemo<Ctx>(() => ({ kitchen, kitchens, base, call, ui, overview, lang, setLang, basket, live, agent, fieldRef: inputRef }), [kitchen, kitchens, base, call, ui, overview, lang, basket, live, agent]);

  return (
    <PortalContext.Provider value={value}>
      <div className={`min-h-dvh overflow-x-clip bg-concrete text-ink ${panelOpen ? "xl:pr-[24rem]" : ""}`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-paper focus:p-2">
          Skip to the page
        </a>
        <p className="bg-ink px-4 py-1 text-center text-[0.82rem] leading-snug text-chalk sm:px-6">{DEMO_NOTE}</p>
        <Header />
        <main id="main" className="mx-auto min-w-0 max-w-[1440px] px-4 pb-24 sm:px-6 xl:px-8">
          {children}
        </main>
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
  const waiting = (overview.data?.orders ?? []).filter((o) => o.status === "pending_approval");
  const approver = kitchen.mandate.approvers[0];
  const days = overview.data?.memory.deliveryWeekdays;
  const basketTotal = basket.lines.reduce((s, l) => s + (live.results[l.productId]?.offer?.unitPriceCents ?? 0) * l.packs, 0);
  const priced = basket.lines.every((l) => live.results[l.productId]?.offer);
  return (
    <header className="border-b-[3px] border-ink bg-paper">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-3 sm:px-6 xl:px-10">
        <Link href="/k" className="shrink-0" aria-label="All demo kitchens">
          <Wordmark size={26} />
        </Link>
        <span aria-hidden className="hidden h-8 w-px bg-ink/20 sm:block" />
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor="kitchen-switch" className="sr-only">
            Kitchen
          </label>
          <select
            id="kitchen-switch"
            className="max-w-full truncate bg-transparent pr-1 font-display text-[1.45rem] font-bold leading-tight sm:text-[1.65rem]"
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
          <p className="hidden text-[0.88rem] text-ink-soft sm:block">
            {days ? `Deliveries ${weekdaysText(days)}. ` : ""}
            {approver ? `Signs off: ${approver.name}.` : ""}
            {kitchen.kind === "visitor" && kitchen.expiresAt ? " Your demo kitchen, open for 90 minutes." : ""}
          </p>
        </div>
        {waiting.length > 0 && (
          <Link href={`${base}/orders?show=waiting`} className="flex min-h-11 items-center gap-2 bg-safety px-3 font-semibold text-safety-ink">
            <Target size={20} tone="safety" />
            {waiting.length === 1 ? `Waiting for ${waiting[0].authorised.by === "waiting" ? waiting[0].authorised.name : "a sign-off"}` : `${waiting.length} orders waiting for sign-off`}
          </Link>
        )}
        <button
          type="button"
          onClick={() => agent.setPanelOpen(!agent.panelOpen)}
          aria-expanded={agent.panelOpen}
          aria-controls="assistant"
          className={`flex min-h-11 items-center gap-2 border-2 border-ink px-3 font-semibold ${agent.panelOpen ? "bg-ink text-paper" : "hover:bg-concrete"}`}
        >
          <Target size={18} tone={agent.panelOpen ? "chalk" : "ink"} />
          <span className="sm:hidden">Agent</span>
          <span className="hidden sm:inline">Purchasing agent</span>
        </button>
        <Link href={`${base}/basket`} className="flex min-h-11 items-center gap-2 border-2 border-ink px-3 font-semibold hover:bg-concrete" aria-label={`Basket, ${basket.lines.length} products`}>
          Basket
          <span className="tabular">{basket.lines.length}</span>
          {basket.lines.length > 0 && <span className="hidden font-normal text-ink-soft tabular sm:inline">{priced ? eur(basketTotal) : "not priced"}</span>}
        </Link>
      </div>
      <nav aria-label="Shop" className="mx-auto mt-2 max-w-[1440px] overflow-x-auto px-4 sm:px-6 xl:px-10">
        <ul className="flex gap-1 whitespace-nowrap">
          {NAV.map((n) => {
            const href = `${base}${n.href}`;
            const active = n.href === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={n.label}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center border-b-[4px] px-3 text-[1.02rem] ${active ? "border-ink font-bold" : "border-transparent text-ink-soft hover:border-ink/30 hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

/** "100 L lactose-free milk for Thursday" (Tue 10.11.) or the order it stands for. */
export function requestLabel(r: PortalRequest): string {
  const d = day(helsinkiToday(new Date(r.at)));
  if (r.text) return `“${r.text.length > 70 ? `${r.text.slice(0, 67)}…` : r.text}”, ${d}`;
  const l = r.order?.lines[0];
  return l ? `${l.quantity} × ${shortProduct(l.name)}, ${d}` : `Order of ${d}`;
}
