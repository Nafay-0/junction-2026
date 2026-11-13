"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../_client/api";
import { useLive } from "../_client/use-live";
import { RULE_TITLE, ago, clockSeconds, eur } from "../_ui/plain";
import { Target } from "../_ui/target";
import type { FeedItem, WallSnapshot } from "@/server/wall-snapshot";

/**
 * The wall: the big screen at the table, read from three metres. Dark steel, chalk type, and safety yellow only
 * where a person must decide or the gate refused. Starts from a server-rendered snapshot, so it is never empty,
 * then follows the event stream (with polling underneath, see use-live.ts).
 */
const TRACK = ["Asked", "Checked", "Priced", "Gate", "Signed"];
const CHECKS = Object.entries(RULE_TITLE)
  .filter(([k]) => !["live_lookup_limit", "quote_availability", "quote_signature", "mandate_signature", "approver_identity"].includes(k))
  .map(([, v]) => v);

export function Wall({ initial, join }: { initial: WallSnapshot; join: { url: string; qrSvg: string } }) {
  const live = useLive(
    async () => {
      const r = await api<WallSnapshot>("GET", "/ui-api/wall");
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    { events: "/api/v1/events", pollMs: 1000, pollMsStreaming: 1500 },
  );
  const snap = live.data ?? initial;
  const now = useClock();
  const c = snap.counters;
  const t = now?.getTime() ?? Date.parse(snap.at); // server time until the clock starts, so hydration matches

  return (
    <div className="on-steel flex min-h-dvh flex-col bg-steel text-chalk lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-[2vw] gap-y-2 border-b-[3px] border-chalk px-[2.2vw] py-[1.2vh]">
        <div className="flex items-center gap-3">
          <Target size={56} tone="chalk" />
          <span className="font-display text-[clamp(2.4rem,3.4vw,4.2rem)] font-bold leading-none tracking-tight">Dock</span>
        </div>
        <p className="min-w-0 flex-1 font-display text-[clamp(1.2rem,1.7vw,2.1rem)] font-semibold leading-tight text-chalk-soft">
          The loading dock for AI buyers. Plain code checks every order; above the limit, a person signs off.
        </p>
        <div className="flex items-center gap-[1.5vw]">
          <p className="flex items-center gap-2 text-[clamp(1rem,1.15vw,1.4rem)] font-semibold" title={snap.chain.ok ? "Every ledger entry links to the one before it" : "The ledger chain is broken"}>
            <Target size={26} tone={snap.chain.ok ? "chalk" : "safety"} className={snap.chain.ok ? "spin-slow" : ""} />
            {snap.chain.ok ? `Ledger intact, ${snap.chain.length.toLocaleString("en-US")} entries` : "Ledger chain broken"}
          </p>
          <p className="w-[6.2em] text-right font-display text-[clamp(1.6rem,2.2vw,2.8rem)] font-bold leading-none tabular" aria-label="Helsinki time">
            {now ? clockSeconds(now) : clockSeconds(snap.at)}
          </p>
        </div>
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 border-b-[3px] border-chalk sm:grid-cols-3 lg:grid-cols-5">
        <Counter n={c.orders} label="Orders signed" />
        <Counter n={c.agentAlone} label="Decided by the agent alone" />
        <Counter n={c.humanSignedOff} label="Signed off by a person" safetyDot={c.waiting > 0} sub={c.waiting > 0 ? `${c.waiting} waiting now` : undefined} />
        <Counter n={c.refused} label="Refused by the gate" safety />
        <Counter n={c.liveCalls} label="Live price calls to the wholesaler" />
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(22rem,27vw,34rem)]">
        <section aria-labelledby="feed" className="flex min-h-0 flex-col px-[2.2vw] py-[2vh]">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="feed" className="font-display text-[clamp(1.6rem,2vw,2.6rem)] font-bold">
              Requests at the gate
            </h2>
            <p className="text-[clamp(1rem,1.1vw,1.35rem)] text-chalk-soft">{live.error ? "Reconnecting to Dock…" : snap.lastActivityAt ? `Last activity ${ago(snap.lastActivityAt, t)}` : "Waiting for the first request"}</p>
          </div>
          {snap.feed.length === 0 ? <Idle /> : <Feed items={snap.feed} now={t} />}
          {snap.feed.length > 0 && snap.feed.length < 4 && <Legend />}
        </section>

        <aside className="flex min-h-0 flex-col gap-[2vh] border-t-[3px] border-chalk bg-steel-2 px-[1.6vw] py-[2vh] lg:border-l-[3px] lg:border-t-0">
          <JoinPanel join={join} kitchens={snap.kitchens} />
          <Refusals items={snap.refusals} now={t} />
        </aside>
      </div>

      <Ticker />
    </div>
  );
}

function useClock(): Date | undefined {
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    queueMicrotask(() => setNow(new Date()));
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Counter({ n, label, safety, safetyDot, sub }: { n: number; label: string; safety?: boolean; safetyDot?: boolean; sub?: string }) {
  const fresh = useFresh();
  return (
    <div className={`relative border-chalk/25 px-[2.2vw] py-[1.6vh] [&:not(:last-child)]:border-r ${safety && n > 0 ? "bg-safety text-safety-ink" : ""}`}>
      <p key={n} className={`${fresh ? "arrive" : ""} font-display text-[clamp(4rem,7vw,8.5rem)] font-bold leading-[0.9] tracking-tight tabular`}>
        {n.toLocaleString("en-US")}
      </p>
      <p className={`mt-1 text-[clamp(1.05rem,1.25vw,1.55rem)] font-semibold leading-tight ${safety && n > 0 ? "" : "text-chalk-soft"}`}>{label}</p>
      {sub && (
        <p className="mt-1 inline-flex items-center gap-2 bg-safety px-2 py-0.5 text-[clamp(0.95rem,1.05vw,1.3rem)] font-bold text-safety-ink">
          {safetyDot && <span aria-hidden className="size-2.5 rounded-full bg-safety-ink" />}
          {sub}
        </p>
      )}
    </div>
  );
}

function Feed({ items, now }: { items: FeedItem[]; now: number }) {
  const fresh = useFresh();
  return (
    <ol className="mt-[1.4vh] min-h-0 shrink divide-y divide-chalk/15 overflow-hidden border-t border-chalk/30">
      {items.map((it) => (
        <li
          key={`${it.key}-${it.status}`}
          className={`${fresh ? "arrive" : ""} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[1.6vw] gap-y-[0.3vh] py-[1.1vh] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.25fr)]`}
        >
          <p className="truncate text-[clamp(1.15rem,1.45vw,1.8rem)] font-bold leading-tight">{it.kitchen}</p>
          <Track reached={it.reached} tone={it.tone} />
          <p className="col-span-2 xl:col-span-1">
            <span className={`inline-block max-w-full truncate align-bottom text-[clamp(1.15rem,1.45vw,1.8rem)] font-semibold leading-tight ${it.tone === "safety" ? "bg-safety px-2 text-safety-ink" : ""}`}>{it.status}</span>
          </p>
          <p className="col-span-2 truncate text-[clamp(0.98rem,1.15vw,1.4rem)] text-chalk-soft xl:col-span-3">
            {it.what}
            <span className="tabular">
              {it.totalCents !== undefined ? `, ${eur(it.totalCents)}` : ""}, {ago(it.at, now)}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
}

/** False on the first render, so rows and counters only flash when they change, not when the wall loads. */
function useFresh(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFresh(true), 1500);
    return () => clearTimeout(t);
  }, []);
  return fresh;
}

/** Five stations from request to signed order. Reached ones fill; where a person must act, the station is yellow. */
function Track({ reached, tone }: { reached: number; tone: FeedItem["tone"] }) {
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`At ${TRACK[Math.max(0, reached - 1)]}, step ${reached} of ${TRACK.length}`}>
      {TRACK.map((t, i) => {
        const on = i < reached;
        const here = i === reached - 1;
        const cls = here && tone === "safety" ? "bg-safety" : on ? "bg-chalk" : "border-2 border-chalk/35";
        return <span key={t} title={t} className={`h-[clamp(0.7rem,1vw,1.1rem)] w-[clamp(1.6rem,2.4vw,3rem)] ${cls}`} />;
      })}
    </div>
  );
}

function Idle() {
  return (
    <div className="mt-[2vh] grid flex-1 content-start gap-[2vh] border-t border-chalk/30 pt-[2vh]">
      <p className="max-w-[38ch] font-display text-[clamp(2rem,3vw,3.6rem)] font-bold leading-[1.05]">No request has pulled up yet. Scan the code to become an approver, then let an agent try to buy.</p>
      <p className="max-w-[60ch] text-[clamp(1.1rem,1.4vw,1.7rem)] leading-snug text-chalk-soft">
        Every agent shows a mandate its kitchen signed. Dock fixes a price with the wholesaler, then plain code checks the order. Inside the mandate, the agent buys alone. Above it, a named person signs off on their phone. Outside it, the order is refused, with the rule that refused it.
      </p>
      <Legend />
      <p className="text-[clamp(1.05rem,1.2vw,1.5rem)]">
        Or open the buyer console:{" "}
        <Link href="/k/kaari" className="font-semibold underline decoration-2 underline-offset-4">
          Ravintola Kaari
        </Link>
      </p>
    </div>
  );
}

/** How to read a row: the five stations, and what yellow means. */
function Legend() {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-[1.2vw] gap-y-2 pt-[2vh] text-[clamp(1rem,1.15vw,1.4rem)] text-chalk-soft">
      <span>Each request moves along five stations:</span>
      {TRACK.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-2">
          <span className={`inline-block h-[0.8em] w-[1.8em] ${i < 4 ? "bg-chalk" : "border-2 border-chalk/35"}`} />
          {t}
        </span>
      ))}
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-[0.8em] w-[1.8em] bg-safety" />a person must act, or refused
      </span>
    </div>
  );
}

function JoinPanel({ join, kitchens }: { join: { url: string; qrSvg: string }; kitchens: WallSnapshot["kitchens"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function start(slug: string) {
    setBusy(slug);
    await api("POST", `/api/v1/sandboxes/${encodeURIComponent(slug)}/demo-order`);
    setBusy(null);
  }
  return (
    <section aria-labelledby="join">
      {/* JOIN QR: the code a visitor scans to get their own kitchen and become its approver (see /join). */}
      <h2 id="join" className="font-display text-[clamp(1.6rem,2.1vw,2.7rem)] font-bold leading-[1.02]">
        Scan to become the approver
      </h2>
      <div className="mt-[1vh] flex items-start gap-[1.2vw]">
        <figure aria-label={`QR code for ${join.url}`} className="w-[clamp(9rem,12.5vw,16rem)] shrink-0 bg-paper p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: join.qrSvg }} />
        <div className="min-w-0">
          <p className="text-[clamp(1rem,1.2vw,1.45rem)] leading-snug">You get a hotel kitchen of your own. Its agent asks you, on your phone, when it wants to go over its limit.</p>
          <p className="mt-[1vh] break-all text-[clamp(0.9rem,0.95vw,1.15rem)] text-chalk-soft">{join.url.replace(/^https?:\/\//, "")}</p>
        </div>
      </div>
      {kitchens.length > 0 && (
        <div className="mt-[1.4vh]">
          <h3 className="text-[clamp(1rem,1.1vw,1.35rem)] font-semibold">Kitchens here now: {kitchens.length}</h3>
          <ul className="mt-1 divide-y divide-chalk/15">
            {kitchens.slice(0, 3).map((k) => (
              <li key={k.slug} className="flex items-center justify-between gap-2 py-1 text-[clamp(0.95rem,1.05vw,1.3rem)]">
                <span className="min-w-0 truncate">
                  {k.name}, <span className="text-chalk-soft">{k.approverName}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Link href={`/k/${k.slug}`} className="border-2 border-chalk/60 px-2 py-0.5 font-semibold hover:border-chalk">
                    Console
                  </Link>
                  <button type="button" disabled={busy === k.slug} onClick={() => void start(k.slug)} className="border-2 border-chalk/60 px-2 py-0.5 font-semibold hover:border-chalk disabled:opacity-50">
                    {busy === k.slug ? "Starting…" : "Run 1,000 L"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Refusals({ items, now }: { items: WallSnapshot["refusals"]; now: number }) {
  return (
    <section aria-labelledby="refused" className="flex min-h-0 flex-1 flex-col">
      <h2 id="refused" className="flex items-center gap-2 font-display text-[clamp(1.5rem,1.9vw,2.4rem)] font-bold">
        <Target size={34} tone="safety" /> Refused, and why
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-[clamp(1rem,1.2vw,1.5rem)] leading-snug text-chalk-soft">Nothing refused yet. Ask an agent for more than its budget, a product with a forbidden allergen, or to reuse a quote, and the reason appears here.</p>
      ) : (
        <ol className="mt-2 min-h-0 space-y-[1.2vh] overflow-hidden">
          {items.slice(0, 3).map((r) => (
            <li key={r.key}>
              <p className="bg-safety px-2 py-1 text-[clamp(1.05rem,1.3vw,1.6rem)] font-bold leading-tight text-safety-ink">{r.rule}</p>
              <p className="mt-0.5 line-clamp-2 text-[clamp(0.98rem,1.1vw,1.35rem)] leading-snug">{r.reason}</p>
              <p className="text-[clamp(0.9rem,1vw,1.2rem)] text-chalk-soft">
                {r.kitchen}, {ago(r.at, now)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The bottom line: one of the gate's checks at a time, so even an idle wall says what it does. */
function Ticker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % CHECKS.length), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <footer className="flex items-center gap-[1.2vw] border-t-[3px] border-chalk bg-steel px-[2.2vw] py-[1vh]">
      <Target size={26} tone="chalk" className="shrink-0" />
      <p className="truncate text-[clamp(1.05rem,1.3vw,1.6rem)]">
        <span className="text-chalk-soft">Checked on every order, by code, not by the model: </span>
        <span key={i} className="font-semibold">
          {CHECKS[i]}
        </span>
      </p>
      <span className="ml-auto shrink-0 text-[clamp(0.95rem,1.05vw,1.3rem)] text-chalk-soft tabular">
        {i + 1} of {CHECKS.length}
      </span>
    </footer>
  );
}
