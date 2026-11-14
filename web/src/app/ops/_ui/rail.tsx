"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { PRODUCT_NAME } from "../../_ui/brand";
import { clockSeconds } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { num } from "./format";
import { useNow } from "./kit";

type Session = { signedIn: boolean; name?: string; mode: "demo" | "passcode"; chain?: { ok: boolean; length: number }; waiting?: number; suspended?: number };

const NAV: { href: string; label: string; what: string; key: string }[] = [
  { href: "/ops", label: "Live", what: "Agents at the door", key: "l" },
  { href: "/ops/trace", label: "Trace", what: "One request, step by step", key: "t" },
  { href: "/ops/safeguards", label: "Safeguards", what: "The rule book as it runs", key: "s" },
  { href: "/ops/radar", label: "Recall radar", what: "Recalls, holds, drills", key: "r" },
  { href: "/ops/control", label: "Control", what: "Suspend, resume, sign-offs", key: "c" },
  { href: "/ops/audit", label: "Audit", what: "Orders and their proof", key: "a" },
  { href: "/ops/time-machine", label: "Time machine", what: "The rules as they stood", key: "m" },
  { href: "/ops/agents", label: "Agents", what: "Licences and records", key: "g" },
  { href: "/ops/customers", label: "Customers", what: "What kitchens share", key: "u" },
  { href: "/ops/platform", label: "Platform", what: "What runs on Aiven, live", key: "p" },
];

/** Shown at the rail's foot on every operations page. */
export const OPS_DEMO_NOTE = "Demo on synthetic data, built for the Junction 2026 Valio Aimo challenge. Not the wholesaler's own system.";

/**
 * The operations portal's rail: petrol-deep, so staff always know they are on the wholesaler's side. It is headed by
 * the gatehouse's status (Helsinki clock, ledger chain, sign-offs waiting on a person, agents suspended), and every
 * section has a key: press g, then the letter (g l for Live, g t for Trace...).
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

  return (
    <aside className="on-dark flex shrink-0 flex-col bg-petrol-deep text-paper lg:sticky lg:top-0 lg:h-dvh lg:w-[232px]">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 lg:block">
        <Link href="/ops" className="flex items-center gap-2.5">
          <Target size={30} tone="chalk" />
          <span className="leading-none">
            <span className="display block text-[1.6rem]">{PRODUCT_NAME}</span>
            <span className="mt-0.5 block text-[0.82rem] text-paper/75">Wholesaler operations</span>
          </span>
        </Link>
        {/* The gatehouse: what a person on the desk needs to know before anything else. */}
        <dl className="flex items-center gap-4 text-[0.85rem] lg:mt-4 lg:block lg:space-y-1.5 lg:border-t lg:border-paper/15 lg:pt-3">
          <div className="hidden lg:block">
            <dt className="sr-only">Helsinki time</dt>
            <dd className="display text-[1.5rem] tabular" suppressHydrationWarning>
              {now ? clockSeconds(new Date(now)) : "–"}
            </dd>
          </div>
          {s?.chain && (
            <div className="flex items-center gap-2" title="Every ledger entry hashes the one before it">
              <dt className="sr-only">Ledger</dt>
              <Target size={14} tone={s.chain.ok ? "chalk" : "safety"} />
              <dd>{s.chain.ok ? `Ledger intact, ${num(s.chain.length)} entries` : "Ledger chain broken"}</dd>
            </div>
          )}
          <div>
            <dt className="sr-only">Sign-offs waiting</dt>
            <dd>
              <Link href="/ops/control#waiting" className="flex items-center gap-2 hover:underline">
                {waiting > 0 ? <span aria-hidden className="hazard-thin size-3.5 shrink-0" /> : <span aria-hidden className="size-3.5 shrink-0 border border-paper/50" />}
                <span className={waiting > 0 ? "font-semibold" : "text-paper/75"}>{waiting > 0 ? `${waiting} sign-off${waiting === 1 ? "" : "s"} waiting` : "No sign-off waiting"}</span>
              </Link>
            </dd>
          </div>
          {suspended > 0 && (
            <div>
              <dt className="sr-only">Suspended</dt>
              <dd>
                <Link href="/ops/control" className="flex items-center gap-2 font-semibold hover:underline">
                  <span aria-hidden className="size-3.5 shrink-0 bg-safety ring-1 ring-paper/40" />
                  {suspended} suspended
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <nav aria-label="Operations" className="flex gap-0.5 overflow-x-auto border-t border-paper/15 px-2 py-2 lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {NAV.map((n) => {
          const on = active(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              aria-keyshortcuts={`g ${n.key}`}
              className={`group relative shrink-0 px-3 py-1.5 ${on ? "bg-petrol" : "hover:bg-petrol/50"}`}
            >
              {on && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-lime" />}
              <span className="block text-[1rem] font-semibold leading-tight">{n.label}</span>
              <span className={`hidden text-[0.78rem] leading-tight lg:block ${on ? "text-paper/85" : "text-paper/60"}`}>{n.what}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-paper/15 px-4 py-3 text-[0.8rem] leading-snug text-paper/70 lg:block">
        <p>
          Signed in as <span className="font-semibold text-paper">{s?.name ?? "…"}</span>
          {s?.mode === "demo" && ", demo entry"}.{" "}
          <button type="button" onClick={leave} className="underline underline-offset-2 hover:text-paper">
            Leave
          </button>
        </p>
        <p className="mt-1.5">
          Press <kbd className="border border-paper/40 px-1 font-sans text-paper">g</kbd> then a section&apos;s letter to jump.
        </p>
        <p className="mt-1.5">{OPS_DEMO_NOTE}</p>
      </div>
    </aside>
  );
}
