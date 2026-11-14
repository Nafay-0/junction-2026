"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { api } from "../_client/api";
import { useLive } from "../_client/use-live";
import { DEMO_NOTE, PRODUCT_NAME } from "../_ui/brand";
import { RULE_TITLE, ago, clockSeconds, fiMoney, money } from "../_ui/plain";
import { Check, Gauge, ShieldCheck } from "lucide-react";
import { buttonClass } from "../_ui/kit";
import { Target } from "../_ui/target";
import { PilotLight } from "../_ui/wordmark";
import type { FeedItem, WallSnapshot } from "@/server/wall-snapshot";
import type { Board } from "./crash-board";
import { CrashMatrix } from "./crash-matrix";
import "./wall.css";
import { SamplePill } from "../_ui/sample";

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
    <div className="on-dark flex min-h-dvh flex-col gap-[max(0.75rem,1vw)] bg-petrol-deep p-[max(0.75rem,1vw)] text-paper lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(22rem,25vw)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      {/* ---------- header ---------- */}
      <header className="order-1 flex flex-wrap items-center gap-x-[2vw] gap-y-2 px-[0.8vw] pb-[0.4vh] pt-[0.2vh] lg:order-none lg:col-span-2">
        <div className="flex items-center gap-[0.8vw]">
          <PilotLight size="max(1.6rem,2.3vw)" onDark />
          <span className="display text-[max(2.2rem,3vw)] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>
            {PRODUCT_NAME}
          </span>
        </div>
        <p className="min-w-0 flex-1 text-[max(1.05rem,1.3vw)] font-medium leading-snug text-paper/75 max-lg:order-3 max-lg:basis-full">
          The open loading dock for AI buyers. <span className="text-paper">Plain code checks every order; above the limit, a named person signs off.</span>
        </p>
        <div className="ml-auto flex items-center gap-x-[max(0.75rem,1vw)] text-[max(0.95rem,0.95vw)] max-lg:order-2">
          {snap.catalogue.kind === "valio" && <p className="hidden text-paper/75 xl:block">Valio Aimo catalogue, {snap.catalogue.products.toLocaleString("fi-FI")} products</p>}
          <p className={`hidden items-center gap-2 rounded-full px-[0.9em] py-[0.35em] font-medium sm:inline-flex ${snap.chain.ok ? "bg-paper/10" : "bg-safety text-safety-ink"}`} title={snap.chain.ok ? "Every ledger entry links to the one before it" : "The ledger chain is broken"}>
            {snap.chain.ok ? <ShieldCheck aria-hidden className="size-[1.15em] text-lime" /> : <Target size={20} tone="safety" />}
            {snap.chain.ok ? `Ledger intact, ${snap.chain.length.toLocaleString("fi-FI")} entries` : "Ledger chain broken"}
          </p>
          <p className="display w-[5.2em] text-right text-[max(1.8rem,2.2vw)] leading-none tabular" aria-label="Helsinki time">
            {now ? clockSeconds(now) : clockSeconds(snap.at)}
          </p>
        </div>
      </header>

      {/* ---------- left: the gate, the counts, refusals and the crash test ---------- */}
      <div className="order-3 flex min-h-0 flex-col gap-[max(0.75rem,1vw)] lg:order-none">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[max(20px,1.5vw)] bg-paper/[0.045] ring-1 ring-inset ring-paper/10">
          <GateLanes feed={snap.feed} now={t} justRefused={justRefused ? snap.refusals[0] : undefined} lastAt={snap.lastActivityAt} error={live.error} />
          <Counters c={c} />
        </div>
        <div className="grid min-h-0 gap-[max(0.75rem,1vw)] lg:h-[34vh] lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1.6fr)]">
          <Refusals items={snap.refusals} now={t} fresh={justRefused} />
          <CrashBoard board={board} />
        </div>
      </div>

      {/* ---------- right: the one thing to do ---------- */}
      <aside className="order-2 flex min-h-0 flex-col overflow-hidden rounded-[max(20px,1.5vw)] bg-petrol lg:order-none">
        <JoinPanel join={join} kitchens={snap.kitchens} />
        <div className="mt-auto shrink-0 space-y-[0.8vh] px-[1.6vw] pb-[1.6vh] pt-[1vh] max-lg:px-5">
          <p className="text-[max(0.92rem,0.9vw)] leading-snug text-paper/80">
            Or bring your own agent:{" "}
            <Link href="/try" className="font-semibold text-paper underline underline-offset-2">
              try it as an outside agent
            </Link>
            .
          </p>
          <p className="text-[max(0.82rem,0.72vw)] leading-snug text-paper/70">{DEMO_NOTE}</p>
        </div>
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

/**
 * How many lanes fit the space the screen gives them, each at its full height (name, request line, outcome pill),
 * so lanes never press into each other on a short screen. Measured from the first lane; re-measured on resize.
 */
function useLanesThatFit(ref: RefObject<HTMLOListElement | null>, count: number): number {
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const ol = ref.current;
    if (!ol) return;
    const measure = () => {
      const first = ol.querySelector<HTMLElement>("li[data-lane]");
      if (!first) return setFit(count);
      const pad = parseFloat(getComputedStyle(first).paddingTop) + parseFloat(getComputedStyle(first).paddingBottom) + 2;
      // Content only: the gate-post cell is as tall as the lane itself, so it says nothing about what the lane needs.
      const need = Math.max(...[...first.children].filter((c) => !c.classList.contains("h-full")).map((c) => c.getBoundingClientRect().height)) + pad;
      setFit(Math.max(1, Math.min(count, Math.floor(ol.clientHeight / Math.max(need, 1)))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [ref, count]);
  return fit;
}

function GateLanes({ feed, now, justRefused, lastAt, error }: { feed: FeedItem[]; now: number; justRefused?: WallSnapshot["refusals"][number]; lastAt?: string; error?: string }) {
  const i = useReadout();
  const fresh = useFresh();
  const rows = feed.slice(0, LANES);
  const lanesRef = useRef<HTMLOListElement>(null);
  const fit = useLanesThatFit(lanesRef, rows.length);
  const ghosts = Math.max(0, (rows.length ? 0 : 3) + Math.max(0, 3 - rows.length));
  // Columns: who | three stations before the gate | the gate post | the outcome.
  const cols = "lg:grid-cols-[minmax(0,18fr)_minmax(0,25fr)_minmax(3.4rem,4.2vw)_minmax(0,33fr)]";
  return (
    <section aria-labelledby="gate-title" className="relative flex min-h-[60vh] flex-1 flex-col px-[1.6vw] pb-[1.2vh] pt-[1.8vh] max-lg:px-5 lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-x-[2vw] gap-y-2">
        <h2 id="gate-title" className="display text-[max(1.6rem,2vw)] leading-none">
          Requests at the gate
        </h2>
        {/* The readout: the rule the gate reads now, or the rule that just refused something. */}
        <p className="min-w-0 text-[max(1rem,1.1vw)] leading-tight" aria-live="polite">
          {justRefused ? (
            <span key={justRefused.key} className="wall-rule inline-flex max-w-full items-center gap-2 rounded-full bg-safety-ink py-[0.35em] pl-[0.5em] pr-[0.9em] font-semibold text-safety ring-1 ring-inset ring-safety/50">
              <Target size={22} tone="safety" className="size-[1.25em] shrink-0" />
              <span className="truncate">Refused just now: {justRefused.rule}</span>
            </span>
          ) : (
            <span className="inline-flex max-w-full items-center gap-[0.6em] rounded-full bg-paper/[0.07] py-[0.35em] pl-[0.5em] pr-[0.9em]">
              <Target size={22} tone="safety" className="size-[1.25em] shrink-0" />
              <span className="text-paper/70 max-sm:hidden">The gate checks every order:</span>
              <span key={i} className="wall-rule inline-block truncate font-semibold">
                {CHECKS[i]}
              </span>
            </span>
          )}
        </p>
      </div>
      <div aria-hidden className={`mt-[1.2vh] hidden gap-x-[1.2vw] text-[max(0.95rem,0.92vw)] font-medium text-paper/65 lg:grid ${cols}`}>
        <span />
        <span className="grid grid-cols-3">
          {PRE_GATE.map((s) => (
            <span key={s} className="text-center">
              {s}
            </span>
          ))}
        </span>
        <span className="text-center font-semibold text-safety">Gate</span>
        <span>Outcome</span>
      </div>

      <div className="relative mt-[0.8vh] flex min-h-0 flex-1 flex-col">
        {/* The post: one structure every lane runs through. */}
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 hidden lg:grid ${cols} left-0 right-0 gap-x-[1.2vw]`}>
          <span />
          <span />
          <span className="wall-post wall-scan hazard rounded-[max(10px,0.8vw)] shadow-[0_0_0_3px_var(--color-safety-ink),0_0_40px_-6px_rgb(255_194_14/0.35)]" />
          <span />
        </div>
        {justRefused && (
          <div aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 right-0 hidden lg:grid ${cols} gap-x-[1.2vw]`}>
            <span />
            <span className="relative overflow-hidden">
              <span className="wall-arm-left hazard-thin absolute right-0 top-1/2 h-[1.4vh] w-1/2 -translate-y-1/2 rounded-l-full" />
            </span>
            <span />
            <span className="relative overflow-hidden">
              <span className="wall-arm-right hazard-thin absolute left-0 top-1/2 h-[1.4vh] w-1/3 -translate-y-1/2 rounded-r-full" />
            </span>
          </div>
        )}

        {rows.length === 0 && (
          <div className="pointer-events-none absolute left-0 top-[8%] z-10 max-w-[44%] max-lg:static max-lg:max-w-none">
            <p className="display text-[max(2rem,3vw)] leading-[1.02] lg:[@media(max-height:820px)]:text-[max(1.5rem,2.1vw)]">No request has pulled up yet.</p>
            <p className="mt-[1.2vh] max-w-[40ch] text-[max(1.05rem,1.3vw)] leading-snug text-paper/80 lg:[@media(max-height:820px)]:hidden">
              Scan the code to become an approver, then let an agent try to buy. Inside its mandate it buys alone; above it, you sign off; outside it, the gate says no and names the rule.
            </p>
          </div>
        )}

        <ol ref={lanesRef} className="relative flex min-h-0 flex-1 flex-col">
          {rows.map((it, k) => (
            <Lane key={it.key} it={it} now={now} cols={cols} fresh={fresh} hidden={k >= fit} />
          ))}
          {Array.from({ length: rows.length ? Math.min(ghosts, LANES - rows.length) : 4 }, (_, k) => (
            <li key={`ghost-${k}`} aria-hidden className={`grid min-h-0 flex-1 items-center gap-x-[1.2vw] border-t border-paper/[0.07] ${cols}`}>
              <span />
              <span className="hidden h-[3px] rounded-full bg-paper/[0.07] lg:block" />
              <span />
              <span />
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-[1vh] text-[max(0.9rem,0.82vw)] text-paper/60">
        {error ? "Reconnecting to AimoPilot…" : lastAt ? `Last activity ${ago(lastAt, now)}. ` : ""}
        Each lane is one request; the marker shows how far it got. Yellow means a person must decide; black means the gate refused.
      </p>
    </section>
  );
}

/** An outside agent's door, said on its lane: the store's own doors carry no label. */
const OUTSIDE_DOOR: Record<NonNullable<FeedItem["door"]>, string> = { mcp: "outside agent · MCP", connector: "assistant · connector", rest: "outside agent · REST" };

function Lane({ it, now, cols, fresh, hidden }: { it: FeedItem; now: number; cols: string; fresh: boolean; hidden?: boolean }) {
  const at = markerAt(it.reached);
  const stopped = it.tone === "safety" && /^(Refused|Declined)/.test(it.status);
  const waiting = it.tone === "safety" && !stopped;
  const passed = it.tone === "done";
  const marker = stopped ? "bg-safety-ink ring-[3px] ring-safety" : waiting ? "bg-safety ring-[3px] ring-safety-ink" : passed ? "bg-lime" : "bg-paper";
  return (
    <li data-lane className={`${hidden ? "lg:hidden" : ""} ${fresh ? "wall-moved" : ""} grid min-h-0 flex-1 grid-cols-1 items-center gap-x-[1.2vw] gap-y-1.5 rounded-[max(10px,0.7vw)] border-t border-paper/10 py-[0.7vh] max-lg:py-3 [@media(max-height:960px)]:[&:nth-child(n+5)]:hidden ${cols}`} key={`${it.key}-${it.status}`}>
      <div className="min-w-0">
        {/* The kitchen without its city ("Hotel Kaleva kitchen, Helsinki"): the name fits the lane; the city is in the title. */}
        <p className="truncate text-[max(1.15rem,1.35vw)] font-semibold leading-tight" title={it.kitchen}>
          {it.kitchen.split(", ")[0]}
          {it.sample && <SamplePill dark className="text-[0.62em]" />}
        </p>
        <p className="truncate text-[max(0.92rem,0.95vw)] leading-tight text-paper/65 [@media(max-height:820px)]:hidden">
          {it.door ? <span className="mr-[0.5em] rounded-full bg-paper/12 px-[0.5em] text-[0.88em] font-medium text-paper/90">{OUTSIDE_DOOR[it.door]}</span> : null}
          {fiMoney(it.what)}
          {it.totalCents !== undefined ? `, ${money(it.totalCents)}` : ""}
        </p>
      </div>
      {/* the track before the gate */}
      <div className="relative order-3 h-[max(1.4rem,2.2vh)] lg:order-none" role="img" aria-label={`Reached ${it.reached >= 4 ? "the gate" : PRE_GATE[Math.max(0, it.reached - 1)]}`}>
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-paper/12" />
        <span aria-hidden className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-paper/70" style={{ width: `${at}%` }} />
        {PRE_GATE.map((s, k) => (
          <span key={s} aria-hidden className="absolute top-1/2 size-[max(0.55rem,0.6vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-petrol-deep ring-2 ring-paper/35" style={{ left: `${((k + 0.5) / PRE_GATE.length) * 100}%` }} />
        ))}
        <span aria-hidden className={`wall-marker absolute top-1/2 h-[max(1.1rem,1.8vh)] w-[max(1.8rem,2.1vw)] -translate-y-1/2 rounded-full shadow-[0_2px_10px_rgb(0_0_0/0.25)] ${marker}`} style={{ left: `calc(${at}% - ${at >= 100 ? "max(1.8rem,2.1vw)" : "max(0.9rem,1.05vw)"})` }} />
      </div>
      {/* through the post: only a request that passed */}
      <div aria-hidden className="relative hidden h-full lg:block">{passed && <span className="absolute inset-x-[-0.6vw] top-1/2 h-[max(0.45rem,0.8vh)] -translate-y-1/2 rounded-full bg-lime" />}</div>
      {/* the outcome */}
      <div className="flex min-w-0 items-center gap-[0.8vw]">
        {passed && <span aria-hidden className="hidden h-[max(0.45rem,0.8vh)] w-[1.2vw] shrink-0 rounded-r-full bg-lime lg:block" />}
        <p
          className={`inline-flex min-w-0 items-center gap-[0.45em] rounded-full text-[max(1.05rem,1.3vw)] font-semibold leading-tight ${
            stopped ? "bg-safety-ink py-[0.3em] pl-[0.4em] pr-[0.8em] text-safety ring-1 ring-inset ring-safety/50" : waiting ? "bg-safety py-[0.3em] pl-[0.5em] pr-[0.8em] text-safety-ink" : passed ? "bg-paper/10 py-[0.3em] pl-[0.4em] pr-[0.8em]" : "text-paper/75"
          }`}
        >
          {stopped && <Target size={22} tone="safety" className="size-[1.1em] shrink-0" />}
          {waiting && <span aria-hidden className="breathe size-[0.5em] shrink-0 rounded-full bg-safety-ink" />}
          {passed && (
            <span aria-hidden className="flex size-[1.15em] shrink-0 items-center justify-center rounded-full bg-lime text-ink">
              <Check className="size-[0.75em]" strokeWidth={3.2} />
            </span>
          )}
          <span className="truncate">{fiMoney(it.status)}</span>
        </p>
        <span className="hidden shrink-0 text-[max(0.85rem,0.82vw)] text-paper/55 tabular xl:inline">{ago(it.at, now)}</span>
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
    <section aria-label="Totals" className="grid grid-cols-2 border-t border-paper/10 bg-paper/[0.035] sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((x) => (
        <div key={x.label} className="min-w-0 px-[1.6vw] py-[1.1vh] max-lg:px-5 lg:[&:not(:last-child)]:border-r lg:[&:not(:last-child)]:border-paper/10">
          <p key={x.n} className={`display text-[max(2.4rem,2.7vw)] leading-[0.92] tabular ${x.tone === "gate" && x.n > 0 ? "text-safety" : ""}`}>
            {x.n.toLocaleString("fi-FI")}
          </p>
          <p className="mt-[0.5vh] text-[max(0.92rem,0.9vw)] font-medium leading-tight text-paper/75">{x.label}</p>
          {x.tone === "person" && (
            <p className="mt-[0.7vh] inline-flex items-center gap-2 rounded-full bg-safety px-[0.7em] py-[0.15em] text-[max(0.9rem,0.88vw)] font-semibold text-safety-ink">
              <span aria-hidden className="breathe size-[0.5em] rounded-full bg-safety-ink" />
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
    <section aria-labelledby="refused" className="flex min-h-0 flex-col overflow-hidden rounded-[max(20px,1.5vw)] bg-safety-ink px-[1.6vw] py-[1.8vh] ring-1 ring-inset ring-safety/25 max-lg:px-5">
      <h2 id="refused" className="display flex items-center gap-[0.6vw] text-[max(1.5rem,1.65vw)] leading-none">
        <Target size={30} tone="safety" className="h-[max(1.5rem,1.65vw)] w-auto" /> Refused, and why
      </h2>
      {items.length === 0 ? (
        <p className="mt-[1.4vh] max-w-[46ch] text-[max(1rem,1.05vw)] leading-snug text-paper/75">
          Nothing refused yet. Ask an agent for more than its budget, a product with a forbidden allergen, or to use a quote twice, and the reason appears here.
        </p>
      ) : (
        <ol className="mt-[1.6vh] min-h-0 space-y-[1.4vh] overflow-hidden">
          {items.slice(0, 3).map((r, k) => (
            <li key={r.key} className={`${k === 0 && fresh ? "wall-arm-left" : ""} lg:[&:nth-child(3)]:hidden ${k === 1 ? "[@media(max-height:760px)]:hidden" : ""}`}>
              <p className="truncate text-[max(1.05rem,1.15vw)] font-semibold leading-tight text-safety">{r.rule}</p>
              <p className="mt-[0.3vh] line-clamp-1 text-[max(0.95rem,0.98vw)] leading-snug text-paper/90">{fiMoney(r.reason)}</p>
              <p className="truncate text-[max(0.85rem,0.82vw)] text-paper/55">
                {r.kitchen.split(", ")[0]}, {ago(r.at, now)}
                {r.sample && <SamplePill dark />}
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
    <section aria-labelledby="crash" className="flex min-h-0 flex-col overflow-hidden rounded-[max(20px,1.5vw)] bg-paper/[0.045] px-[1.6vw] py-[1.8vh] ring-1 ring-inset ring-paper/10 max-lg:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="crash" className="display flex items-center gap-[0.6vw] text-[max(1.5rem,1.65vw)] leading-none">
          <Gauge aria-hidden className="h-[max(1.4rem,1.5vw)] w-auto text-lime" strokeWidth={2.2} /> Crash test
        </h2>
        <p className="text-[max(0.88rem,0.86vw)] text-paper/65 [@media(max-height:760px)]:hidden">13 hard purchasing situations. The rating becomes a licence: what the model may buy alone.</p>
      </div>
      {board.rows.length === 0 ? (
        <p className="mt-[1.4vh] max-w-[60ch] text-[max(1rem,1.05vw)] leading-snug text-paper/75">
          No model has been crash-tested on this server yet. Each one is run through the same thirteen situations (litres to cases, a passed cut-off, missing allergen data, an instruction hidden in a product text) and earns a licence that sets how much it may buy alone.
        </p>
      ) : (
        <div className="mt-[0.6vh] min-h-0 overflow-hidden max-lg:overflow-x-auto">
          <div className="max-lg:min-w-[40rem]">
            <CrashMatrix board={board} dark big maxRows={5} yardsticks={["reference"]} legend={false} />
          </div>
          {!board.rows.some((r) => !r.scripted) && (
            <p className="mt-[1vh] max-w-[60ch] text-[max(0.95rem,1vw)] leading-snug text-paper/75">No model has been rated on this server yet. The reference buyer above shows what getting through all thirteen looks like; each model run joins it here with its licence.</p>
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
    <section aria-labelledby="join" className="flex min-h-0 shrink flex-col overflow-hidden">
      {/* JOIN QR: the code a visitor scans to get their own kitchen and become its approver (see /join). */}
      <div className="m-[max(0.5rem,0.6vw)] rounded-[max(14px,1.1vw)] bg-lime px-[1.2vw] py-[1.6vh] text-ink max-lg:px-5">
        <h2 id="join" className="display text-[max(1.9rem,2.3vw)] leading-[0.98]">
          Scan to become the approver
        </h2>
        <p className="mt-[0.6vh] text-[max(1rem,1.05vw)] font-medium leading-snug">You get a kitchen of your own. Its agent asks you, on your phone, when it wants to go over its limit.</p>
      </div>
      <div className="px-[1.6vw] pt-[1.4vh] max-lg:px-5">
        <figure aria-label={`QR code for ${join.url}`} className="mx-auto w-full max-w-[min(100%,30vh)] rounded-[max(16px,1.2vw)] bg-paper p-[max(0.75rem,1vw)] shadow-[0_20px_50px_-20px_rgb(0_0_0/0.5)] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: join.qrSvg }} />
        <p className="mt-[1.2vh] break-all text-center text-[max(1rem,1.1vw)] font-semibold">{join.url.replace(/^https?:\/\//, "")}</p>
        <ol className="mt-[1.8vh] space-y-[0.9vh] text-[max(0.95rem,0.95vw)] leading-snug [@media(max-height:920px)]:hidden">
          {["Scan, and a kitchen of your own is set up with you as its approver.", "Ask its agent for 1 000 L of milk. That is over its limit, so the gate stops it.", "Approve or decline on your phone. The signed order lands on this screen."].map((x, k) => (
            <li key={k} className="grid grid-cols-[1.7em_minmax(0,1fr)] items-start gap-x-[0.6em]">
              <span className="flex size-[1.55em] items-center justify-center rounded-full bg-lime text-[0.9em] font-semibold text-ink tabular">{k + 1}</span>
              <span>{x}</span>
            </li>
          ))}
        </ol>
      </div>
      {kitchens.length > 0 && (
        <div className="mt-[2vh] px-[1.6vw] max-lg:px-5 lg:[@media(max-height:1180px)]:hidden">
          <h3 className="text-[max(1rem,1vw)] font-semibold">Kitchens here now: {kitchens.length}</h3>
          <ul className="mt-1 divide-y divide-paper/12">
            {kitchens.slice(0, 3).map((k, i) => (
              <li key={k.slug || `${k.name}-${i}`} className="flex items-center justify-between gap-2 py-[0.6vh] text-[max(0.92rem,0.9vw)]">
                <span className="min-w-0 truncate">
                  {k.name}, <span className="text-paper/70">{k.approverName}</span>
                </span>
                {/* Only the operations desk's screen gets the kitchens' ids, and so the buttons (server/authz.ts). */}
                {k.slug && (
                  <span className="flex shrink-0 gap-2">
                    <Link href={`/k/${k.slug}`} className={buttonClass("ghost-dark", "sm")}>
                      Shop
                    </Link>
                    <button type="button" disabled={busy === k.slug} onClick={() => void start(k.slug)} className={buttonClass("ghost-dark", "sm", "disabled:opacity-50")}>
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
