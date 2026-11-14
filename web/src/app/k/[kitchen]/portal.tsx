"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ApiResult } from "../../_client/api";
import { useLive, type Live } from "../../_client/use-live";
import { DEMO_NOTES, PRODUCT_NAME } from "../../_ui/brand";
import { ChefHat, ChevronDown, ChevronRight, ClipboardList, Ellipsis, House, LayoutGrid, ReceiptText, Search, ShieldCheck, ShoppingBasket, Sparkles } from "lucide-react";
import { Avatar, IconButton, IconDisc, Kbd, ListRow, Select, Sheet, Toaster } from "../../_ui/kit";
import { helsinkiToday, money, shortProduct } from "../../_ui/plain";
import { LangSwitch, useLang, useText } from "../../_i18n/provider";
import { dayL, weekdaysL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { PORTAL_TEXT } from "./portal.text";
import { agentNameL, exampleL, placeNameL } from "../../_i18n/kitchen-words";
import { Target } from "../../_ui/target";
import { Wordmark } from "../../_ui/wordmark";
import { RecallNotice } from "../../_radar/recall-notice";
import { AssistantPanel } from "./assistant";
import { useThreadState, type ThreadApi } from "./thread-state";
import { VoiceModeProvider } from "../../_channels/voice-mode";
import { THREAD_PAGE_TEXT } from "./thread.text";
import { THREAD_HOME_TEXT } from "./thread-home.text";
import { AccountBar, type PortalAccount } from "./account-bar";
import type { KitchenChoice, KitchenInfo, LiveReply, LiveResult, Overview, PortalRequest, Product } from "./types";

/**
 * The kitchen portal around every /k/<kitchen> page: the kitchen's name, the shop's navigation, the agent's
 * conversation (the thread, docs/agent-thread.md: on every page in the dock, full width on the Order page), the
 * basket, and the data the pages share. The thread's state lives here, so every view of it is the same thread.
 */

export type { Lang };
export type BasketLine = { productId: string; packs: number; product: Product };

/** What a page hands to the agent: words to send, or an earlier request to repeat. */
export type Pending =
  | { kind: "ask"; text: string; followUp?: PortalRequest; product?: Product }
  | { kind: "repeat"; request: PortalRequest };

type Ctx = {
  kitchen: KitchenInfo;
  /** The signed-in account in this browser, if any (it owns this kitchen when `account.kitchen === kitchen.slug`). */
  account?: PortalAccount;
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
    /** Send to the thread and show it: the dock opens (the Order page shows it already). */
    send: (p: Pending) => void;
    focus: () => void;
    /** Open the thread and put the cursor in its field. */
    open: () => void;
    panelOpen: boolean;
    setPanelOpen: (b: boolean) => void;
  };
  /** The kitchen's conversation with its agent (thread-state.ts). */
  thread: ThreadApi;
  /** The agent bar's input element (kept apart from `agent`, which renders). */
  fieldRef: React.RefObject<HTMLInputElement | null>;
};

const PortalContext = createContext<Ctx | null>(null);

export function usePortal(): Ctx {
  const c = useContext(PortalContext);
  if (!c) throw new Error("usePortal outside the kitchen portal");
  return c;
}

const NAV: { href: string; key: keyof (typeof PORTAL_TEXT)["en"]["nav"] }[] = [
  { href: "", key: "home" },
  { href: "/order", key: "order" },
  { href: "/catalogue", key: "catalogue" },
  { href: "/menu", key: "menu" },
  { href: "/orders", key: "orders" },
  { href: "/agent", key: "agent" },
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

export function Portal({ kitchen, kitchens, account, children }: { kitchen: KitchenInfo; kitchens: KitchenChoice[]; account?: PortalAccount; children: ReactNode }) {
  const slug = kitchen.slug;
  const base = `/k/${slug}`;
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

  // ----- language: the whole store, product names and speech (one choice, kept in a cookie by LangProvider) -----
  const { lang, setLang } = useLang();
  const tx = useText(PORTAL_TEXT);

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
  const toSheet = useRef<(product: Product, packs: number) => void>(undefined);
  const basket = useMemo<Ctx["basket"]>(
    () => ({
      lines,
      // "Add" anywhere in the store puts the product on the agent's current order sheet (a `sheet_add` turn: priced
      // live and previewed by the gate there), and shows the agent. The basket keeps what was put in it before.
      add: (product, packs = 1) => toSheet.current?.(product, packs),
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
  const inputRef = useRef<HTMLInputElement>(null);
  const thread = useThreadState(slug);
  const onOrderPage = pathname === `${base}/order`;
  const [panelOpen, setPanelOpen] = useState(false);
  const restored = useRef(false);
  useEffect(() => {
    // Docked and open on wide screens; a sheet behind a button on narrow ones. What the buyer chose survives a reload.
    // The conversation itself is on the server (thread-state.ts), so a reload loses nothing of it.
    queueMicrotask(() => {
      const wide = window.matchMedia("(min-width: 1280px)").matches;
      const saved = readSession<{ open?: boolean }>(`dock-agent:${slug}`);
      setPanelOpen(wide ? (saved?.open ?? true) : false);
      restored.current = true;
    });
  }, [slug]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(`dock-agent:${slug}`, JSON.stringify({ open: panelOpen }));
    } catch {
      // private window: the choice lives as long as the page
    }
  }, [panelOpen, slug]);
  const focus = useCallback(() => {
    if (!onOrderPage) setPanelOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [onOrderPage]);
  const submit = thread.submit;
  const send = useCallback(
    (p: Pending) => {
      const t = THREAD_PAGE_TEXT[lang];
      // A repeat needs no model: the earlier order is rebuilt by plain code on the server (a `repeat` action).
      if (p.kind === "repeat") void submit({ door: "typed", via: "tap", action: { type: "repeat", ref: p.request.requestId ?? p.request.key }, label: t.repeatWords(requestLabel(p.request, lang)), lang });
      else void submit({ door: "typed", via: "typed", text: p.text, lang });
      if (!onOrderPage) setPanelOpen(true);
    },
    [submit, lang, onOrderPage],
  );
  const agent = useMemo<Ctx["agent"]>(
    () => ({ draft, setDraft, followUp, setFollowUp, product, setProduct, send, focus, open: focus, panelOpen: panelOpen && !onOrderPage, setPanelOpen }),
    [draft, followUp, product, send, focus, panelOpen, onOrderPage],
  );
  useEffect(() => {
    toSheet.current = (p, packs) => {
      void submit({ door: "typed", via: "tap", action: { type: "sheet_add", productId: p.id, packs: Math.max(1, Math.round(packs)) }, label: THREAD_HOME_TEXT[lang].addWords(shortProduct(p.name), packs), lang });
      if (!onOrderPage) setPanelOpen(true);
    };
  }, [submit, lang, onOrderPage]);
  // A way into the agent from a link (the Order entry, the old Order page): ?agent=open, or ?agent=product:<id> to
  // open it on that product's card.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("agent");
    if (!want) return;
    queueMicrotask(() => setPanelOpen(true));
    if (want.startsWith("product:")) void submit({ door: "typed", via: "tap", action: { type: "product_show", productId: want.slice(8, 88) }, label: THREAD_HOME_TEXT[lang].askAbout, lang });
    const u = new URL(window.location.href);
    u.searchParams.delete("agent");
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    // once per page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The kitchen as the buyer reads it: its name, its agent's name and the example requests in the buyer's language.
  // Display only; `by` (the ledger author) and everything sent to the server stay as the server wrote them.
  const shown = useMemo<KitchenInfo>(
    () => ({ ...kitchen, name: placeNameL(kitchen.name, lang), agentName: agentNameL(kitchen.agentName, lang), examples: kitchen.examples.map((e) => exampleL(e, lang)) }),
    [kitchen, lang],
  );
  const shownKitchens = useMemo(() => kitchens.map((k) => ({ ...k, name: placeNameL(k.name, lang) })), [kitchens, lang]);
  const value = useMemo<Ctx>(
    () => ({ kitchen: shown, account, kitchens: shownKitchens, base, call, ui, overview, lang, setLang, basket, live, agent, thread, fieldRef: inputRef }),
    [shown, account, shownKitchens, base, call, ui, overview, lang, setLang, basket, live, agent, thread],
  );

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
      <VoiceModeProvider kitchen={slug}>
      <Toaster>
        <div className={`relative min-h-dvh overflow-x-clip bg-mist text-ink ${panelOpen && !onOrderPage ? "xl:pr-[27rem] 2xl:pr-[30rem]" : ""}`}>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-paper focus:px-4 focus:py-2 focus:shadow-md">
            {tx.skip}
          </a>
          <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80 sm:px-6">
            <span className="sm:hidden">{tx.demoShort}</span>
            <span className="hidden sm:inline">{DEMO_NOTES[lang]}</span>
          </p>
          <AccountBar kitchen={kitchen} account={account} />
          <Header />
          <main id="main" className="mx-auto min-w-0 max-w-[1320px] px-4 pb-12 sm:px-6 xl:px-8">
            <RecallNotice kitchen={slug} />
            {children}
          </main>
          <footer className="border-t border-line bg-paper">
            <div className="pb-tabbar mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 pt-5 text-[0.82rem] text-ink-soft sm:px-6 lg:!pb-5 xl:px-8">
              <p className="max-w-[80ch]">{tx.footer(PRODUCT_NAME)}</p>
              <p className="hidden items-center gap-1.5 lg:flex">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd> {tx.keysAgent}, <Kbd>/</Kbd> {tx.keysSearch}
              </p>
            </div>
          </footer>
          <TabBar />
          <AssistantPanel />
        </div>
      </Toaster>
      </VoiceModeProvider>
    </PortalContext.Provider>
  );
}

// ---------- header and navigation ----------

/** "Mon–Fri" in the given language (default English). */
export function weekdaysText(days: number[], lang: Lang = "en"): string {
  return weekdaysL(days, lang);
}

function isActive(pathname: string, base: string, sub: string): boolean {
  const href = `${base}${sub}`;
  return sub === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The store's header: one quiet white bar that stays at the top. The word mark, whose kitchen this is, the catalogue
 * search, the language, the agent and the basket; under it, on a desk, the sections as pills. On a phone the bar
 * keeps the mark, the kitchen and the search, and the sections move to the tab bar under the thumb.
 */
function Header() {
  const { kitchen, kitchens, base, overview, basket, live, agent, lang } = usePortal();
  const tx = useText(PORTAL_TEXT);
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
  const [searchOpen, setSearchOpen] = useState(false);
  if (forPath !== pathname) {
    setForPath(pathname);
    if (!onCatalogue) setQ("");
    setSearchOpen(false);
  }
  const showSearch = searchOpen || onCatalogue;
  const waitingLabel = waiting.length === 1 ? tx.waitingFor(waiting[0].authorised.by === "waiting" ? waiting[0].authorised.name : tx.aSignOff) : tx.ordersWaiting(waiting.length);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md supports-[not(backdrop-filter:blur(0))]:bg-paper">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-2.5 sm:px-6 lg:flex-nowrap lg:gap-x-5 lg:py-3 xl:px-8">
        <Link href="/k" className="flex shrink-0 items-center rounded-md" aria-label={`${PRODUCT_NAME}: ${tx.allKitchens}`}>
          <span className="lg:hidden">
            <Wordmark size={25} />
          </span>
          <span className="hidden lg:block">
            <Wordmark size={30} />
          </span>
        </Link>

        {/* Whose kitchen this is. The whole pill is the switch: a native select laid over it. */}
        <div className="relative flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors focus-within:bg-surface hover:bg-surface lg:min-w-[9rem] lg:max-w-[17rem] lg:flex-initial lg:border-l lg:border-line lg:rounded-none lg:rounded-r-full lg:py-0.5 lg:pl-5">
          <Avatar name={kitchen.name} size={34} />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[0.95rem] font-semibold leading-tight">
              <span className="truncate">{kitchen.name}</span>
              <ChevronDown aria-hidden size={15} className="shrink-0 text-ink-soft" />
            </p>
            <p className="hidden truncate text-[0.78rem] leading-snug text-ink-soft lg:block">
              {days ? tx.deliveries(weekdaysText(days, lang)) : ""}
              {approver ? tx.signsOff(approver.name) : ""}
              {kitchen.kind === "visitor" && kitchen.expiresAt ? tx.visitor : ""}
            </p>
          </div>
          <label htmlFor="kitchen-switch" className="sr-only">
            {tx.kitchen}
          </label>
          <select id="kitchen-switch" className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0" value={kitchen.slug} onChange={(e) => router.push(`/k/${e.target.value}`)}>
            {kitchens.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.name}
                {k.kind === "visitor" ? ` (${k.approverName})` : ""}
              </option>
            ))}
          </select>
        </div>

        <form
          role="search"
          aria-label={tx.searchRegion}
          className={`${showSearch ? "flex" : "hidden"} relative order-last basis-full items-center rounded-full bg-surface transition-[background-color,box-shadow] duration-150 focus-within:bg-paper focus-within:shadow-[0_0_0_2px_var(--color-petrol)] lg:order-none lg:flex lg:min-w-[8rem] lg:flex-1 lg:basis-0`}
          onSubmit={(e) => {
            e.preventDefault();
            const t = q.trim();
            router.push(t ? `${base}/catalogue?q=${encodeURIComponent(t)}` : `${base}/catalogue`);
          }}
        >
          <label htmlFor="shop-search" className="sr-only">
            {tx.searchLabel}
          </label>
          <button type="submit" className="absolute left-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-soft hover:text-petrol" aria-label={tx.search}>
            <Search aria-hidden size={18} />
          </button>
          <input
            id="shop-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx.searchPlaceholder}
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-11 min-w-0 flex-1 rounded-full bg-transparent pl-11 pr-4 text-[0.95rem] placeholder:text-ink-soft focus:outline-none"
          />
          <span className="pointer-events-none mr-3 hidden xl:block">
            <Kbd>/</Kbd>
          </span>
        </form>

        <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
          <div className="hidden lg:block">
            <LangSwitch />
          </div>
          <IconButton label={tx.searchLabel} onClick={() => { setSearchOpen((x) => !x); setTimeout(() => document.getElementById("shop-search")?.focus(), 30); }} expanded={showSearch} className="lg:hidden">
            <Search aria-hidden size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => (agent.panelOpen ? agent.setPanelOpen(false) : agent.open())}
            aria-expanded={agent.panelOpen}
            aria-controls="assistant"
            aria-keyshortcuts="Control+K Meta+K"
            className={`hidden min-h-11 items-center gap-2 rounded-full px-4 text-[0.92rem] font-semibold transition-colors duration-150 lg:inline-flex ${agent.panelOpen ? "bg-lavender-deep text-paper" : "bg-lavender text-lavender-deep hover:bg-lavender-mid"}`}
          >
            <AgentIcon size={18} />
            <span className={agent.panelOpen ? "sr-only" : ""}>{tx.agentButton}</span>
            <span className={agent.panelOpen ? "hidden" : "hidden items-center gap-0.5 2xl:flex"}>
              <Kbd dark={agent.panelOpen}>Ctrl K</Kbd>
            </span>
          </button>
          <Link
            href={`${base}/basket`}
            aria-current={pathname === `${base}/basket` ? "page" : undefined}
            className="hidden min-h-11 items-center gap-2 rounded-full border border-line-strong bg-paper pl-3.5 pr-1.5 text-[0.92rem] font-semibold text-ink transition-colors duration-150 hover:border-ink-soft hover:bg-mist lg:inline-flex"
            aria-label={tx.basketLabel(basket.lines.length, priced ? money(basketTotal) : undefined)}
          >
            <ShoppingBasket aria-hidden size={19} />
            {basket.lines.length > 0 && <span className="tabular">{priced ? money(basketTotal) : tx.notPriced}</span>}
            <span key={basket.lines.length} className={`changed flex h-8 min-w-8 items-center justify-center rounded-full px-2 tabular ${basket.lines.length > 0 ? "bg-lime text-ink" : "bg-surface text-ink-soft"}`}>
              {basket.lines.length}
            </span>
          </Link>
        </div>
      </div>

      <nav aria-label={tx.navLabel} className="hidden border-t border-line/70 lg:block">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-6 py-1.5 xl:px-8">
          <ul className="-ml-3 flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap">
            {NAV.map((n) => {
              const active = isActive(pathname, base, n.href);
              if (n.key === "order")
                return (
                  <li key={n.key}>
                    <button type="button" onClick={agent.open} aria-expanded={agent.panelOpen} aria-controls="assistant" className={`flex min-h-10 items-center rounded-full px-3.5 text-[0.92rem] transition-colors duration-150 ${agent.panelOpen ? "bg-petrol-soft font-semibold text-petrol-deep" : "font-medium text-ink-soft hover:bg-surface hover:text-ink"}`}>
                      {tx.nav[n.key]}
                    </button>
                  </li>
                );
              return (
                <li key={n.key}>
                  <Link
                    href={`${base}${n.href}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-10 items-center rounded-full px-3.5 text-[0.92rem] transition-colors duration-150 ${active ? "bg-petrol-soft font-semibold text-petrol-deep" : "font-medium text-ink-soft hover:bg-surface hover:text-ink"}`}
                  >
                    {tx.nav[n.key]}
                  </Link>
                </li>
              );
            })}
          </ul>
          {waiting.length > 0 && <WaitingPill href={`${base}/orders?show=waiting`} label={waitingLabel} />}
        </div>
      </nav>
      {waiting.length > 0 && (
        <div className="border-t border-line/70 px-4 py-1.5 sm:px-6 lg:hidden">
          <WaitingPill href={`${base}/orders?show=waiting`} label={waitingLabel} full />
        </div>
      )}
    </header>
  );
}

/** A sign-off is waiting on a person: the gate's colours, so it is the one thing in the header that asks for attention. */
function WaitingPill({ href, label, full = false }: { href: string; label: string; full?: boolean }) {
  return (
    <Link href={href} className={`flex min-h-9 shrink-0 items-center gap-2 rounded-full bg-safety px-3.5 text-[0.88rem] font-semibold text-safety-ink transition-[filter] hover:brightness-95 ${full ? "w-full justify-center" : ""}`}>
      <Target size={16} tone="safety" />
      <span className="truncate">{label}</span>
      <ChevronRight aria-hidden size={15} className="shrink-0" />
    </Link>
  );
}

// ---------- the phone: sections under the thumb ----------

// The agent's button in the middle is the way to order; the second tab is the kitchen's orders.
const TABS: { href: string; key: "home" | "orders" | "catalogue"; icon: typeof House }[] = [
  { href: "", key: "home", icon: House },
  { href: "/orders", key: "orders", icon: ClipboardList },
];
const TABS_AFTER: { href: string; key: "home" | "orders" | "catalogue"; icon: typeof House }[] = [{ href: "/catalogue", key: "catalogue", icon: LayoutGrid }];

/**
 * On a phone the sections sit in a bar at the bottom edge, with the agent in the middle: one tap opens its sheet.
 * When the basket holds something it rides just above the bar. Wider than a phone, the header carries all of this.
 */
function TabBar() {
  const { base, basket, live, agent, kitchens, kitchen } = usePortal();
  const tx = useText(PORTAL_TEXT);
  const router = useRouter();
  const pathname = usePathname() ?? base;
  const [more, setMore] = useState(false);
  const [forPath, setForPath] = useState(pathname);
  if (forPath !== pathname) {
    setForPath(pathname);
    setMore(false);
  }
  const basketTotal = basket.lines.reduce((s, l) => s + (live.results[l.productId]?.offer?.unitPriceCents ?? 0) * l.packs, 0);
  const priced = basket.lines.length > 0 && basket.lines.every((l) => live.results[l.productId]?.offer);
  const moreActive = ["/menu", "/agent", "/basket"].some((sub) => isActive(pathname, base, sub));
  // On a phone the thread is a screen of its own: going to another tab leaves it.
  const leaveThread = () => agent.panelOpen && agent.setPanelOpen(false);
  const tab = (href: string, label: string, Icon: typeof House, active: boolean) => (
    <Link key={href} href={`${base}${href}`} onClick={leaveThread} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.7rem] font-medium transition-colors ${active ? "text-petrol" : "text-ink-soft"}`}>
      <Icon aria-hidden size={22} strokeWidth={active ? 2.3 : 1.9} />
      <span className="max-w-full truncate px-1">{label}</span>
    </Link>
  );
  return (
    <>
      {basket.lines.length > 0 && pathname !== `${base}/basket` && !agent.panelOpen && (
        <Link
          href={`${base}/basket`}
          aria-label={tx.basketLabel(basket.lines.length, priced ? money(basketTotal) : undefined)}
          className="sheet-up fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex min-h-12 items-center gap-3 rounded-full bg-petrol-deep pl-4 pr-2 text-[0.95rem] font-semibold text-paper shadow-lg lg:hidden"
        >
          <ShoppingBasket aria-hidden size={19} />
          <span className="flex-1">{tx.basketTab}</span>
          {priced && <span className="tabular text-paper/85">{money(basketTotal)}</span>}
          <span key={basket.lines.length} className="flex h-8 min-w-8 items-center justify-center rounded-full bg-lime px-2 text-ink tabular">
            {basket.lines.length}
          </span>
        </Link>
      )}
      <nav aria-label={tx.tabsLabel} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {TABS.map((t) => tab(t.href, tx.nav[t.key], t.icon, !agent.panelOpen && isActive(pathname, base, t.href)))}
          <button
            type="button"
            onClick={() => (agent.panelOpen ? agent.setPanelOpen(false) : agent.open())}
            aria-expanded={agent.panelOpen}
            aria-controls="assistant"
            className="flex min-h-14 flex-col items-center justify-end gap-0.5 rounded-xl pb-[0.3rem] text-[0.7rem] font-semibold text-lavender-deep"
          >
            <span className="-mt-5 flex size-13 items-center justify-center rounded-full bg-lavender-deep text-paper shadow-md ring-4 ring-paper transition-transform duration-150 active:scale-95">
              <AgentIcon size={22} />
            </span>
            <span>{tx.agentButton}</span>
          </button>
          {TABS_AFTER.map((t) => tab(t.href, tx.nav[t.key], t.icon, !agent.panelOpen && isActive(pathname, base, t.href)))}
          <button type="button" onClick={() => { leaveThread(); setMore(true); }} aria-haspopup="dialog" aria-expanded={more} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.7rem] font-medium ${moreActive ? "text-petrol" : "text-ink-soft"}`}>
            <Ellipsis aria-hidden size={22} strokeWidth={moreActive ? 2.3 : 1.9} />
            <span>{tx.more}</span>
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title={tx.more}>
        <ul className="-mx-5 divide-y divide-line border-y border-line">
          {(
            [
              { sub: "/orders", key: "orders", icon: ReceiptText },
              { sub: "/basket", key: "basket", icon: ShoppingBasket },
              { sub: "/menu", key: "menu", icon: ChefHat },
              { sub: "/agent", key: "agent", icon: ShieldCheck },
            ] as const
          ).map(({ sub, key, icon: Icon }) => (
            <li key={sub}>
              <ListRow
                href={`${base}${sub}`}
                leading={
                  <IconDisc size={38} tone={isActive(pathname, base, sub) ? "petrol" : "muted"}>
                    <Icon size={19} />
                  </IconDisc>
                }
                title={key === "basket" ? tx.basketTab : tx.nav[key]}
                trailing={key === "basket" && basket.lines.length > 0 ? <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-lime px-2 text-[0.85rem] font-semibold tabular">{basket.lines.length}</span> : <ChevronRight aria-hidden size={18} className="text-ink-faint" />}
              />
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-[0.92rem] font-medium">{tx.language}</p>
          <LangSwitch />
        </div>
        {kitchens.length > 1 && (
          <Select label={tx.kitchen} className="mt-5" value={kitchen.slug} onChange={(v) => router.push(`/k/${v}`)}>
            {kitchens.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.name}
                {k.kind === "visitor" ? ` (${k.approverName})` : ""}
              </option>
            ))}
          </Select>
        )}
      </Sheet>
    </>
  );
}

/** The agent's mark: a spark, on lavender. */
export function AgentIcon({ size = 20 }: { size?: number }) {
  return <Sparkles aria-hidden size={size} />;
}

/** "100 L lactose-free milk for Thursday" (Tue 10.11.) or the order it stands for. */
export function requestLabel(r: PortalRequest, lang: Lang = "en"): string {
  const d = dayL(helsinkiToday(new Date(r.at)), lang);
  if (r.text) return `“${r.text.length > 70 ? `${r.text.slice(0, 67)}…` : r.text}”, ${d}`;
  const l = r.order?.lines[0];
  return l ? `${l.quantity} × ${shortProduct(l.name)}, ${d}` : PORTAL_TEXT[lang].orderOf(d);
}
