"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceStep } from "@/server/ops/trace";
import type { TraceView } from "@/server/ops/views";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Circle, CircleX, FileCheck2, History, ListChecks, Lock, MessageCircleQuestion, MessageCircleReply, MessageSquareQuote, MousePointerClick, Pause, Play, Radio, ScanText, Search, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Smartphone, type LucideIcon } from "lucide-react";
import { Avatar, Card, Kbd, buttonClass } from "../../../../_ui/kit";
import { Target } from "../../../../_ui/target";
import { ChainCheck } from "../../../_ui/chain";
import { fi, span, stamp, when, whenSeconds } from "../../../_ui/format";
import { Button, Details, Empty, KV, Licence, LoadError, Loading, ViaTag, useOps } from "../../../_ui/kit";
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

export function TraceScreen({ requestId, stream = false }: { requestId: string; stream?: boolean }) {
  const live = useOps<TraceView>(`/ops-api/trace/${requestId}`, { pollMs: 2500 });
  const t = live.data;
  if (!t && live.error) {
    return (
      <div className="mt-4">
        <Empty
          title={/not found|no request/i.test(live.error) ? "This request is not on this server" : "Could not read this request just now"}
          action={
            <Link className={buttonClass("secondary", "sm")} href="/ops">
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
  return <Trace key={t.requestId} t={t} error={live.error} stream={stream} />;
}

function stepFromUrl(n: number): number | "all" {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("step");
  const v = raw === null ? NaN : Number(raw);
  return Number.isInteger(v) && v >= 0 && v < n ? v : "all";
}

function Trace({ t, error, stream }: { t: TraceView; error?: string; stream: boolean }) {
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
      <header className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-[0.9rem]">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-ink-soft">
            <Link href="/ops" className="font-medium text-petrol hover:underline">
              Live
            </Link>
            <ChevronRight aria-hidden size={15} className="text-ink-faint" />
            <span>Trace of one request</span>
          </nav>
          <label className="flex min-w-0 max-w-full items-center gap-2.5">
            <span className="hidden shrink-0 text-ink-soft sm:inline">Open another request</span>
            <span className="relative min-w-0 flex-1">
              <select value={t.requestId} onChange={(e) => router.push(`/ops/trace/${e.target.value}`)} aria-label="Open another request" className="field !min-h-10 max-w-[44ch] appearance-none truncate pr-10 !text-[0.9rem]">
                {t.others.map((o) => (
                  <option key={o.requestId} value={o.requestId}>
                    {when(o.at)} {fi(o.label)}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft" />
            </span>
          </label>
        </div>
        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
          <div className="min-w-0 max-w-[68ch] flex-1">
            <h1 className={`display text-ink ${t.asked.length > 70 ? "text-[clamp(1.55rem,2.2vw,2.15rem)] leading-[1.1]" : "text-[clamp(1.9rem,2.8vw,2.75rem)] leading-[1.05]"}`}>“{fi(t.asked) || "A request with no words"}”</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-[0.9rem]">
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={t.orgName} size={34} />
                <span className="min-w-0 leading-tight">
                  <span className="block font-semibold">{t.orgName}</span>
                  <span className="block text-[0.84rem] text-ink-soft">{t.agentLabel}</span>
                </span>
              </span>
              <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
              <span className="leading-tight">
                <ViaTag via={t.via} />
                {t.doorText && <span className="block text-[0.84rem] text-ink-soft">through {t.doorText}</span>}
                {t.conversation && (
                  <Link className="block text-[0.84rem] text-petrol hover:underline" href={`/ops/conversation/${t.conversation}`}>
                    the whole conversation
                  </Link>
                )}
              </span>
              <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
              <span className="leading-tight">
                <Licence licence={t.licence} />
                <span className="block text-[0.84rem] text-ink-soft tabular">
                  {stamp(t.startedAt)}, {n} step{n === 1 ? "" : "s"} in {span(Date.parse(t.endedAt) - t0)}
                </span>
              </span>
            </div>
          </div>
          <Stamp kind={t.outcome.kind} label={t.outcome.label} />
        </div>
      </header>
      <LoadError message={error} />

      <Transport steps={t.steps} shown={shown} playing={playing} onToggle={toggle} go={go} current={current} t0={t0} setPlaying={setPlaying} />

      <div className="mt-6 grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="The request, station by station">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.88rem] text-ink-soft">
            <p>{replaying ? `Replaying: ${shown} of ${n} stations reached.` : "Every station, as it happened. The last one is open; click any to open it."}</p>
            <button type="button" onClick={() => setAllOpen((v) => !v)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-petrol hover:bg-petrol-soft">
              {allOpen ? <ChevronsDownUp aria-hidden size={16} /> : <ChevronsUpDown aria-hidden size={16} />}
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
            <div className="mt-2 flex flex-wrap gap-2.5 pl-[3rem] sm:pl-[3.75rem]">
              {t.orderIds.map((id, i) => (
                <Link key={id} href={`/ops/audit/${id}`} className={buttonClass("secondary", "sm")}>
                  <FileCheck2 aria-hidden size={16} />
                  Open the audit record{t.orderIds.length > 1 ? ` of order ${i + 1}` : ""}
                </Link>
              ))}
              {t.orderIds.map((id, i) => (
                <Link key={`tm-${id}`} href={`/ops/time-machine?order=${encodeURIComponent(id)}`} className={buttonClass("secondary", "sm")}>
                  <History aria-hidden size={16} />
                  The rules at this moment{t.orderIds.length > 1 ? `, order ${i + 1}` : ""}
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="grid content-start gap-4 md:grid-cols-2 xl:sticky xl:top-[15.5rem] xl:max-h-[calc(100dvh-16.5rem)] xl:grid-cols-1 xl:self-start xl:overflow-y-auto">
          <Card className="p-5">
            <h2 className="display text-[1.2rem]">What the live price service saw</h2>
            <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">The partner&apos;s live price service is metered. AimoPilot narrows the catalogue in master data first and asks live prices only for a short list.</p>
            <div className="mt-4">
              <Funnel catalogue={t.catalogueSize} considered={!replaying || consideredReached ? t.considered : undefined} priced={replaying ? pricedSoFar : t.priced} compact />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="display text-[1.2rem]">The record</h2>
            <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">Each station is one entry in the hash-chained ledger. Check the whole chain in this browser, without taking the server&apos;s word for it.</p>
            <div className="mt-3.5">
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
          </Card>
          {stream && <StreamReplay requestId={t.requestId} currentSeq={current?.seq} />}
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
  const ctl = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors duration-150 hover:bg-surface hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent pointer-coarse:size-11";
  return (
    <div className="sticky top-[3.3rem] z-10 -mx-4 bg-mist/90 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-14 xl:-mx-10 xl:px-10">
      <div className="rounded-xl border border-line bg-paper px-4 pb-3 pt-3.5 shadow-xs sm:px-5">
        {/* The station strip: one segment per station, one cell per step. Click a cell to go there. */}
        <div className="flex gap-2 sm:gap-2.5" role="group" aria-label="Stations">
          {segs.map((g) => {
            const reached = shown > g.from;
            const here = shown - 1 >= g.from && shown - 1 <= g.to;
            // A long request has many short segments: name the current one, the long ones and the gate's, not all.
            const named = segs.length <= 10 || here || g.to - g.from >= 2 || g.tone !== "plain" || g.from === 0;
            return (
              <div key={`${g.station}-${g.from}`} className="min-w-0" style={{ flex: `${g.to - g.from + 1} 1 0%` }}>
                <p className={`hidden truncate text-[0.78rem] leading-tight sm:block ${here ? "font-semibold text-ink" : reached ? "font-medium text-petrol" : "text-ink-soft"} ${named ? "" : "invisible"}`} title={g.station}>
                  {g.station}
                </p>
                <div className="flex gap-[3px] sm:mt-0.5">
                  {steps.slice(g.from, g.to + 1).map((s, k) => {
                    const i = g.from + k;
                    const on = i < shown;
                    const cur = i === shown - 1;
                    const fill = !on ? "bg-line" : g.tone === "gate" && (s.tone === "safety" || s.phase === "refused") ? "bg-safety-ink" : g.tone === "person" && s.tone === "safety" ? "hazard-thin" : s.phase === "committed" ? "bg-good" : "bg-petrol";
                    return (
                      <button
                        key={s.seq}
                        type="button"
                        onClick={stop(() => go(i + 1))}
                        aria-label={`Station ${i + 1}: ${PHASE_WORD[s.phase]}`}
                        aria-current={cur ? "step" : undefined}
                        title={`${i + 1}. ${PHASE_WORD[s.phase]}: ${fi(s.title)}`}
                        className="group flex min-w-[6px] flex-1 items-center rounded-full py-2"
                      >
                        <span className={`block w-full rounded-full transition-[height,box-shadow] duration-200 motion-reduce:transition-none ${fill} ${cur ? "h-3 shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]" : "h-2 group-hover:h-2.5"}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 sm:gap-x-1.5">
          <Button kind="go" size="md" onClick={onToggle} className="mr-auto min-w-[7rem] sm:mr-1.5 sm:min-w-[8.5rem]" ariaLabel={playing ? "Pause the replay" : "Play the replay"}>
            {playing ? <Pause aria-hidden size={16} fill="currentColor" strokeWidth={0} /> : <Play aria-hidden size={16} fill="currentColor" strokeWidth={0} />}
            {playing ? "Pause" : shown >= n ? "Replay" : shown === 0 ? "Play" : "Continue"}
          </Button>
          <button type="button" className={ctl} onClick={stop(() => go(0))} disabled={shown === 0} aria-label="Back to the start" title="Back to the start (Home)">
            <SkipBack aria-hidden size={18} />
          </button>
          <button type="button" className={ctl} onClick={stop(() => go(shown - 1))} disabled={shown === 0} aria-label="One station back" title="One station back (←)">
            <ChevronLeft aria-hidden size={21} />
          </button>
          <button type="button" className={ctl} onClick={stop(() => go(shown + 1))} disabled={shown >= n} aria-label="Next station" title="Next station (→)">
            <ChevronRight aria-hidden size={21} />
          </button>
          <button type="button" className={ctl} onClick={stop(() => go(n))} disabled={shown >= n} aria-label="Show every station" title="Show every station (End)">
            <SkipForward aria-hidden size={18} />
          </button>
          <label className="ml-1 hidden min-w-[12rem] flex-1 items-center gap-3 sm:flex">
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
              className="range"
              style={{ "--fill": `${n ? (shown / n) * 100 : 0}%` } as React.CSSProperties}
            />
            <span className="shrink-0 text-[0.82rem] font-medium text-ink-soft tabular">
              {shown}/{n}
            </span>
          </label>
          <p className="hidden items-center gap-1.5 pl-3 text-[0.78rem] text-ink-soft xl:flex">
            <Kbd>Space</Kbd> play <Kbd>←</Kbd>
            <Kbd>→</Kbd> step
          </p>
        </div>
        <p className="mt-1.5 line-clamp-2 min-h-[1.5em] text-[0.94rem] leading-snug sm:truncate" aria-live="polite">
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

/**
 * One station: a marker on the line and, when open, a card in the thread's anatomy (a mark and the kind, the title,
 * the content, the ledger entry). The gate is the climax: when it stopped the order or sent it to a person, the card
 * is the gate's slab, and its checks arrive one by one on a replay.
 */
function Station({ s, index, last, state, open, animate, elapsed, claims, checked, onToggle, onJump, ref }: StationProps) {
  const future = state === "future";
  const stopped = s.phase === "refused" || (s.phase === "gate" && s.checks?.some((c) => c.outcome === "fail"));
  // A person must decide: yellow. Once they have decided (approved), the station is calm again.
  const approved = s.phase === "signoff" && / approved it/.test(s.title);
  const person = !stopped && s.tone === "safety" && !approved;
  const slab = stopped || (person && s.phase === "gate");
  const done = s.phase === "committed" || approved;
  const Icon = PHASE_ICON[s.phase] ?? Circle;
  const marker = future
    ? "border border-line-strong bg-paper text-ink-soft"
    : stopped
      ? "bg-safety-ink text-safety"
      : person
        ? "bg-safety text-safety-ink"
        : done
          ? "bg-good text-paper"
          : state === "current"
            ? "bg-petrol text-paper"
            : "bg-petrol-soft text-petrol";
  return (
    <li ref={ref} className="relative grid scroll-mt-[17rem] grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-x-4">
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className={`absolute bottom-0 top-10 w-0.5 rounded-full ${future || state === "current" ? "bg-line" : "bg-petrol/30"}`} />}
        <span className={`relative mt-1.5 flex size-8 items-center justify-center rounded-full text-[0.84rem] font-semibold tabular transition-colors duration-200 sm:size-9 ${marker} ${state === "current" && !slab ? "ring-4 ring-petrol/15" : ""} ${state === "current" && slab ? "ring-4 ring-safety/35" : ""}`}>
          {stopped && !future ? <Target size={18} tone="safety" /> : done && !future ? <Check aria-hidden size={17} strokeWidth={2.8} /> : index + 1}
          {(stopped || done) && !future && <span className="sr-only">{index + 1}</span>}
        </span>
      </div>
      <div className="min-w-0 pb-4">
        {future ? (
          <button type="button" onClick={onJump} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-ink-soft transition-colors hover:bg-paper hover:text-ink">
            <span className="font-medium">{PHASE_WORD[s.phase]}</span>
            <span className="truncate text-[0.86rem] text-ink-faint">not reached yet</span>
          </button>
        ) : !open ? (
          <button type="button" onClick={onToggle} aria-expanded={false} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-paper">
            <span className={`shrink-0 font-semibold ${slab ? "text-ink" : "text-petrol"}`}>{PHASE_WORD[s.phase]}</span>
            <span className="min-w-0 flex-1 truncate text-[0.95rem] text-ink-soft">{summaryOf(s)}</span>
            <span className="hidden shrink-0 text-[0.8rem] text-ink-soft tabular sm:inline">{whenSeconds(s.at)}</span>
            <ChevronDown aria-hidden size={16} className="shrink-0 text-ink-faint" />
          </button>
        ) : (
          <article
            className={`${slab ? "hazard-frame on-dark text-paper" : `overflow-hidden rounded-xl border bg-paper ${state === "current" ? "border-petrol/45 shadow-sm" : "border-line"}`} ${state === "current" && slab ? "shadow-lg" : ""} ${animate ? "lane-enter" : ""}`}
          >
            <header className={`flex items-center gap-2.5 px-4 sm:px-5 ${slab ? "pt-4" : "pt-3.5"}`}>
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${slab ? "" : done ? "bg-good-soft text-good" : person ? "bg-safety-soft text-safety-ink" : "bg-petrol-soft text-petrol"}`}>
                {slab ? <Target size={22} tone="safety" /> : <Icon aria-hidden size={15} strokeWidth={2.1} />}
              </span>
              <p className={`flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-[0.84rem] ${slab ? "text-paper/70" : "text-ink-soft"}`}>
                <span className={`font-semibold ${slab ? "text-paper" : "text-ink"}`}>{PHASE_WORD[s.phase]}</span>
                <span>by {s.actor}</span>
                <span className="tabular sm:hidden">{whenSeconds(s.at)}</span>
                {checked && (
                  <span title="Checked in this browser" className={`inline-flex items-center gap-1 ${slab ? "text-lime" : "text-good"}`}>
                    <ShieldCheck aria-hidden size={13} />
                    {checked === "recomputed" ? "entry re-hashed in this browser" : "entry checked by link"}
                  </span>
                )}
              </p>
              <span className={`hidden shrink-0 text-right text-[0.8rem] leading-tight tabular sm:block ${slab ? "text-paper/70" : "text-ink-soft"}`}>
                {whenSeconds(s.at)}
                <span className="block">+{span(elapsed)}</span>
              </span>
              {state === "past" && (
                <button type="button" onClick={onToggle} aria-label="Fold this station" title="Fold" className={`-mr-2 flex size-9 shrink-0 items-center justify-center rounded-full ${slab ? "text-paper/70 hover:bg-paper/10 hover:text-paper" : "text-ink-soft hover:bg-surface hover:text-ink"}`}>
                  <ChevronUp aria-hidden size={18} />
                </button>
              )}
            </header>
            <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
              <h3 className={`display text-[1.3rem] leading-[1.12] sm:text-[1.45rem] ${slab ? "text-safety" : ""}`}>{fi(s.title)}</h3>
              <StationBody s={s} claims={claims} animate={animate} dark={slab} />
            </div>
            <div className={`border-t px-4 py-1.5 sm:px-5 ${slab ? "border-paper/12" : "border-line/70"}`}>
              <Details summary={`Ledger entry ${s.ledger.seq}, as written`} dark={slab}>
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

/** A mark per kind of station, from the same line icons as the rest of the portal. */
const PHASE_ICON: Partial<Record<TraceStep["phase"], LucideIcon>> = {
  asked: MessageSquareQuote,
  understood: ScanText,
  checked: MessageCircleQuestion,
  answered: MessageCircleReply,
  searched: Search,
  priced: Radio,
  options: ListChecks,
  chosen: MousePointerClick,
  quoted: Lock,
  gate: ShieldCheck,
  signoff: Smartphone,
  committed: FileCheck2,
  declined: CircleX,
  refused: CircleX,
  control: SlidersHorizontal,
};
