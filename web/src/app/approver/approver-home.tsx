"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../_client/api";
import { useDockEvents } from "../_client/use-dock-events";
import { fiMoney } from "../_ui/plain";
import { PhoneNotice, bigButton } from "../_ui/phone";

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

  if (state === "loading") return <p className="mt-20 text-center text-ink-soft">Opening your screen…</p>;
  if (state === "not_joined")
    return (
      <PhoneNotice title="You haven't joined yet" body="Scan the QR code on the big screen to become a kitchen's purchasing manager.">
        <Link href="/join" className={`mt-6 ${bigButton("go")}`}>
          Join on this phone
        </Link>
      </PhoneNotice>
    );
  if (state === "offline" || !home)
    return (
      <PhoneNotice title="Can't reach Dock" body="Check the connection, then try again.">
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void refresh()}>
          Try again
        </button>
      </PhoneNotice>
    );

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[1rem] text-ink-soft">You are</p>
      <h1 className="display mt-1 text-[2.8rem] leading-[0.95] text-ink">{home.approver.name}</h1>
      <p className="mt-1 text-[1.15rem]">
        {home.approver.roleLabel}, {home.kitchen.name}
      </p>

      <div className="mt-5 bg-paper p-4 text-[1rem] leading-snug">
        <div aria-hidden className="-mx-4 -mt-4 mb-3 h-[3px] bg-petrol" />
        <p>
          <strong>{home.agent.name}</strong> buys for this kitchen. It may spend up to <strong className="tabular">{fiMoney(home.agent.perOrderLimit)}</strong> per order alone. Bigger orders and product swaps stop at the gate and come to you here.
        </p>
        {!home.approver.passkey && <p className="mt-2 font-semibold">Demo only: you joined without a passkey, so your approvals are marked unverified.</p>}
      </div>
      {/* /k/mine is a redirect route, not a page: a plain link does the full navigation it needs. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/k/mine" className={`mt-3 ${bigButton("secondary")} min-h-12 text-[1.02rem]`}>
        Open my kitchen&apos;s shop
      </a>

      {home.pending.length > 0 ? (
        <section className="mt-6">
          <h2 className="display text-[1.6rem]">Waiting for you</h2>
          <ul className="mt-2 space-y-2">
            {home.pending.map((p) => (
              <li key={p.approvalId}>
                <Link href={`/approve/${p.approvalId}`} className="flex min-h-16 items-center justify-between gap-3 border-l-[6px] border-safety-ink bg-safety px-4 text-safety-ink">
                  <span className="display text-[1.8rem] tabular">{fiMoney(p.total)}</span>
                  <span className="text-[1rem]">since {p.requestedAtText}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-10 flex flex-col items-center text-center" aria-live="polite">
          <span aria-hidden className="breathe block size-4 bg-petrol" />
          <p className="display mt-4 text-[1.8rem]">Waiting for requests</p>
          <p className="mt-1 text-[1rem] text-ink-soft">Keep this screen open. A request opens here by itself.</p>
        </div>
      )}

      {home.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[1rem] font-semibold text-ink-soft">Earlier</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-[1rem]">
            {home.recent.map((o, i) => (
              <li key={o.approvalId ?? i} className="flex min-h-11 items-center justify-between gap-3 py-2">
                {o.approvalId ? (
                  <Link href={`/approve/${o.approvalId}`} className="font-semibold text-petrol underline decoration-2 underline-offset-4">
                    {STATUS_TEXT[o.status] ?? o.status}
                  </Link>
                ) : (
                  <span>{STATUS_TEXT[o.status] ?? o.status}</span>
                )}
                <span className="tabular">
                  {fiMoney(o.total)}, {o.atText}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-auto pt-10">
        {note && (
          <p role="status" className="mb-3 text-[1rem]">
            {note}
          </p>
        )}
        <Link href="/call" className={`mb-3 ${bigButton("go")}`}>
          Call your agent
        </Link>
        <button className={`${bigButton("secondary")} min-h-14 text-[1.02rem]`} disabled={asking} onClick={() => void askAgent()}>
          {asking ? "Asking the agent…" : "Demo: ask my agent for 1,000 L of milk"}
        </button>
        <p className="mt-3 text-center text-[0.9rem] text-ink-soft">This demo kitchen closes at {home.expiresAtText}.</p>
      </div>
    </div>
  );
}
