"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../_client/api";
import { useDockEvents } from "../_client/use-dock-events";
import { useLang } from "../_i18n/provider";
import { fiMoney } from "../_ui/plain";
import { PhoneNotice, bigButton } from "../_ui/phone";
import { serverClock, serverRole } from "../_ui/phone.text";
import { APPROVER_TEXT } from "./approver-home.text";

type Home = {
  approver: { name: string; roleLabel: string; passkey: boolean };
  kitchen: { name: string; city: string };
  agent: { name: string; perOrderLimit: string; weeklyBudget: string };
  expiresAtText: string;
  demoTapEnabled: boolean;
  pending: { approvalId: string; total: string; requestedAtText: string }[];
  recent: { approvalId?: string; status: string; total: string; delivery?: string; atText: string }[];
};

export function ApproverHome() {
  const router = useRouter();
  const { lang } = useLang();
  const tx = APPROVER_TEXT[lang];
  const at = (t: string) => serverClock(t, lang);
  const [home, setHome] = useState<Home | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_joined" | "offline">("loading");
  const [asking, setAsking] = useState(false);
  /** A server message as it came, or the status of an order that did not need this person (said in words here). */
  const [note, setNote] = useState<{ message: string } | { status: string } | null>(null);

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
    if (!r.ok) return setNote({ message: r.error.message });
    if (r.data.order.status !== "pending_approval") setNote({ status: r.data.order.status });
    // a pending order arrives through the live event and opens the sign-off screen
  }

  if (state === "loading") return <p className="mt-20 text-center text-ink-soft">{tx.loading}</p>;
  if (state === "not_joined")
    return (
      <PhoneNotice title={tx.notJoined} body={tx.notJoinedBody}>
        <Link href="/join" className={`mt-6 ${bigButton("go")}`}>
          {tx.join}
        </Link>
      </PhoneNotice>
    );
  if (state === "offline" || !home)
    return (
      <PhoneNotice title={tx.offline} body={tx.offlineBody}>
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void refresh()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[1rem] text-ink-soft">{tx.youAre}</p>
      <h1 className="display mt-1 text-[2.8rem] leading-[0.95] text-ink">{home.approver.name}</h1>
      <p className="mt-1 text-[1.15rem]">
        {serverRole(home.approver.roleLabel, lang)}, {home.kitchen.name}
      </p>

      <div className="mt-5 bg-paper p-4 text-[1rem] leading-snug">
        <div aria-hidden className="-mx-4 -mt-4 mb-3 h-[3px] bg-petrol" />
        <p>{tx.agentIntro(<strong>{home.agent.name}</strong>, <strong className="tabular">{fiMoney(home.agent.perOrderLimit)}</strong>)}</p>
        {!home.approver.passkey && <p className="mt-2 font-semibold">{tx.noPasskey}</p>}
      </div>
      {/* /k/mine is a redirect route, not a page: a plain link does the full navigation it needs. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/k/mine" className={`mt-3 ${bigButton("secondary")} min-h-12 text-[1.02rem]`}>
        {tx.openShop}
      </a>

      {home.pending.length > 0 ? (
        <section className="mt-6">
          <h2 className="display text-[1.6rem]">{tx.waitingForYou}</h2>
          <ul className="mt-2 space-y-2">
            {home.pending.map((p) => (
              <li key={p.approvalId}>
                <Link href={`/approve/${p.approvalId}`} className="flex min-h-16 items-center justify-between gap-3 border-l-[6px] border-safety-ink bg-safety px-4 text-safety-ink">
                  <span className="display text-[1.8rem] tabular">{fiMoney(p.total)}</span>
                  <span className="text-[1rem]">{tx.since(at(p.requestedAtText))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-10 flex flex-col items-center text-center" aria-live="polite">
          <span aria-hidden className="breathe block size-4 bg-petrol" />
          <p className="display mt-4 text-[1.8rem]">{tx.waitingRequests}</p>
          <p className="mt-1 text-[1rem] text-ink-soft">{tx.keepOpen}</p>
        </div>
      )}

      {home.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[1rem] font-semibold text-ink-soft">{tx.earlier}</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line text-[1rem]">
            {home.recent.map((o, i) => (
              <li key={o.approvalId ?? i} className="flex min-h-11 items-center justify-between gap-3 py-2">
                {o.approvalId ? (
                  <Link href={`/approve/${o.approvalId}`} className="font-semibold text-petrol underline decoration-2 underline-offset-4">
                    {tx.status[o.status] ?? o.status}
                  </Link>
                ) : (
                  <span>{tx.status[o.status] ?? o.status}</span>
                )}
                <span className="tabular">
                  {fiMoney(o.total)}, {at(o.atText)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-auto pt-10">
        {note && (
          <p role="status" className="mb-3 text-[1rem]">
            {"message" in note ? note.message : tx.notNeeded(note.status)}
          </p>
        )}
        <Link href="/call" className={`mb-3 ${bigButton("go")}`}>
          {tx.call}
        </Link>
        <button className={`${bigButton("secondary")} min-h-14 text-[1.02rem]`} disabled={asking} onClick={() => void askAgent()}>
          {asking ? tx.asking : tx.demoAsk}
        </button>
        <p className="mt-3 text-center text-[0.9rem] text-ink-soft">{tx.closesAt(at(home.expiresAtText))}</p>
      </div>
    </div>
  );
}
