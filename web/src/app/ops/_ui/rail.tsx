"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { Target } from "../../_ui/target";
import { num } from "./format";

type Session = { signedIn: boolean; name?: string; mode: "demo" | "passcode"; chain?: { ok: boolean; length: number }; waiting?: number; suspended?: number };

const NAV: { href: string; label: string; what: string; badge?: (s: Session) => number | undefined }[] = [
  { href: "/ops", label: "Live", what: "Agents at the door" },
  { href: "/ops/trace", label: "Trace", what: "One request, step by step" },
  { href: "/ops/safeguards", label: "Safeguards", what: "The rule book as it runs" },
  { href: "/ops/radar", label: "Recall radar", what: "Recalls on the web, holds, drills" },
  { href: "/ops/control", label: "Control", what: "Suspend, resume, waiting sign-offs", badge: (s) => (s.waiting || 0) + (s.suspended || 0) || undefined },
  { href: "/ops/audit", label: "Audit", what: "Orders, exports, verify a receipt" },
  { href: "/ops/agents", label: "Agents", what: "Licences and records" },
  { href: "/ops/customers", label: "Customers", what: "What the kitchens share with us" },
];

/**
 * The operations portal's rail: dark steel like the wall, so staff always know they are on the wholesaler's side,
 * never in a kitchen's portal. Shows who is signed in and whether the ledger chain is intact.
 */
export function Rail() {
  const path = usePathname();
  const router = useRouter();
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

  async function leave() {
    await fetch("/ops-api/session", { method: "DELETE", credentials: "same-origin" });
    router.replace("/ops/enter");
  }

  return (
    <aside className="on-steel flex shrink-0 flex-col bg-steel text-chalk lg:sticky lg:top-0 lg:h-dvh lg:w-[212px]">
      <div className="flex items-center gap-2.5 border-b border-steel-3 px-4 py-3.5">
        <Target size={28} tone="chalk" />
        <div className="leading-none">
          <p className="font-display text-[1.45rem] font-bold tracking-tight">Dock</p>
          <p className="mt-0.5 text-[0.78rem] text-chalk-soft">Wholesaler operations</p>
        </div>
      </div>
      <nav aria-label="Operations" className="flex gap-0.5 overflow-x-auto px-2 py-2 lg:flex-1 lg:flex-col lg:overflow-visible">
        {NAV.map((n) => {
          const badge = s && n.badge?.(s);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`group shrink-0 px-2.5 py-2 ${active(n.href) ? "bg-steel-2 shadow-[inset_3px_0_0_var(--color-chalk)]" : "hover:bg-steel-2/60"}`}
            >
              <span className="flex items-center justify-between gap-2 text-[0.98rem] font-semibold">
                {n.label}
                {badge ? <span className="min-w-5 bg-safety px-1 text-center text-[0.75rem] font-bold text-safety-ink tabular">{badge}</span> : null}
              </span>
              <span className="hidden text-[0.76rem] text-chalk-soft lg:block">{n.what}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-steel-3 px-4 py-3 text-[0.8rem] lg:block">
        {s?.chain && (
          <p className="flex items-center gap-2" title="Every ledger entry hashes the one before it">
            <Target size={14} tone={s.chain.ok ? "chalk" : "safety"} />
            {s.chain.ok ? `Ledger intact, ${num(s.chain.length)} entries` : "Ledger chain broken"}
          </p>
        )}
        <p className="mt-2 text-chalk-soft">
          Signed in as <span className="text-chalk">{s?.name ?? "…"}</span>
          {s?.mode === "demo" && <span className="block">Demo entry, no password</span>}
        </p>
        <button type="button" onClick={leave} className="mt-1 text-chalk-soft underline underline-offset-2 hover:text-chalk">
          Leave operations
        </button>
        <p className="mt-3 text-chalk-soft">
          Kitchens use their own portal at{" "}
          <Link href="/k" className="underline underline-offset-2 hover:text-chalk">
            /k
          </Link>
          . Demo on synthetic data.
        </p>
      </div>
    </aside>
  );
}
