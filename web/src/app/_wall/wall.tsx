"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../_client/api";
import { useLive } from "../_client/use-live";
import { DEMO_NOTE, PRODUCT_NAME } from "../_ui/brand";
import { RULE_TITLE, ago, clockSeconds, fiMoney, money } from "../_ui/plain";
import { Target } from "../_ui/target";
import type { FeedItem, WallSnapshot } from "@/server/wall-snapshot";
import type { Board } from "./crash-board";
import { CrashMatrix } from "./crash-matrix";
import "./wall.css";

/**
 * The wall: the big screen at the table, read from three metres by people walking past. Its one bold thing is the
 * gate itself: every live request is a lane running across the screen through the same hazard-striped gate post,
 * so "every agent passes the same gate" is a picture. A request that passes runs on to its stamp; one that is
 * stopped halts at the post with the rule's name. When nothing moves, the post keeps reading out its checks.
 *
 * Petrol-deep ground and paper type from the shared system; lime only on the scan panel (the one thing to do);
 * yellow and black only at the gate. Starts from a server-rendered snapshot, then follows the event stream.
 */
const CHECKS = Object.entries(RULE_TITLE)
  .filter(([k]) => !["live_lookup_limit", "quote_availability", "quote_signature", "mandate_signature", "approver_identity", "operator_suspension"].includes(k))
  .map(([, v]) => v);

const PRE_GATE = ["Asked", "Priced", "Price fixed"];
const LANES = 5;

export function Wall({ initial, join, board }: { initial: WallSnapshot; join: { url: string; qrSvg: string }; board: Board }) {
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
  const justRefused = useJustRefused(snap.refusals[0]?.key, 9000);

  return (
    <div className="on-dark flex min-h-dvh flex-col bg-petrol-deep text-paper lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(22rem,25vw)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      {/* ---------- header ---------- */}
      <header className="order-1 flex flex-wrap lg:order-none items-center gap-x-[2vw] gap-y-2 border-b-2 border-paper/20 px-[2vw] py-[1.4vh] lg:col-span-2">
        <div className="flex items-center gap-[0.8vw]">
          <Target size={52} tone="chalk" className="h-[max(2.4rem,3vw)] w-auto" />
          <span className="display text-[max(2.4rem,3.3vw)] leading-none">{PRODUCT_NAME}</span>
        </div>
        <p className="min-w-0 flex-1 text-[max(1.05rem,1.35vw)] font-medium leading-tight text-paper/85">
          The open loading dock for AI buyers. <span className="text-paper">Plain code checks every order; above the limit, a named person signs off.</span>
        </p>
        <div className="flex items-center gap-[1.6vw] text-[max(0.95rem,0.95vw)]">
          {snap.catalogue.kind === "valio" && <p className="hidden xl:block">Valio Aimo catalogue, {snap.catalogue.products.toLocaleString("fi-FI")} products</p>}
          <p className="flex items-center gap-2" title={snap.chain.ok ? "Every ledger entry links to the one before it" : "The ledger chain is broken"}>
            <Target size={22} tone={snap.chain.ok ? "chalk" : "safety"} />
            {snap.chain.ok ? `Ledger intact, ${snap.chain.length.toLocaleString("fi-FI")} entries` : "Ledger chain broken"}
          </p>
          <p className="display w-[5.4em] text-right text-[max(1.8rem,2.3vw)] leading-none tabular" aria-label="Helsinki time">
            {now ? clockSeconds(now) : clockSeconds(snap.at)}
          </p>
        </div>
      </header>

      {/* ---------- left: the gate, the counts, refusals and the crash test ---------- */}
      <div className="order-3 flex min-h-0 flex-col lg:order-none">
        <GateLanes feed={snap.feed} now={t} justRefused={justRefused ? snap.refusals[0] : undefined} lastAt={snap.lastActivityAt} error={live.error} />
        <Counters c={c} />
        <div className="grid min-h-0 border-t-2 border-paper/20 lg:h-[37vh] lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.6fr)]">
          <Refusals items={snap.refusals} now={t} fresh={justRefused} />
          <CrashBoard board={board} />
        </div>
      </div>

      {/* ---------- right: the one thing to do ---------- */}
      <aside className="order-2 flex min-h-0 flex-col border-t-2 lg:order-none border-paper/20 bg-petrol lg:border-l-2 lg:border-t-0">
        <JoinPanel join={join} kitchens={snap.kitchens} />
        <p className="mt-auto px-[1.6vw] pb-[1.6vh] pt-[1vh] text-[max(0.82rem,0.72vw)] leading-snug text-paper/70">{DEMO_NOTE}</p>
      </aside>
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

/** True for a while after a refusal arrives that was not there when the wall loaded. */
function useJustRefused(key: string | undefined, ms: number): boolean {
  const first = useRef(key);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!key || key === first.current) return;
    first.current = key;
    queueMicrotask(() => setOn(true));
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}

/** False on the first render, so rows only wash when they change, not when the wall loads. */
function useFresh(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFresh(true), 1500);
    return () => clearTimeout(t);
  }, []);
  return fresh;
}

// ---------- the gate lanes: the wall's one bold thing ----------

/** The rule the gate reads out, one at a time: the idle wall still says what the gate does. */
function useReadout(): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % CHECKS.length), 3200);
    return () => clearInterval(t);
  }, []);
  return i;
}

/** Where a request's marker sits before the gate: the middle of its station, or against the post. */
function markerAt(reached: number): number {
  if (reached >= 4) return 100;
  return ((Math.max(1, reached) - 0.5) / PRE_GATE.length) * 100;
}

function GateLanes({ feed, now, justRefused, lastAt, error }: { feed: FeedItem[]; now: number; justRefused?: WallSnapshot["refusals"][number]; lastAt?: string; error?: string }) {
  const i = useReadout();
  const fresh = useFresh();
  const rows = feed.slice(0, LANES);
  const ghosts = Math.max(0, (rows.length ? 0 : 3) + Math.max(0, 3 - rows.length));
  // Columns: who | three stations before the gate | the gate post | the outcome.
  const cols = "lg:grid-cols-[minmax(0,15fr)_minmax(0,27fr)_minmax(3.4rem,4.4vw)_minmax(0,34fr)]";
  return (
    <section aria-labelledby="gate-title" className="relative flex min-h-[60vh] flex-1 flex-col px-[2vw] pb-[1.6vh] pt-[1.8vh] lg:min-h-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-[2vw] gap-y-1">
        <h2 id="gate-title" className="display text-[max(1.6rem,2vw)] leading-none">
          Requests at the gate
        </h2>
        {/* The readout: the rule the gate reads now, or the rule that just refused something. */}
        <p className="min-w-0 text-[max(1rem,1.1vw)] leading-tight" aria-live="polite">
          {justRefused ? (
            <span key={justRefused.key} className={`wall-rule inline-flex max-w-full items-center gap-2 bg-safety-ink px-2 py-1 font-bold text-safety`}>
              <Target size={20} tone="safety" />
              <span className="truncate">Refused just now: {justRefused.rule}</span>
            </span>
          ) : (
            <>
              <span className="text-paper/70">The gate checks every order: </span>
              <span key={i} className={`wall-rule inline-block font-semibold`}>
                {CHECKS[i]}
              </span>
            </>
          )}
        </p>
      </div>
      <div aria-hidden className={`mt-[1vh] hidden gap-x-[1.2vw] text-[max(0.95rem,0.95vw)] font-semibold text-paper/70 lg:grid ${cols}`}>
        <span />
        <span className="grid grid-cols-3">
          {PRE_GATE.map((s) => (
            <span key={s} className="text-center">
              {s}
            </span>
          ))}
        </span>
        <span className="text-center font-bold text-safety">Gate</span>
        <span>Outcome</span>
      </div>

      <div className="relative mt-[0.6vh] flex min-h-0 flex-1 flex-col">
        {/* The post: one structure every lane runs through. */}
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 hidden lg:grid ${cols} left-0 right-0 gap-x-[1.2vw]`}>
          <span />
          <span />
          <span className={`hazard wall-post wall-scan border-x-[3px] border-safety-ink`} />
          <span />
        </div>
        {justRefused && (
          <div aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 right-0 hidden lg:grid ${cols} gap-x-[1.2vw]`}>
            <span />
            <span className="relative overflow-hidden">
              <span className={`wall-arm-left absolute right-0 top-1/2 h-[1.4vh] w-1/2 -translate-y-1/2 hazard-thin`} />
            </span>
            <span />
            <span className="relative overflow-hidden">
              <span className={`wall-arm-right absolute left-0 top-1/2 h-[1.4vh] w-1/3 -translate-y-1/2 hazard-thin`} />
            </span>
          </div>
        )}

        {rows.length === 0 && (
          <div className="pointer-events-none absolute left-0 top-[8%] z-10 max-w-[44%] lg:left-0">
            <p className="display text-[max(2rem,3vw)] leading-[1.02]">No request has pulled up yet.</p>
            <p className="mt-[1.2vh] max-w-[40ch] text-[max(1.05rem,1.3vw)] leading-snug text-paper/85">
              Scan the code to become an approver, then let an agent try to buy. Inside its mandate it buys alone; above it, you sign off; outside it, the gate says no and names the rule.
            </p>
          </div>
        )}

        <ol className="relative flex min-h-0 flex-1 flex-col">
          {rows.map((it) => (
            <Lane key={it.key} it={it} now={now} cols={cols} fresh={fresh} />
          ))}
          {Array.from({ length: rows.length ? Math.min(ghosts, LANES - rows.length) : 4 }, (_, k) => (
            <li key={`ghost-${k}`} aria-hidden className={`grid min-h-0 flex-1 items-center gap-x-[1.2vw] border-t border-paper/10 ${cols}`}>
              <span />
              <span className="hidden h-[3px] bg-paper/10 lg:block" />
              <span />
              <span />
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-[0.8vh] text-[max(0.9rem,0.85vw)] text-paper/65">
        {error ? "Reconnecting to Dock…" : lastAt ? `Last activity ${ago(lastAt, now)}. ` : ""}
        Each lane is one request; the marker shows how far it got. Yellow means a person must decide; black means the gate refused.
      </p>
    </section>
  );
}

function Lane({ it, now, cols, fresh }: { it: FeedItem; now: number; cols: string; fresh: boolean }) {
  const at = markerAt(it.reached);
  const stopped = it.tone === "safety" && /^(Refused|Declined)/.test(it.status);
  const waiting = it.tone === "safety" && !stopped;
  const passed = it.tone === "done";
  const marker = stopped ? "bg-safety-ink ring-[3px] ring-safety" : waiting ? "bg-safety ring-[3px] ring-safety-ink" : "bg-paper";
  return (
    <li className={`${fresh ? "wall-moved" : ""} grid min-h-0 flex-1 [@media(max-height:820px)]:[&:nth-child(n+5)]:hidden grid-cols-1 items-center gap-x-[1.2vw] gap-y-1 border-t border-paper/15 py-[0.6vh] ${cols}`} key={`${it.key}-${it.status}`}>
      <div className="min-w-0">
        <p className="truncate text-[max(1.15rem,1.4vw)] font-bold leading-tight">{it.kitchen}</p>
        <p className="truncate text-[max(0.92rem,1vw)] leading-tight text-paper/70 [@media(max-height:820px)]:hidden">
          {fiMoney(it.what)}
          {it.totalCents !== undefined ? `, ${money(it.totalCents)}` : ""}
        </p>
      </div>
      {/* the track before the gate */}
      <div className="relative order-3 h-[max(1.4rem,2.2vh)] lg:order-none" role="img" aria-label={`Reached ${it.reached >= 4 ? "the gate" : PRE_GATE[Math.max(0, it.reached - 1)]}`}>
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-paper/15" />
        <span aria-hidden className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-paper/80" style={{ width: `${at}%` }} />
        {PRE_GATE.map((s, k) => (
          <span key={s} aria-hidden className="absolute top-1/2 size-[0.7vw] min-h-2 min-w-2 -translate-x-1/2 -translate-y-1/2 border-2 border-paper/40 bg-petrol-deep" style={{ left: `${((k + 0.5) / PRE_GATE.length) * 100}%` }} />
        ))}
        <span aria-hidden className={`wall-marker absolute top-1/2 h-[max(1.2rem,2vh)] w-[max(1.6rem,1.9vw)] -translate-y-1/2 ${marker}`} style={{ left: `calc(${at}% - ${at >= 100 ? "max(1.6rem,1.9vw)" : "max(0.8rem,0.95vw)"})` }} />
      </div>
      {/* through the post: only a request that passed */}
      <div aria-hidden className="relative hidden h-full lg:block">{passed && <span className="absolute inset-x-0 top-1/2 h-[max(0.5rem,0.9vh)] -translate-y-1/2 bg-paper" />}</div>
      {/* the outcome */}
      <div className="flex min-w-0 items-center gap-[0.8vw]">
        {passed && <span aria-hidden className="hidden h-[3px] w-[1.5vw] shrink-0 bg-paper lg:block" />}
        <p
          className={`min-w-0 truncate text-[max(1.1rem,1.35vw)] font-semibold leading-tight ${
            stopped ? "bg-safety-ink px-2 py-0.5 text-safety" : waiting ? "bg-safety px-2 py-0.5 text-safety-ink" : passed ? "border-2 border-paper px-2 py-0.5" : "text-paper/80"
          }`}
        >
          {fiMoney(it.status)}
        </p>
        <span className="hidden shrink-0 text-[max(0.85rem,0.85vw)] text-paper/60 tabular xl:inline">{ago(it.at, now)}</span>
      </div>
    </li>
  );
}

// ---------- counts ----------

function Counters({ c }: { c: WallSnapshot["counters"] }) {
  const cells: { n: number; label: string; tone?: "gate" | "person" }[] = [
    { n: c.orders, label: "Orders signed" },
    { n: c.agentAlone, label: "Bought by the agent alone" },
    { n: c.humanSignedOff, label: "Signed off by a person", tone: c.waiting > 0 ? "person" : undefined },
    { n: c.refused, label: "Refused by the gate", tone: "gate" },
    { n: c.liveCalls, label: "Live price calls to the wholesaler" },
  ];
  return (
    <section aria-label="Totals" className="grid grid-cols-2 border-t-2 border-paper/20 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((x) => (
        <div key={x.label} className="min-w-0 border-paper/15 px-[2vw] py-[0.8vh] [&:not(:last-child)]:border-r">
          <p key={x.n} className={`display text-[max(2.6rem,3.1vw)] leading-[0.92] tabular ${x.tone === "gate" && x.n > 0 ? "text-safety" : ""}`}>
            {x.n.toLocaleString("fi-FI")}
          </p>
          <p className="mt-[0.3vh] text-[max(0.92rem,0.92vw)] font-semibold leading-tight text-paper/80">{x.label}</p>
          {x.tone === "person" && (
            <p className="mt-[0.5vh] inline-flex items-center gap-2 bg-safety px-2 py-0.5 text-[max(0.9rem,0.9vw)] font-bold text-safety-ink">
              <span aria-hidden className="breathe size-2 bg-safety-ink" />
              {c.waiting} waiting now
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------- refused, and why ----------

function Refusals({ items, now, fresh }: { items: WallSnapshot["refusals"]; now: number; fresh: boolean }) {
  return (
    <section aria-labelledby="refused" className="flex min-h-0 flex-col overflow-hidden px-[2vw] py-[1.6vh]">
      <h2 id="refused" className="display flex items-center gap-[0.6vw] text-[max(1.5rem,1.7vw)] leading-none">
        <Target size={30} tone="safety" className="h-[max(1.5rem,1.7vw)] w-auto" /> Refused, and why
      </h2>
      {items.length === 0 ? (
        <p className="mt-[1.2vh] max-w-[46ch] text-[max(1rem,1.1vw)] leading-snug text-paper/80">
          Nothing refused yet. Ask an agent for more than its budget, a product with a forbidden allergen, or to use a quote twice, and the reason appears here.
        </p>
      ) : (
        <ol className="mt-[1.2vh] min-h-0 space-y-[1vh] overflow-hidden">
          {items.slice(0, 3).map((r, k) => (
            <li key={r.key} className={`${k === 0 && fresh ? "wall-arm-left" : ""} lg:[&:nth-child(3)]:hidden`}>
              <p className="inline-block max-w-full truncate bg-safety-ink px-2 py-0.5 text-[max(1.05rem,1.2vw)] font-bold leading-tight text-safety">{r.rule}</p>
              <p className="mt-0.5 line-clamp-1 text-[max(0.95rem,1vw)] leading-snug">{fiMoney(r.reason)}</p>
              <p className="text-[max(0.85rem,0.85vw)] text-paper/60">
                {r.kitchen}, {ago(r.at, now)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- the crash test ----------

function CrashBoard({ board }: { board: Board }) {
  return (
    <section aria-labelledby="crash" className="flex min-h-0 flex-col overflow-hidden border-t-2 border-paper/20 px-[2vw] py-[1.4vh] lg:border-l-2 lg:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="crash" className="display flex items-center gap-[0.6vw] text-[max(1.5rem,1.7vw)] leading-none">
          <Target size={30} tone="safety" className="h-[max(1.5rem,1.7vw)] w-auto" /> Crash test
        </h2>
        <p className="text-[max(0.88rem,0.88vw)] text-paper/70">13 hard purchasing situations. The rating becomes a licence: what the model may buy alone.</p>
      </div>
      {board.rows.length === 0 ? (
        <p className="mt-[1.2vh] max-w-[56ch] text-[max(1rem,1.1vw)] leading-snug text-paper/80">
          No model has been crash-tested on this server yet. Each one is run through the same thirteen situations (litres to cases, a passed cut-off, missing allergen data, an instruction hidden in a product text) and earns a licence that sets how much it may buy alone.
        </p>
      ) : (
        <div className="mt-[0.6vh] min-h-0 overflow-hidden">
          <CrashMatrix board={board} dark big maxRows={5} yardsticks={["reference"]} legend={false} />
          {!board.rows.some((r) => !r.scripted) && (
            <p className="mt-[1vh] max-w-[60ch] text-[max(0.95rem,1vw)] leading-snug text-paper/80">No model has been rated on this server yet. The reference buyer above shows what getting through all thirteen looks like; each model run joins it here with its licence.</p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- the one thing to do ----------

function JoinPanel({ join, kitchens }: { join: { url: string; qrSvg: string }; kitchens: WallSnapshot["kitchens"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function start(slug: string) {
    setBusy(slug);
    await api("POST", `/api/v1/sandboxes/${encodeURIComponent(slug)}/demo-order`);
    setBusy(null);
  }
  return (
    <section aria-labelledby="join" className="flex min-h-0 flex-col">
      {/* JOIN QR: the code a visitor scans to get their own kitchen and become its approver (see /join). */}
      <div className="bg-lime px-[1.6vw] py-[1.4vh] text-ink">
        <h2 id="join" className="display text-[max(1.9rem,2.4vw)] leading-[0.95]">
          Scan to become the approver
        </h2>
        <p className="mt-[0.6vh] text-[max(1rem,1.05vw)] font-medium leading-snug">You get a kitchen of your own. Its agent asks you, on your phone, when it wants to go over its limit.</p>
      </div>
      <div className="px-[1.6vw] pt-[2vh]">
        <figure aria-label={`QR code for ${join.url}`} className="mx-auto w-full max-w-[min(100%,40vh)] bg-paper p-[1vw] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: join.qrSvg }} />
        <p className="mt-[1vh] break-all text-center text-[max(1rem,1.1vw)] font-semibold">{join.url.replace(/^https?:\/\//, "")}</p>
        <ol className="mt-[2vh] space-y-[0.8vh] text-[max(0.95rem,0.95vw)] leading-snug [@media(max-height:820px)]:hidden">
          {["Scan, and a kitchen of your own is set up with you as its approver.", "Ask its agent for 1 000 L of milk. That is over its limit, so the gate stops it.", "Approve or decline on your phone. The signed order lands on this screen."].map((x, k) => (
            <li key={k} className="grid grid-cols-[1.6em_minmax(0,1fr)] gap-x-2">
              <span className="display text-[1.3em] leading-none text-lime">{k + 1}</span>
              <span>{x}</span>
            </li>
          ))}
        </ol>
      </div>
      {kitchens.length > 0 && (
        <div className="mt-[2vh] px-[1.6vw]">
          <h3 className="text-[max(1rem,1vw)] font-semibold">Kitchens here now: {kitchens.length}</h3>
          <ul className="mt-1 divide-y divide-paper/15 border-t border-paper/15">
            {kitchens.slice(0, 3).map((k, i) => (
              <li key={k.slug || `${k.name}-${i}`} className="flex items-center justify-between gap-2 py-[0.6vh] text-[max(0.92rem,0.9vw)]">
                <span className="min-w-0 truncate">
                  {k.name}, <span className="text-paper/70">{k.approverName}</span>
                </span>
                {/* Only the operations desk's screen gets the kitchens' ids, and so the buttons (server/authz.ts). */}
                {k.slug && (
                  <span className="flex shrink-0 gap-2">
                    <Link href={`/k/${k.slug}`} className="border-2 border-paper/60 px-2 py-0.5 font-semibold hover:border-paper">
                      Shop
                    </Link>
                    <button type="button" disabled={busy === k.slug} onClick={() => void start(k.slug)} className="border-2 border-paper/60 px-2 py-0.5 font-semibold hover:border-paper disabled:opacity-50">
                      {busy === k.slug ? "Starting…" : "Run 1 000 L"}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
