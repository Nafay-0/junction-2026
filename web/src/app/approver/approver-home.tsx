"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../_client/api";
import { useDockEvents } from "../_client/use-dock-events";

type Home = {
  approver: { name: string; roleLabel: string; passkey: boolean };
  kitchen: { name: string; city: string };
  agent: { name: string; perOrderLimit: string; weeklyBudget: string };
  expiresAtText: string;
  demoTapEnabled: boolean;
  pending: { approvalId: string; total: string; requestedAtText: string }[];
  recent: { approvalId?: string; status: string; total: string; delivery?: string; atText: string }[];
};

const STATUS_TEXT: Record<string, string> = {
  committed: "Placed",
  declined: "Declined",
  rejected: "Not placed",
};

export function ApproverHome() {
  const router = useRouter();
  const [home, setHome] = useState<Home | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_joined" | "offline">("loading");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<Home>("GET", "/api/v1/approver");
    if (r.ok) {
      setHome(r.data);
      setState("ready");
    } else setState(r.status === 401 ? "not_joined" : "offline");
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  useDockEvents(
    state === "ready" ? "/api/v1/events?scope=mine" : null,
    (e) => {
      if (e.type === "approval_requested" && e.approvalId) {
        navigator.vibrate?.([120, 60, 120]);
        router.push(`/approve/${e.approvalId}`);
        return;
      }
      void refresh();
    },
    () => void refresh(),
  );

  async function askAgent() {
    setAsking(true);
    setNote(null);
    const r = await api<{ order: { status: string; approvalId?: string } }>("POST", "/api/v1/approver/demo-order");
    setAsking(false);
    if (!r.ok) return setNote(r.error.message);
    if (r.data.order.status !== "pending_approval") setNote(`The agent's order was ${r.data.order.status.replace("_", " ")} without needing you.`);
    // a pending order arrives through the live event and opens the sign-off screen
  }

  if (state === "loading") return <p className="mt-20 text-center text-neutral-600">Loading…</p>;
  if (state === "not_joined")
    return (
      <div className="mt-16">
        <h1 className="text-3xl font-bold">You haven&apos;t joined yet</h1>
        <p className="mt-3">Scan the QR code on the big screen to become a kitchen&apos;s purchasing manager.</p>
        <Link href="/join" className="mt-6 flex h-14 items-center justify-center rounded-xl bg-neutral-900 font-semibold text-white">
          Join on this phone
        </Link>
      </div>
    );
  if (state === "offline" || !home)
    return (
      <div className="mt-16">
        <h1 className="text-3xl font-bold">Can&apos;t reach Dock</h1>
        <button className="mt-6 h-14 w-full rounded-xl bg-neutral-900 font-semibold text-white" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-base font-medium uppercase tracking-wide text-neutral-500">You are</p>
      <h1 className="mt-1 text-3xl font-bold leading-tight">{home.approver.name}</h1>
      <p className="mt-1 text-xl">
        {home.approver.roleLabel}, {home.kitchen.name}
      </p>

      <div className="mt-6 rounded-2xl bg-neutral-100 p-4 text-base">
        <p>
          <strong>{home.agent.name}</strong> buys for this kitchen. It may spend up to <strong>{home.agent.perOrderLimit}</strong> per order alone. Bigger orders and product
          swaps come to you here.
        </p>
        {!home.approver.passkey && <p className="mt-2 font-semibold text-amber-800">Demo only: you joined without a passkey, so your approvals are marked unverified.</p>}
      </div>
      {/* /k/mine is a redirect route, not a page: a plain link does the full navigation it needs. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/k/mine" className="mt-3 flex h-12 items-center justify-center rounded-xl border-2 border-neutral-900 text-base font-semibold">
        Open my kitchen&apos;s shop
      </a>

      {home.pending.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Waiting for you</h2>
          <ul className="mt-2 space-y-2">
            {home.pending.map((p) => (
              <li key={p.approvalId}>
                <Link href={`/approve/${p.approvalId}`} className="flex h-16 items-center justify-between rounded-xl bg-amber-100 px-4 text-xl font-semibold">
                  <span>{p.total}</span>
                  <span className="text-base font-normal">since {p.requestedAtText} ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-10 flex flex-col items-center text-center" aria-live="polite">
          <span className="relative flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-green-600" />
          </span>
          <p className="mt-4 text-xl font-semibold">Waiting for requests</p>
          <p className="mt-1 text-base text-neutral-600">Keep this screen open. A request opens here by itself.</p>
        </div>
      )}

      {home.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Earlier</h2>
          <ul className="mt-2 divide-y divide-neutral-200 text-base">
            {home.recent.map((o, i) => (
              <li key={o.approvalId ?? i} className="flex justify-between py-2">
                {o.approvalId ? <Link href={`/approve/${o.approvalId}`}>{STATUS_TEXT[o.status] ?? o.status}</Link> : <span>{STATUS_TEXT[o.status] ?? o.status}</span>}
                <span>
                  {o.total} · {o.atText}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-auto pt-10">
        {note && (
          <p role="status" className="mb-3 text-base text-neutral-700">
            {note}
          </p>
        )}
        <Link href="/call" className="mb-3 flex h-16 w-full items-center justify-center rounded-2xl bg-green-700 text-xl font-semibold text-white">
          Call your agent
        </Link>
        <button className="h-14 w-full rounded-xl border border-neutral-300 text-base" disabled={asking} onClick={() => void askAgent()}>
          {asking ? "Asking the agent…" : "Demo: ask my agent for 1,000 L of milk"}
        </button>
        <p className="mt-3 text-center text-sm text-neutral-500">This demo kitchen closes at {home.expiresAtText}.</p>
      </div>
    </div>
  );
}
