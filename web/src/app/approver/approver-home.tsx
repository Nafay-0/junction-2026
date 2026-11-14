"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "../_client/api";
import { useDockEvents } from "../_client/use-dock-events";
import { useLang } from "../_i18n/provider";
import { fiMoney } from "../_ui/plain";
import { BellRing, ChevronRight, Clock, Phone, QrCode, Sparkles, Store, WifiOff } from "lucide-react";
import { Avatar, Badge, Card, IconDisc, ListRow, Spinner } from "../_ui/kit";
import { PhoneNotice, PhoneSkeleton, bigButton } from "../_ui/phone";
import { Target } from "../_ui/target";
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

const POLL_MS = 5000;
const OPENED_KEY = "dock.approver.opened";

function openedIds(): string[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
/** Kept in memory as well, so a browser without session storage (private mode) still opens each request only once. */
const openedHere = new Set<string>();
const wasOpened = (approvalId: string) => openedHere.has(approvalId) || openedIds().includes(approvalId);
function markOpened(approvalId: string): void {
  openedHere.add(approvalId);
  try {
    sessionStorage.setItem(OPENED_KEY, JSON.stringify([...openedIds().filter((id) => id !== approvalId), approvalId].slice(-50)));
  } catch {
    // private mode: remembered for this page only
  }
}

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
        markOpened(e.approvalId);
        navigator.vibrate?.([120, 60, 120]);
        router.push(`/approve/${e.approvalId}`);
        return;
      }
      void refresh();
    },
    () => void refresh(),
  );

  // The live stream is the fast path, not the only one: some venue networks buffer or block it, and then nothing
  // would ever open on this phone. So the page also asks again every few seconds while it is in front.
  useEffect(() => {
    if (state !== "ready") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, refresh]);

  // A request this phone has not opened yet opens by itself, once, however the page learnt of it. Going back
  // from the sign-off screen does not reopen it; it stays in the list below.
  useEffect(() => {
    const next = home?.pending.find((p) => !wasOpened(p.approvalId));
    if (!next) return;
    markOpened(next.approvalId);
    navigator.vibrate?.([120, 60, 120]);
    router.push(`/approve/${next.approvalId}`);
  }, [home, router]);

  async function askAgent() {
    setAsking(true);
    setNote(null);
    const r = await api<{ order: { status: string; approvalId?: string } }>("POST", "/api/v1/approver/demo-order");
    setAsking(false);
    if (!r.ok) return setNote({ message: r.error.message });
    if (r.data.order.status !== "pending_approval") setNote({ status: r.data.order.status });
    // a pending order arrives through the live event and opens the sign-off screen
  }

  if (state === "loading") return <PhoneSkeleton label={tx.loading} />;
  if (state === "not_joined")
    return (
      <PhoneNotice
        title={tx.notJoined}
        body={tx.notJoinedBody}
        mark={
          <IconDisc size={60}>
            <QrCode size={28} />
          </IconDisc>
        }
      >
        <Link href="/join" className={`mt-auto ${bigButton("go")}`}>
          {tx.join}
        </Link>
      </PhoneNotice>
    );
  if (state === "offline" || !home)
    return (
      <PhoneNotice
        title={tx.offline}
        body={tx.offlineBody}
        mark={
          <IconDisc tone="muted" size={60}>
            <WifiOff size={26} />
          </IconDisc>
        }
      >
        <button className={`mt-auto ${bigButton("dark")}`} onClick={() => void refresh()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-4">
        <Avatar name={home.approver.name} size={56} />
        <div className="min-w-0">
          <p className="text-[0.92rem] text-ink-soft">{tx.youAre}</p>
          <h1 className="display text-[2rem] leading-[1.05] text-ink [overflow-wrap:break-word]">{home.approver.name}</h1>
        </div>
      </div>
      <p className="mt-3 text-[1.02rem] leading-snug">
        {serverRole(home.approver.roleLabel, lang)}, {home.kitchen.name}
      </p>

      <Card className="mt-5">
        <div className="flex gap-3.5 p-4">
          <IconDisc tone="agent" size={40}>
            <Sparkles size={19} />
          </IconDisc>
          <p className="min-w-0 text-[0.98rem] leading-snug">{tx.agentIntro(<strong className="font-semibold">{home.agent.name}</strong>, <strong className="font-semibold tabular">{fiMoney(home.agent.perOrderLimit)}</strong>)}</p>
        </div>
        {!home.approver.passkey && <p className="border-t border-dashed border-line-strong bg-mist/70 px-4 py-3 text-[0.92rem] font-medium leading-snug">{tx.noPasskey}</p>}
        {/* /k/mine is a redirect route, not a page: a plain link does the full navigation it needs. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/k/mine" className="flex min-h-13 items-center gap-3 border-t border-line px-4 py-3 font-semibold text-petrol transition-colors duration-150 hover:bg-mist">
          <Store aria-hidden size={19} />
          <span className="flex-1">{tx.openShop}</span>
          <ChevronRight aria-hidden size={18} className="text-ink-faint" />
        </a>
      </Card>

      {home.pending.length > 0 ? (
        <section aria-labelledby="waiting" className="mt-8">
          <h2 id="waiting" className="display text-[1.45rem]">
            {tx.waitingForYou}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {home.pending.map((p) => (
              <li key={p.approvalId}>
                <Link href={`/approve/${p.approvalId}`} className="hazard-frame on-dark flex min-h-18 items-center gap-3.5 px-4 pb-3 pt-3.5 text-paper transition-[filter] hover:brightness-110">
                  <Target size={30} tone="safety" />
                  <span className="min-w-0 flex-1">
                    <span className="display block text-[1.6rem] leading-none text-safety tabular">{fiMoney(p.total)}</span>
                    <span className="mt-1 block text-[0.9rem] text-paper/75">{tx.since(at(p.requestedAtText))}</span>
                  </span>
                  <ChevronRight aria-hidden size={22} className="shrink-0 text-paper/70" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-10 flex flex-col items-center text-center" aria-live="polite">
          <span className="relative">
            <IconDisc size={64}>
              <BellRing size={28} />
            </IconDisc>
            <span aria-hidden className="breathe absolute right-0.5 top-0.5 size-3.5 rounded-full bg-lime ring-[3px] ring-mist" />
          </span>
          <p className="display mt-4 text-[1.6rem] leading-tight">{tx.waitingRequests}</p>
          <p className="mt-1.5 max-w-[30ch] text-[0.95rem] leading-snug text-ink-soft">{tx.keepOpen}</p>
        </div>
      )}

      {home.recent.length > 0 && (
        <section aria-labelledby="earlier" className="mt-9">
          <h2 id="earlier" className="text-[0.92rem] font-medium text-ink-soft">
            {tx.earlier}
          </h2>
          <Card className="mt-2">
            <ul className="divide-y divide-line">
              {home.recent.map((o, i) => (
                <li key={o.approvalId ?? i}>
                  <ListRow
                    href={o.approvalId ? `/approve/${o.approvalId}` : undefined}
                    className="px-4"
                    title={<span className="tabular">{fiMoney(o.total)}</span>}
                    sub={at(o.atText)}
                    trailing={
                      <span className="flex items-center gap-1.5">
                        <Badge tone={o.status === "committed" ? "good" : o.status === "rejected" ? "refused" : "neutral"}>{tx.status[o.status] ?? o.status}</Badge>
                        {o.approvalId && <ChevronRight aria-hidden size={17} className="text-ink-faint" />}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <div className="mt-auto pt-10">
        {note && (
          <p role="status" className="mb-3 rounded-lg bg-surface px-4 py-3 text-[0.95rem] leading-snug">
            {"message" in note ? note.message : tx.notNeeded(note.status)}
          </p>
        )}
        <Link href="/call" className={`mb-2.5 ${bigButton("go")}`}>
          <Phone aria-hidden size={19} />
          {tx.call}
        </Link>
        <button className={bigButton("secondary")} disabled={asking} onClick={() => void askAgent()}>
          {asking && <Spinner size={16} />}
          {asking ? tx.asking : tx.demoAsk}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[0.86rem] text-ink-soft">
          <Clock aria-hidden size={14} />
          {tx.closesAt(at(home.expiresAtText))}
        </p>
      </div>
    </div>
  );
}
