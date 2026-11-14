"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceStep } from "@/server/ops/trace";
import type { TraceView } from "@/server/ops/views";
import { Kbd } from "../../../../_ui/kit";
import { ChainCheck } from "../../../_ui/chain";
import { fi, span, stamp, when, whenSeconds } from "../../../_ui/format";
import { Button, Details, Empty, KV, Licence, LoadError, Loading, Panel, ViaTag, useOps } from "../../../_ui/kit";
import { Funnel, Stamp } from "../../../_ui/parts";
import type { ChainResult } from "../../../_ui/verify-client";
import { StreamReplay } from "../../platform/_parts/stream-replay";
import { PHASE_WORD, StationBody, stationOf, summaryOf } from "./stations";

/**
 * The flow trace: one request as a journey through stations, in the order it happened, built from its ledger
 * entries. The station strip and the transport are one sticky band; the lane below opens each station as the replay
 * reaches it. A presenter plays it in about thirty seconds; a judge can step, scrub, click any station, or share a
 * link to one step (?step=N).
 */
const REPLAY_MS = 30_000;

export function TraceScreen({ requestId }: { requestId: string }) {
  const live = useOps<TraceView>(`/ops-api/trace/${requestId}`, { pollMs: 2500 });
  const t = live.data;
  if (!t && live.error) {
    return (
      <div className="mt-4">
        <Empty
          title={/not found|no request/i.test(live.error) ? "This request is not on this server" : "Could not read this request just now"}
          action={
            <Link className="font-semibold text-petrol underline underline-offset-2" href="/ops">
              Back to the live view
            </Link>
          }
        >
          {live.error} {/not found|no request/i.test(live.error) ? "Requests live in memory, so after a restart the ledger starts again." : "The page keeps trying on its own."}
        </Empty>
      </div>
    );
  }
  if (!t) return <Loading label="Reading this request's ledger entries…" />;
  return <Trace key={t.requestId} t={t} error={live.error} />;
}

function stepFromUrl(n: number): number | "all" {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("step");
  const v = raw === null ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v < n ? v : "all";
}

function Trace({ t, error }: { t: TraceView; error?: string }) {
  const router = useRouter();
  const n = t.steps.length;
  // How many steps are revealed. "all" follows the request as new steps arrive. Starts from ?step= when given.
  const [reveal, setReveal] = useState<number | "all">("all");
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const userMoved = useRef(false);
  useEffect(() => {
    const fromUrl = stepFromUrl(n);
    if (fromUrl !== "all") {
      userMoved.current = true;
      queueMicrotask(() => setReveal(fromUrl));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = reveal === "all" ? n : Math.min(reveal, n);
  const [playingFlag, setPlaying] = useState(false);
  const playing = playingFlag && shown < n;
  const [chain, setChain] = useState<ChainResult>();
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const setShown = useCallback(
    (f: (s: number) => number) =>
      setReveal((r) => {
        const next = f(r === "all" ? n : r);
        return next >= n ? "all" : next;
      }),
    [n],
  );

  // The URL carries the step, so a reload or a shared link lands on the same station.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (reveal === "all") url.searchParams.delete("step");
    else url.searchParams.set("step", String(reveal));
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [reveal]);

  const tick = Math.min(3500, Math.max(1100, REPLAY_MS / Math.max(1, n)));
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setShown((s) => Math.min(n, s + 1)), shown === 0 ? 500 : tick);
    return () => clearTimeout(id);
  }, [playing, shown, n, tick, setShown]);

  useEffect(() => {
    if (!userMoved.current || shown === 0) return;
    const el = refs.current[shown - 1];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [shown]);

  const go = useCallback(
    (to: number) => {
      userMoved.current = true;
      setShown(() => Math.max(0, Math.min(n, to)));
    },
    [n, setShown],
  );
  const play = useCallback(() => {
    userMoved.current = true;
    if (shown >= n) setShown(() => 0);
    setPlaying(true);
  }, [shown, n, setShown]);
  const toggle = useCallback(() => (playing ? setPlaying(false) : play()), [playing, play]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, button, summary, a, [contenteditable]")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        setPlaying(false);
        go(shown + 1);
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        setPlaying(false);
        go(shown - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPlaying(false);
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setPlaying(false);
        go(n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, go, shown, n]);

  const t0 = Date.parse(t.startedAt);
  const current = shown > 0 ? t.steps[shown - 1] : undefined;
  const revealed = t.steps.slice(0, shown);
  // The funnel fills as the replay passes the stations that touch the catalogue.
  const pricedSoFar = useMemo(() => new Set(revealed.filter((s) => s.phase === "priced").flatMap((s) => (s.products ?? []).map((p) => p.id))).size, [revealed]);
  const consideredReached = revealed.some((s) => s.phase === "searched" || s.phase === "options" || s.phase === "priced");
  const replaying = reveal !== "all";

  const toggleOpen = (i: number) =>
    setOpened((o) => {
      const next = new Set(o);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <>
      <header className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[0.9rem] text-ink-soft">
          <nav aria-label="Breadcrumb">
            <Link href="/ops" className="font-semibold text-petrol underline underline-offset-2">
              Live
            </Link>{" "}
            / Trace of one request
          </nav>
          <label className="flex items-center gap-2">
            <span>Open another request</span>
            <select
              value={t.requestId}
              onChange={(e) => router.push(`/ops/trace/${e.target.value}`)}
              className="min-h-9 max-w-[46ch] border-2 border-line bg-paper px-2 text-[0.9rem] text-ink focus:border-petrol"
            >
              {t.others.map((o) => (
                <option key={o.requestId} value={o.requestId}>
                  {when(o.at)} {fi(o.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div className="min-w-0 max-w-[70ch]">
            <h1 className={`display leading-[1.02] text-ink ${t.asked.length > 70 ? "text-[clamp(1.7rem,2.1vw,2.2rem)]" : "text-[clamp(2rem,2.8vw,2.9rem)]"}`}>“{fi(t.asked) || "A request with no words"}”</h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.95rem]">
              <span className="font-semibold">{t.orgName}</span>
              <span className="text-ink-soft">{t.agentLabel}</span>
              <ViaTag via={t.via} />
              {t.doorText && <span className="text-ink-soft">through {t.doorText}</span>}
              {t.conversation && (
                <Link className="text-petrol underline underline-offset-4" href={`/ops/conversation/${t.conversation}`}>
                  the whole conversation
                </Link>
              )}
              <Licence licence={t.licence} />
              <span className="text-ink-soft tabular">
                {stamp(t.startedAt)}, {n} step{n === 1 ? "" : "s"} in {span(Date.parse(t.endedAt) - t0)}
              </span>
            </p>
          </div>
          <Stamp kind={t.outcome.kind} label={t.outcome.label} />
        </div>
      </header>
      <LoadError message={error} />

      <Transport steps={t.steps} shown={shown} playing={playing} onToggle={toggle} go={go} current={current} t0={t0} setPlaying={setPlaying} />

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section aria-label="The request, station by station">
          <div className="mb-2 flex items-center justify-between gap-3 text-[0.88rem] text-ink-soft">
            <p>{replaying ? `Replaying: ${shown} of ${n} stations reached.` : "Every station, as it happened. The last one is open; click any to open it."}</p>
            <button type="button" onClick={() => setAllOpen((v) => !v)} className="font-semibold text-petrol underline underline-offset-2">
              {allOpen ? "Fold them" : "Open every station"}
            </button>
          </div>
          <ol className="relative">
            {t.steps.map((s, i) => {
              const state = i < shown - 1 ? "past" : i === shown - 1 ? "current" : "future";
              return (
                <Station
                  key={s.seq}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  s={s}
                  index={i}
                  last={i === n - 1}
                  state={state}
                  open={state === "current" || (state === "past" && (allOpen || opened.has(i)))}
                  animate={replaying && state === "current"}
                  elapsed={Date.parse(s.at) - t0}
                  claims={t.claims}
                  checked={chain?.bySeq[s.seq]}
                  onToggle={() => toggleOpen(i)}
                  onJump={() => {
                    setPlaying(false);
                    go(i + 1);
                  }}
                />
              );
            })}
          </ol>
          {t.orderIds.length > 0 && (
            <p className="mt-4 flex flex-wrap gap-4 pl-[3.75rem] text-[0.95rem]">
              {t.orderIds.map((id, i) => (
                <Link key={id} href={`/ops/audit/${id}`} className="font-semibold text-petrol underline underline-offset-2">
                  Open the audit record{t.orderIds.length > 1 ? ` of order ${i + 1}` : ""}
                </Link>
              ))}
              {t.orderIds.map((id, i) => (
                <Link key={`tm-${id}`} href={`/ops/time-machine?order=${encodeURIComponent(id)}`} className="font-semibold text-petrol underline underline-offset-2">
                  The rules at this moment{t.orderIds.length > 1 ? `, order ${i + 1}` : ""}
                </Link>
              ))}
            </p>
          )}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-[9.5rem] xl:max-h-[calc(100dvh-10.5rem)] xl:self-start xl:overflow-y-auto">
          <Panel rule className="px-4 py-4">
            <h2 className="display text-[1.3rem]">What the live price service saw</h2>
            <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">The partner&apos;s live price service is metered. AimoPilot narrows the catalogue in master data first and asks live prices only for a short list.</p>
            <div className="mt-3">
              <Funnel catalogue={t.catalogueSize} considered={!replaying || consideredReached ? t.considered : undefined} priced={replaying ? pricedSoFar : t.priced} />
            </div>
          </Panel>
          <Panel rule className="px-4 py-4">
            <h2 className="display text-[1.3rem]">The record</h2>
            <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">Each station is one entry in the hash-chained ledger. Check the whole chain in this browser, without taking the server&apos;s word for it.</p>
            <div className="mt-3">
              <ChainCheck compact onResult={(r) => setChain(r)} />
            </div>
            {chain && <p className="mt-2 text-[0.84rem] text-ink-soft">{chain.ok ? "Each station now says how it was checked." : "The stations after the break cannot be trusted."}</p>}
            <Details summary="Ids and ledger head" className="mt-3">
              <KV k="request" v={t.requestId} />
              <KV k="agent" v={t.agentId} />
              {t.orderIds.map((id) => (
                <KV key={id} k="order" v={id} />
              ))}
              <KV k="ledger head" v={t.chain.head ? `${t.chain.head.seq} ${t.chain.head.hash.slice(0, 24)}…` : "empty"} />
            </Details>
          </Panel>
          <StreamReplay requestId={t.requestId} currentSeq={current?.seq} />
        </aside>
      </div>
    </>
  );
}

// ---------- the transport: station strip, scrubber, controls ----------

type Segment = { station: string; from: number; to: number; tone: "plain" | "gate" | "person" | "done" };

/** Consecutive steps at the same station form one segment of the strip. */
function segmentsOf(steps: TraceStep[]): Segment[] {
  const out: Segment[] = [];
  steps.forEach((s, i) => {
    const station = stationOf(s);
    const tone: Segment["tone"] =
      s.phase === "refused" || (s.phase === "gate" && s.checks?.some((c) => c.outcome === "fail")) || s.phase === "declined"
        ? "gate"
        : s.tone === "safety"
          ? "person"
          : s.phase === "committed"
            ? "done"
            : "plain";
    const last = out.at(-1);
    if (last && last.station === station) {
      last.to = i;
      if (tone === "gate" || (tone === "person" && last.tone !== "gate") || (tone === "done" && last.tone === "plain")) last.tone = tone;
    } else out.push({ station, from: i, to: i, tone });
  });
  return out;
}

function Transport({
  steps,
  shown,
  playing,
  onToggle,
  go,
  current,
  t0,
  setPlaying,
}: {
  steps: TraceStep[];
  shown: number;
  playing: boolean;
  onToggle: () => void;
  go: (to: number) => void;
  current?: TraceStep;
  t0: number;
  setPlaying: (p: boolean) => void;
}) {
  const n = steps.length;
  const segs = useMemo(() => segmentsOf(steps), [steps]);
  const total = Math.round((Math.min(3.5, Math.max(1.1, REPLAY_MS / 1000 / Math.max(1, n))) * n + 0.5) * 1) || 0;
  const stop = (f: () => void) => () => {
    setPlaying(false);
    f();
  };
  return (
    <div className="sticky top-0 z-20 -mx-4 bg-mist/95 px-4 pb-3 pt-2 backdrop-blur-sm sm:-mx-6 sm:px-6 xl:-mx-10 xl:px-10">
      <div className="bg-paper px-4 pb-3 pt-3 shadow-[0_1px_0_var(--color-line)]">
        {/* The station strip: one segment per station, one cell per step. Click a cell to go there. */}
        <div className="flex gap-1.5" role="group" aria-label="Stations">
          {segs.map((g) => {
            const reached = shown > g.from;
            const here = shown - 1 >= g.from && shown - 1 <= g.to;
            // A long request has many short segments: name the current one, the long ones and the gate's, not all.
            const named = segs.length <= 10 || here || g.to - g.from >= 2 || g.tone !== "plain" || g.from === 0;
            return (
              <div key={`${g.station}-${g.from}`} className="min-w-0" style={{ flex: `${g.to - g.from + 1} 1 0%` }}>
                <p className={`truncate text-[0.82rem] font-semibold leading-tight ${here ? "text-ink" : reached ? "text-petrol" : "text-ink-soft"} ${named ? "" : "invisible"}`} title={g.station}>
                  {g.station}
                </p>
                <div className="mt-1 flex gap-[3px]">
                  {steps.slice(g.from, g.to + 1).map((s, k) => {
                    const i = g.from + k;
                    const on = i < shown;
                    const cur = i === shown - 1;
                    const fill = !on ? "bg-mist ring-1 ring-inset ring-line" : g.tone === "gate" && (s.tone === "safety" || s.phase === "refused") ? "bg-safety-ink" : g.tone === "person" && s.tone === "safety" ? "hazard-thin" : "bg-petrol";
                    return (
                      <button
                        key={s.seq}
                        type="button"
                        onClick={stop(() => go(i + 1))}
                        aria-label={`Station ${i + 1}: ${PHASE_WORD[s.phase]}`}
                        aria-current={cur ? "step" : undefined}
                        title={`${i + 1}. ${PHASE_WORD[s.phase]}: ${fi(s.title)}`}
                        className={`h-4 min-w-[8px] flex-1 ${fill} ${cur ? "outline outline-2 outline-offset-2 outline-ink" : ""}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button kind="go" size="md" onClick={onToggle} className="min-w-[8.5rem]" ariaLabel={playing ? "Pause the replay" : "Play the replay"}>
            {playing ? <PauseGlyph /> : <PlayGlyph />}
            {playing ? "Pause" : shown >= n ? "Replay" : shown === 0 ? "Play" : "Continue"}
          </Button>
          <Button onClick={stop(() => go(0))} disabled={shown === 0} ariaLabel="Back to the start">
            Start
          </Button>
          <Button onClick={stop(() => go(shown - 1))} disabled={shown === 0} ariaLabel="One station back">
            Back
          </Button>
          <Button onClick={stop(() => go(shown + 1))} disabled={shown >= n} ariaLabel="Next station">
            Next
          </Button>
          <Button onClick={stop(() => go(n))} disabled={shown >= n} ariaLabel="Show every station">
            All
          </Button>
          <label className="flex min-w-[12rem] flex-1 items-center gap-3">
            <span className="sr-only">Scrub through the stations</span>
            <input
              type="range"
              min={0}
              max={n}
              step={1}
              value={shown}
              onChange={(e) => {
                setPlaying(false);
                go(Number(e.target.value));
              }}
              aria-valuetext={shown === 0 ? "Before the first station" : `Station ${shown} of ${n}: ${current ? PHASE_WORD[current.phase] : ""}`}
              className="h-2 w-full cursor-pointer accent-[var(--color-petrol)]"
            />
          </label>
          <p className="hidden items-center gap-1.5 text-[0.8rem] text-ink-soft lg:flex">
            <Kbd>Space</Kbd> play <Kbd>←</Kbd>
            <Kbd>→</Kbd> step <Kbd>Home</Kbd>
            <Kbd>End</Kbd>
          </p>
        </div>
        <p className="mt-2 min-h-[1.5em] truncate text-[0.98rem]" aria-live="polite">
          {shown === 0 ? (
            <span className="text-ink-soft">
              Ready: {n} stations, about {total} seconds. Press Play, or click any station.
            </span>
          ) : current ? (
            <>
              <span className="font-semibold tabular">
                {shown} of {n}, {PHASE_WORD[current.phase]}
              </span>
              <span className="text-ink-soft">
                {" "}
                at {whenSeconds(current.at)}, +{span(Date.parse(current.at) - t0)}:{" "}
              </span>
              <span>{summaryOf(current)}</span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M2 1 L13 7 L2 13 Z" fill="currentColor" />
    </svg>
  );
}
function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M2 1 H5.5 V13 H2 Z M8.5 1 H12 V13 H8.5 Z" fill="currentColor" />
    </svg>
  );
}

// ---------- one station on the lane ----------

type StationProps = {
  s: TraceStep;
  index: number;
  last: boolean;
  state: "past" | "current" | "future";
  open: boolean;
  animate: boolean;
  elapsed: number;
  claims: TraceView["claims"];
  checked?: "recomputed" | "linked";
  onToggle: () => void;
  onJump: () => void;
  ref?: React.Ref<HTMLLIElement>;
};

function Station({ s, index, last, state, open, animate, elapsed, claims, checked, onToggle, onJump, ref }: StationProps) {
  const future = state === "future";
  const stopped = s.phase === "refused" || (s.phase === "gate" && s.checks?.some((c) => c.outcome === "fail"));
  // A person must decide: yellow. Once they have decided (approved), the station is back to petrol.
  const person = !stopped && s.tone === "safety" && !(s.phase === "signoff" && / approved it/.test(s.title));
  const badge = future
    ? "border-2 border-line bg-mist text-ink-soft"
    : stopped
      ? "bg-safety-ink text-safety"
      : person
        ? "bg-safety text-safety-ink ring-2 ring-inset ring-safety-ink"
        : s.phase === "committed"
          ? "bg-petrol text-paper"
          : state === "current"
            ? "bg-ink text-paper"
            : "bg-petrol-deep text-paper";
  return (
    <li ref={ref} className="relative grid scroll-mt-44 grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className={`absolute bottom-0 top-9 w-[3px] ${future ? "bg-line" : "bg-petrol"}`} />}
        <span className={`relative mt-2 flex size-9 items-center justify-center font-display text-[1.15rem] font-extrabold tabular ${badge}`}>
          {index + 1}
        </span>
      </div>
      <div className="min-w-0 pb-3 pt-1.5">
        {future ? (
          <button type="button" onClick={onJump} className="flex min-h-9 w-full items-center gap-3 text-left text-[0.98rem] text-ink-soft hover:text-ink">
            <span className="font-semibold">{PHASE_WORD[s.phase]}</span>
            <span className="truncate text-[0.88rem]">not reached yet</span>
          </button>
        ) : !open ? (
          <button type="button" onClick={onToggle} aria-expanded={false} className="flex min-h-9 w-full items-baseline gap-3 px-1 text-left hover:bg-paper">
            <span className="shrink-0 font-semibold text-petrol">{PHASE_WORD[s.phase]}</span>
            <span className="min-w-0 flex-1 truncate text-[0.98rem]">{summaryOf(s)}</span>
            <span className="hidden shrink-0 text-[0.82rem] text-ink-soft tabular sm:inline">{whenSeconds(s.at)}</span>
          </button>
        ) : (
          <article className={`bg-paper ${state === "current" ? "outline outline-2 outline-ink" : ""} ${animate ? "lane-enter" : ""}`}>
            <div aria-hidden className={stopped ? "hazard h-3" : person ? "hazard-thin h-1.5" : s.phase === "committed" ? "h-[5px] bg-petrol" : "h-[3px] bg-petrol"} />
            <div className="px-5 pb-4 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[0.85rem] text-ink-soft">
                  <span className="font-semibold text-petrol">{PHASE_WORD[s.phase]}</span>
                  <span>by {s.actor}</span>
                  <span className="tabular">
                    at {whenSeconds(s.at)}, +{span(elapsed)}
                  </span>
                  {checked && <span title="Checked in this browser">{checked === "recomputed" ? "entry re-hashed in this browser" : "entry checked by link"}</span>}
                </p>
                {state === "past" && (
                  <button type="button" onClick={onToggle} className="text-[0.85rem] text-ink-soft underline underline-offset-2 hover:text-ink">
                    Fold
                  </button>
                )}
              </div>
              <h3 className="display mt-1 text-[1.5rem] leading-[1.08]">{fi(s.title)}</h3>
              <StationBody s={s} claims={claims} animate={animate} />
            </div>
            <div className="border-t border-line/70 px-5 py-2">
              <Details summary={`Ledger entry ${s.ledger.seq}, as written`}>
                <KV k="type" v={s.ledger.type} />
                <KV k="actor" v={s.ledger.actor} />
                <KV k="hash" v={s.ledger.hash} />
                <KV k="prev" v={s.ledger.prevHash} />
                {s.facts
                  .filter((f) => /^(Quote|Order|Code|Named product)$/.test(f.label))
                  .map((f) => (
                    <KV key={f.label} k={f.label.toLowerCase()} v={f.value} />
                  ))}
                {s.checks?.map((c) => (
                  <KV key={c.rule} k={c.rule} v={c.outcome} />
                ))}
                {s.products?.map((p) => (
                  <KV key={p.id} k="product" v={`${p.id} ${p.name}`} />
                ))}
                <p className="whitespace-pre-wrap font-sans text-[0.8rem]">{s.ledger.summary}</p>
              </Details>
            </div>
          </article>
        )}
      </div>
    </li>
  );
}
