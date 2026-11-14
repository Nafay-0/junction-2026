"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessagesSquare, Activity, Bot, Circle, CirclePause, Ellipsis, FileCheck2, History, LogOut, Radar, Route, Server, ShieldCheck, SlidersHorizontal, Store, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { PRODUCT_NAME } from "../../_ui/brand";
import { Avatar, Sheet } from "../../_ui/kit";
import { clockSeconds } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { Wordmark } from "../../_ui/wordmark";
import { num } from "./format";
import { useNow } from "./kit";

type Session = { signedIn: boolean; name?: string; mode: "demo" | "passcode"; chain?: { ok: boolean; length: number }; waiting?: number; suspended?: number };

const NAV: { href: string; label: string; what: string; key: string }[] = [
  { href: "/ops", label: "Live", what: "Agents at the door", key: "l" },
  { href: "/ops/trace", label: "Trace", what: "One request, step by step", key: "t" },
  { href: "/ops/conversation", label: "Conversations", what: "A kitchen and its agent, turn by turn", key: "v" },
  { href: "/ops/safeguards", label: "Safeguards", what: "The rule book as it runs", key: "s" },
  { href: "/ops/radar", label: "Recall radar", what: "Recalls, holds, drills", key: "r" },
  { href: "/ops/control", label: "Control", what: "Suspend, resume, sign-offs", key: "c" },
  { href: "/ops/audit", label: "Audit", what: "Orders and their proof", key: "a" },
  { href: "/ops/time-machine", label: "Time machine", what: "The rules as they stood", key: "m" },
  { href: "/ops/agents", label: "Agents", what: "Licences and records", key: "g" },
  { href: "/ops/customers", label: "Customers", what: "What kitchens share", key: "u" },
  { href: "/ops/accounts", label: "Accounts", what: "Kitchens with an account", key: "n" },
  { href: "/ops/platform", label: "Platform", what: "What runs on Aiven, live", key: "p" },
];

/** One icon per section, by address, so a section added to NAV without one still shows (with a plain ring). */
const ICON: Record<string, LucideIcon> = {
  "/ops": Activity,
  "/ops/trace": Route,
  "/ops/conversation": MessagesSquare,
  "/ops/safeguards": ShieldCheck,
  "/ops/radar": Radar,
  "/ops/control": SlidersHorizontal,
  "/ops/audit": FileCheck2,
  "/ops/agents": Bot,
  "/ops/customers": Users,
  "/ops/platform": Server,
  "/ops/time-machine": History,
  "/ops/accounts": Store,
};
/** The four sections in the phone's tab bar; the rest are one tap further, under More. */
const PRIMARY = ["/ops", "/ops/trace", "/ops/control", "/ops/safeguards"];

/** Shown at the rail's foot on every operations page. */
export const OPS_DEMO_NOTE = "Demo on synthetic data, built for the Junction 2026 Valio Aimo challenge. Not the wholesaler's own system.";

/**
 * The operations portal's shell. On a desk: a petrol-deep sidebar, so staff always know they are on the
 * wholesaler's side, and a status bar above the page with what a person on the desk needs to know before anything
 * else (the ledger chain, sign-offs waiting on a person, agents suspended, Helsinki time). On a phone: a top bar with
 * the same status, and the sections in a tab bar under the thumb, the rest under More.
 * Every section has a key: press g, then the letter (g l for Live, g t for Trace...).
 */
export function Rail() {
  const path = usePathname();
  const router = useRouter();
  const now = useNow(1000);
  const live = useLive<Session>(
    async () => {
      const r = await api<Session>("GET", "/ops-api/session");
      if (!r.ok) throw new Error(r.error.message);
      if (!r.data.signedIn) router.replace(`/ops/enter?next=${encodeURIComponent(location.pathname)}`);
      return r.data;
    },
    // Polling only: the page beside it holds the one event stream, so several open tabs stay within the
    // browser's six connections per host.
    { events: null, pollMs: 5000 },
  );
  const s = live.data;
  const active = (href: string) => (href === "/ops" ? path === "/ops" : path.startsWith(href));

  // "g" then a letter jumps to a section, as in a mail client. Ignored while typing.
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "g") {
        armed = Date.now();
        return;
      }
      if (armed && Date.now() - armed < 1200) {
        const hit = NAV.find((n) => n.key === e.key);
        armed = 0;
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function leave() {
    await fetch("/ops-api/session", { method: "DELETE", credentials: "same-origin" });
    router.replace("/ops/enter");
  }

  const waiting = s?.waiting ?? 0;
  const suspended = s?.suspended ?? 0;
  const [more, setMore] = useState(false);
  const [forPath, setForPath] = useState(path);
  if (forPath !== path) {
    setForPath(path);
    setMore(false);
  }

  /** The gatehouse's status: the ledger chain, sign-offs waiting on a person, agents suspended. */
  const status = (compact: boolean) => (
    <>
      {s?.chain && (
        <span title="Every ledger entry hashes the one before it" className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[0.82rem] font-medium ${s.chain.ok ? "bg-good-soft text-good" : "bg-safety-ink text-safety"}`}>
          {s.chain.ok ? <ShieldCheck aria-hidden size={15} /> : <Target size={14} tone="safety" />}
          {s.chain.ok ? (compact ? `${num(s.chain.length)}` : `Ledger intact, ${num(s.chain.length)} entries`) : "Ledger chain broken"}
          {compact && s.chain.ok && <span className="sr-only"> ledger entries, chain intact</span>}
        </span>
      )}
      {waiting > 0 ? (
        <Link href="/ops/control#waiting" className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-safety px-3 text-[0.82rem] font-semibold text-safety-ink transition-[filter] hover:brightness-95">
          <Target size={14} tone="safety" />
          {compact ? waiting : `${waiting} sign-off${waiting === 1 ? "" : "s"} waiting`}
          {compact && <span className="sr-only"> sign-offs waiting</span>}
        </Link>
      ) : (
        !compact && <span className="whitespace-nowrap text-[0.82rem] text-ink-soft">No sign-off waiting</span>
      )}
      {suspended > 0 && (
        <Link href="/ops/control" className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-safety-soft px-3 text-[0.82rem] font-semibold text-safety-ink ring-1 ring-inset ring-safety/60">
          <CirclePause aria-hidden size={15} />
          {suspended}
          {!compact && " suspended"}
          {compact && <span className="sr-only"> suspended</span>}
        </Link>
      )}
    </>
  );

  const item = (n: (typeof NAV)[number], onDark: boolean) => {
    const on = active(n.href);
    const Icon = ICON[n.href] ?? Circle;
    return (
      <Link
        key={n.href}
        href={n.href}
        title={n.what}
        aria-current={on ? "page" : undefined}
        aria-keyshortcuts={`g ${n.key}`}
        className={
          onDark
            ? `group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.92rem] transition-colors duration-150 ${on ? "bg-paper/12 font-semibold text-paper" : "font-medium text-paper/70 hover:bg-paper/8 hover:text-paper"}`
            : `flex min-h-13 items-center gap-3.5 px-5 text-[0.98rem] transition-colors ${on ? "font-semibold text-petrol" : "font-medium text-ink hover:bg-mist"}`
        }
      >
        {onDark && on && <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-lime" />}
        <Icon aria-hidden size={onDark ? 18 : 20} strokeWidth={on ? 2.2 : 1.9} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {n.label}
          {!onDark && <span className="block text-[0.8rem] font-normal text-ink-soft">{n.what}</span>}
        </span>
        {onDark && <kbd className="hidden text-[0.7rem] font-medium uppercase text-paper/35 group-hover:block">{n.key}</kbd>}
      </Link>
    );
  };

  return (
    <>
      {/* ----- a desk: the sidebar, and the status bar above the page ----- */}
      <aside className="on-dark sticky top-0 hidden h-dvh w-[15rem] shrink-0 flex-col bg-petrol-deep text-paper lg:flex">
        <Link href="/ops" className="block px-5 pb-4 pt-5 leading-none" aria-label={`${PRODUCT_NAME}, wholesaler operations`}>
          <Wordmark tone="paper" size={27} />
          <span className="mt-2 block text-[0.8rem] text-paper/60">Wholesaler operations</span>
        </Link>
        <nav aria-label="Operations" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
          {NAV.map((n) => item(n, true))}
        </nav>
        <div className="border-t border-paper/10 px-5 py-4 text-[0.76rem] leading-snug text-paper/55">
          <p>
            Press <kbd className="rounded-xs border border-paper/30 px-1 text-paper/80">g</kbd> then a section&apos;s letter to jump.
          </p>
          <p className="mt-2">{OPS_DEMO_NOTE}</p>
        </div>
      </aside>
      <div className="fixed left-[15rem] right-0 top-0 z-20 hidden h-14 items-center justify-end gap-2.5 border-b border-line bg-mist/85 px-6 backdrop-blur-md lg:flex xl:px-10">
        {status(false)}
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
        <span className="text-[0.86rem] font-medium tabular text-ink-soft" title="Helsinki time" suppressHydrationWarning>
          {now ? clockSeconds(new Date(now)) : "–"}
        </span>
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
        <span className="flex items-center gap-2 text-[0.86rem]">
          <Avatar name={s?.name ?? "Operations"} size={30} />
          <span className="hidden font-medium xl:inline">{s?.name ?? "…"}</span>
          <button type="button" onClick={leave} title={s?.mode === "demo" ? "Leave (demo entry)" : "Leave"} aria-label="Leave the operations portal" className="flex size-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink">
            <LogOut aria-hidden size={17} />
          </button>
        </span>
      </div>

      {/* ----- a phone: a top bar with the status, and the sections under the thumb ----- */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur-md lg:hidden">
        <Link href="/ops" className="mr-auto flex min-w-0 items-center" aria-label={`${PRODUCT_NAME}, wholesaler operations`}>
          <Wordmark size={24} />
        </Link>
        {status(true)}
      </header>
      <nav aria-label="Operations" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 px-2">
          {NAV.filter((n) => PRIMARY.includes(n.href)).map((n) => {
            const on = active(n.href);
            const Icon = ICON[n.href] ?? Circle;
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium ${on ? "text-petrol" : "text-ink-soft"}`}>
                <Icon aria-hidden size={22} strokeWidth={on ? 2.3 : 1.9} />
                <span className="max-w-full truncate px-1">{n.label}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-none text-[0.7rem] font-medium ${NAV.some((n) => !PRIMARY.includes(n.href) && active(n.href)) ? "text-petrol" : "text-ink-soft"}`}>
            <Ellipsis aria-hidden size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="Operations">
        <nav aria-label="All sections" className="-mx-5 divide-y divide-line border-y border-line">
          {NAV.map((n) => item(n, false))}
        </nav>
        <p className="mt-5 flex items-center justify-between gap-4 text-[0.9rem]">
          <span className="text-ink-soft">
            Signed in as <span className="font-semibold text-ink">{s?.name ?? "…"}</span>
            {s?.mode === "demo" && ", demo entry"}
          </span>
          <button type="button" onClick={leave} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong px-4 font-semibold">
            <LogOut aria-hidden size={16} />
            Leave
          </button>
        </p>
        <p className="mt-4 text-[0.8rem] leading-snug text-ink-soft">{OPS_DEMO_NOTE}</p>
      </Sheet>
    </>
  );
}
