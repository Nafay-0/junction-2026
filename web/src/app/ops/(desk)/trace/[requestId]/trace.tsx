"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Check, TraceStep } from "@/server/ops/trace";
import type { TraceView } from "@/server/ops/views";
import { Target } from "../../../../_ui/target";
import { ChainCheck } from "../../../_ui/chain";
import { fi, num, span, when, whenSeconds } from "../../../_ui/format";
import { Button, Details, Empty, KV, Licence, LoadError, Loading, Outcome, Panel, ViaTag, useOps } from "../../../_ui/kit";
import { verifyToken, type ChainResult, type TokenCheck } from "../../../_ui/verify-client";

/**
 * The flow trace: one request as a path through Dock, in the order it happened, with a replay control so a
 * presenter can walk a judge through "the working" in about thirty seconds. Each station is one ledger entry.
 */
const PHASE_WORD: Record<TraceStep["phase"], string> = {
  asked: "Asked",
  understood: "Understood",
  checked: "Checked with the kitchen",
  answered: "Kitchen answered",
  searched: "Searched",
  priced: "Live check",
  options: "Options",
  chosen: "Chosen",
  quoted: "Price fixed",
  gate: "Gate",
  signoff: "Sign-off",
  committed: "Committed",
  declined: "Declined",
  refused: "Refused",
  control: "Operations",
  other: "Step",
};

const REPLAY_MS = 30_000;

export function TraceScreen({ requestId }: { requestId: string }) {
  const live = useOps<TraceView>(`/ops-api/trace/${requestId}`, { pollMs: 2500 });
  const t = live.data;
  if (!t && live.error) {
    return (
      <div className="mt-4">
        <Empty title="This request is not on this server">
          {live.error} Requests live in memory: after a restart the ledger starts again. <Link className="underline" href="/ops">Back to the live view</Link>.
        </Empty>
      </div>
    );
  }
  if (!t) return <Loading />;
  return <Trace key={t.requestId} t={t} error={live.error} />;
}

function Trace({ t, error }: { t: TraceView; error?: string }) {
  const router = useRouter();
  const n = t.steps.length;
  // How many steps are revealed. "all" follows the request as new steps arrive.
  const [reveal, setReveal] = useState<number | "all">("all");
  const shown = reveal === "all" ? n : Math.min(reveal, n);
  const [playingFlag, setPlaying] = useState(false);
  const playing = playingFlag && shown < n;
  const [chain, setChain] = useState<ChainResult>();
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const userMoved = useRef(false);
  const setShown = useCallback(
    (f: (s: number) => number) =>
      setReveal((r) => {
        const next = f(r === "all" ? n : r);
        return next >= n ? "all" : next;
      }),
    [n],
  );

  const tick = Math.min(3500, Math.max(1200, REPLAY_MS / Math.max(1, n)));
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setShown((s) => Math.min(n, s + 1)), shown === 0 ? 400 : tick);
    return () => clearTimeout(id);
  }, [playing, shown, n, tick, setShown]);

  useEffect(() => {
    if (!userMoved.current || shown === 0) return;
    const el = refs.current[shown - 1];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, button, summary")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (playing) setPlaying(false);
        else play();
      } else if (e.key === "ArrowRight") go(shown + 1);
      else if (e.key === "ArrowLeft") go(shown - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, play, go, shown, n]);

  const t0 = Date.parse(t.startedAt);
  const current = shown > 0 ? t.steps[shown - 1] : undefined;
  const untouched = t.catalogueSize ? Math.max(0, t.catalogueSize - t.priced) : undefined;

  return (
    <>
      <header className="border-b-2 border-ink pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[0.85rem] text-ink-soft">
          <p>
            <Link href="/ops" className="underline underline-offset-2">
              Live
            </Link>{" "}
            / Trace of one request
          </p>
          <label className="flex items-center gap-2">
            <span>Open another</span>
            <select
              value={t.requestId}
              onChange={(e) => router.push(`/ops/trace/${e.target.value}`)}
              className="max-w-[42ch] border border-concrete-deep bg-paper px-2 py-1 text-[0.85rem] text-ink"
            >
              {t.others.map((o) => (
                <option key={o.requestId} value={o.requestId}>
                  {when(o.at)} {fi(o.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h1 className="mt-2 max-w-[60ch] font-display text-[1.9rem] font-bold leading-[1.1] tracking-tight">“{fi(t.asked)}”</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.88rem]">
          <span className="font-semibold">{t.orgName}</span>
          <span className="text-ink-soft">{t.agentLabel}</span>
          <ViaTag via={t.via} />
          <Licence licence={t.licence} />
          <span className="text-ink-soft tabular">
            {when(t.startedAt)}, {n} steps in {span(Date.parse(t.endedAt) - t0)}
          </span>
          <Outcome kind={t.outcome.kind} label={fi(t.outcome.label)} />
        </div>
      </header>
      <LoadError message={error} />

      <Replay steps={t.steps} shown={shown} playing={playing} onPlay={play} onPause={() => setPlaying(false)} go={go} current={current} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ol aria-label="The request, step by step" className="relative">
          {t.steps.map((s, i) => (
            <Station
              key={s.seq}
              ref={(el) => {
                refs.current[i] = el;
              }}
              s={s}
              index={i}
              last={i === n - 1}
              state={i < shown - 1 ? "past" : i === shown - 1 ? "current" : "future"}
              elapsed={Date.parse(s.at) - t0}
              claims={t.claims}
              checked={chain?.bySeq[s.seq]}
              onOpen={() => go(i + 1)}
            />
          ))}
        </ol>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <Panel className="px-4 py-3">
            <h2 className="font-display text-[1.05rem] font-bold">What the live service saw</h2>
            <p className="mt-1 text-[0.88rem] leading-snug">
              Looked at <b>{num(t.considered)}</b> product{t.considered === 1 ? "" : "s"} in master data, free. Sent <b>{num(t.priced)}</b> to the live price service.
              {untouched !== undefined && (
                <>
                  {" "}
                  The other <b>{num(untouched)}</b> of {num(t.catalogueSize)} were never priced.
                </>
              )}
            </p>
          </Panel>
          <Panel className="px-4 py-3">
            <h2 className="font-display text-[1.05rem] font-bold">The record</h2>
            <p className="mt-1 text-[0.88rem] leading-snug">
              Each step above is one entry in the hash-chained ledger. Check the whole chain here, without taking the server&apos;s word for it.
            </p>
            <div className="mt-2">
              <ChainCheck compact onResult={(r) => setChain(r)} />
            </div>
            {chain && (
              <p className="mt-2 text-[0.82rem] text-ink-soft">
                {chain.ok ? "Each step now shows how it was checked." : "The steps after the break cannot be trusted."}
              </p>
            )}
            {t.orderIds.length > 0 && (
              <p className="mt-3 text-[0.88rem]">
                {t.orderIds.map((id) => (
                  <Link key={id} href={`/ops/audit/${id}`} className="mr-3 font-semibold underline underline-offset-2">
                    Audit record of the order
                  </Link>
                ))}
              </p>
            )}
            <Details summary="Ids" className="mt-2">
              <KV k="request" v={t.requestId} />
              <KV k="agent" v={t.agentId} />
              {t.orderIds.map((id) => (
                <KV key={id} k="order" v={id} />
              ))}
              <KV k="ledger head" v={t.chain.head ? `${t.chain.head.seq} ${t.chain.head.hash.slice(0, 24)}…` : "empty"} />
            </Details>
          </Panel>
          <p className="px-1 text-[0.8rem] text-ink-soft">Keys: space plays or pauses, arrows step, Home and End jump.</p>
        </aside>
      </div>
    </>
  );
}

function Replay({ steps, shown, playing, onPlay, onPause, go, current }: { steps: TraceStep[]; shown: number; playing: boolean; onPlay: () => void; onPause: () => void; go: (to: number) => void; current?: TraceStep }) {
  const n = steps.length;
  return (
    <div className="sticky top-0 z-10 -mx-4 mt-3 border-b border-concrete-deep bg-concrete/95 px-4 py-2.5 backdrop-blur-sm sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => go(0)} disabled={shown === 0}>
          Restart
        </Button>
        <Button onClick={() => go(shown - 1)} disabled={shown === 0}>
          Back
        </Button>
        {playing ? (
          <Button kind="primary" onClick={onPause} className="min-w-[7.5rem]">
            Pause
          </Button>
        ) : (
          <Button kind="primary" onClick={onPlay} className="min-w-[7.5rem]">
            {shown >= n ? "Replay" : shown === 0 ? "Play" : "Continue"}
          </Button>
        )}
        <Button onClick={() => go(shown + 1)} disabled={shown >= n}>
          Next step
        </Button>
        <Button onClick={() => go(n)} disabled={shown >= n}>
          Show all
        </Button>
        <p className="ml-1 min-w-0 flex-1 truncate text-[0.9rem]" aria-live="polite">
          {shown === 0 ? (
            <span className="text-ink-soft">Ready: {n} steps, about {Math.round(Math.min(3.5, Math.max(1.2, 30 / Math.max(1, n))) * n)} seconds</span>
          ) : (
            <>
              <span className="font-semibold tabular">
                Step {shown} of {n}
              </span>{" "}
              <span className="text-ink-soft">{current && `${PHASE_WORD[current.phase]}: ${fi(current.title)}`}</span>
            </>
          )}
        </p>
      </div>
      <div className="mt-2 flex h-3 gap-[3px]" role="group" aria-label="Steps">
        {steps.map((s, i) => (
          <button
            key={s.seq}
            type="button"
            onClick={() => go(i + 1)}
            title={`${i + 1}. ${PHASE_WORD[s.phase]}: ${s.title}`}
            aria-label={`Go to step ${i + 1}: ${PHASE_WORD[s.phase]}`}
            className={`h-full min-w-[6px] flex-1 ring-ink ${i < shown ? (s.tone === "safety" ? "bg-safety ring-1" : "bg-ink") : s.tone === "safety" ? "bg-safety/30" : "bg-concrete-deep"} ${i === shown - 1 ? "ring-2 ring-offset-1 ring-offset-concrete" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

type StationProps = {
  s: TraceStep;
  index: number;
  last: boolean;
  state: "past" | "current" | "future";
  elapsed: number;
  claims: TraceView["claims"];
  checked?: "recomputed" | "linked";
  onOpen: () => void;
  ref?: React.Ref<HTMLLIElement>;
};

function Station({ s, index, last, state, elapsed, claims, checked, onOpen, ref }: StationProps) {
  const future = state === "future";
  const tone = future ? "hollow" : s.tone === "safety" ? "safety" : "ink";
  return (
    <li ref={ref} className={`relative grid grid-cols-[76px_28px_minmax(0,1fr)] gap-x-2 ${future ? "opacity-45" : ""}`}>
      <div className="pt-3 text-right text-[0.78rem] leading-tight tabular text-ink-soft">
        <p className="font-semibold text-ink">{whenSeconds(s.at)}</p>
        <p>+{span(elapsed)}</p>
      </div>
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className={`absolute top-6 bottom-0 w-0.5 ${future ? "bg-concrete-deep" : "bg-ink"}`} />}
        <span className="relative mt-3 bg-concrete">
          <Target size={20} tone={tone} />
        </span>
      </div>
      <div className="pb-3 pt-2">
        {future ? (
          <button type="button" onClick={onOpen} className="w-full py-1 text-left text-[0.9rem] text-ink-soft hover:text-ink">
            {index + 1}. {PHASE_WORD[s.phase]}
          </button>
        ) : (
          <article className={`border bg-paper ${s.tone === "safety" ? "border-ink shadow-[inset_4px_0_0_var(--color-safety)]" : "border-concrete-deep"} ${state === "current" ? "ring-2 ring-ink" : ""}`}>
            <div className="px-4 py-2.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[0.78rem] text-ink-soft">
                <span className="font-semibold text-ink">
                  {index + 1}. {PHASE_WORD[s.phase]}
                </span>
                <span>{s.actor}</span>
                {checked && <span title="Checked in this browser">{checked === "recomputed" ? "entry re-hashed here" : "entry checked by link"}</span>}
              </p>
              <h3 className="mt-0.5 font-display text-[1.18rem] font-bold leading-snug">{fi(s.title)}</h3>
              {s.lines.map((l, i) => (
                <p key={i} className="mt-0.5 max-w-[80ch] text-[0.92rem] leading-snug">
                  {fi(l)}
                </p>
              ))}
              {s.facts.length > 0 && (
                <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[0.85rem]">
                  {s.facts
                    .filter((f) => !/^(Quote|Order|Code)$/.test(f.label))
                    .map((f) => (
                      <div key={f.label} className="flex gap-1.5">
                        <dt className="text-ink-soft">{f.label}</dt>
                        <dd className="font-semibold">{fi(f.value)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              {s.products && s.products.length > 0 && <Products rows={s.products} />}
              {s.untouched && <p className="mt-1.5 text-[0.85rem] font-semibold">{s.untouched.replace(/(\d),(\d{3})/g, "$1 $2")}</p>}
              {s.excluded && s.excluded.length > 0 && <Excluded groups={s.excluded} />}
              {s.checks && <Checks checks={s.checks} />}
              {s.applied && s.applied.length > 0 && (
                <ul className="mt-1.5 text-[0.86rem]">
                  {s.applied.map((a, i) => (
                    <li key={i}>
                      <b>{fi(a.text)}</b> applied{a.by ? `: stated by ${a.by}` : ""}
                      {a.at ? ` on ${a.at.length > 10 ? when(a.at) : a.at.split("-").reverse().slice(0, 2).join(".") + "."}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {s.memory && s.memory.length > 0 && (
                <p className="mt-1.5 text-[0.82rem] text-ink-soft">Also used the kitchen&apos;s own memory ({s.memory.join("; ")}); items the kitchen keeps private are not shown here.</p>
              )}
              {s.claimIds && s.claimIds.length > 0 && <Claims ids={s.claimIds} claims={claims} />}
            </div>
            <div className="border-t border-concrete px-4 py-1.5">
              <Details summary={`Ledger entry ${s.ledger.seq}`}>
                <KV k="type" v={s.ledger.type} />
                <KV k="actor" v={s.ledger.actor} />
                <KV k="hash" v={s.ledger.hash} />
                <KV k="prev" v={s.ledger.prevHash} />
                {s.facts
                  .filter((f) => /^(Quote|Order|Code)$/.test(f.label))
                  .map((f) => (
                    <KV key={f.label} k={f.label.toLowerCase()} v={f.value} />
                  ))}
                {s.checks?.map((c) => (
                  <KV key={c.rule} k={c.rule} v={c.outcome} />
                ))}
                <p className="whitespace-pre-wrap font-sans text-[0.78rem]">As written: {s.ledger.summary}</p>
              </Details>
            </div>
          </article>
        )}
      </div>
    </li>
  );
}

function Products({ rows }: { rows: NonNullable<TraceStep["products"]> }) {
  return (
    <ul className="mt-2 divide-y divide-concrete border-y border-concrete text-[0.86rem]">
      {rows.map((p) => (
        <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1">
          <span className="font-semibold">{p.name}</span>
          {p.note && (
            <span className={`text-right ${p.tone === "safety" ? "text-ink" : "text-ink-soft"}`}>
              {p.tone === "safety" && <span aria-hidden className="mr-1.5 inline-block h-2 w-2 bg-safety ring-1 ring-ink" />}
              {fi(p.note)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Excluded({ groups }: { groups: NonNullable<TraceStep["excluded"]> }) {
  return (
    <div className="mt-2">
      <p className="text-[0.82rem] font-semibold">Ruled out, and why</p>
      <ul className="mt-0.5 grid gap-x-6 text-[0.85rem] md:grid-cols-2">
        {groups.map((g) => (
          <li key={g.reason} className="flex gap-2 py-0.5">
            <span className="w-8 shrink-0 text-right font-semibold tabular">{num(g.count)}</span>
            <span>
              {g.reason}
              <span className="block text-[0.78rem] text-ink-soft">e.g. {g.examples.join("; ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The gate's inspection sheet: what stopped or escalated first, then everything that passed. */
function Checks({ checks }: { checks: Check[] }) {
  const hits = checks.filter((c) => c.outcome !== "pass");
  const passes = checks.filter((c) => c.outcome === "pass");
  return (
    <div className="mt-2">
      {hits.length > 0 && (
        <ul className="space-y-1">
          {hits.map((c) => (
            <li key={c.rule} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 text-[0.88rem]">
              <span className={`self-start px-1.5 py-0.5 text-center text-[0.78rem] font-bold ${c.outcome === "fail" ? "bg-ink text-safety" : "bg-safety text-safety-ink"}`}>
                {c.outcome === "fail" ? "Refused" : "Needs a person"}
              </span>
              <span>
                <b>{c.title}</b>
                {c.reason && <span className="block text-ink-soft">{fi(c.reason)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-1.5" open={hits.length === 0}>
        <summary className="cursor-pointer text-[0.85rem] font-semibold">
          {passes.length} of {checks.length} checks passed
        </summary>
        <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-[0.84rem] md:grid-cols-2">
          {passes.map((c) => (
            <li key={c.rule} className="flex gap-2" title={c.reason ? fi(c.reason) : undefined}>
              <span aria-hidden className="mt-[0.45em] inline-block h-1.5 w-1.5 shrink-0 bg-ink" />
              <span>
                {c.title}
                {c.reason && <span className="block text-[0.78rem] text-ink-soft">{fi(c.reason)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Signed claims this step issued or rests on: verify them here against the published keys. */
function Claims({ ids, claims }: { ids: string[]; claims: TraceView["claims"] }) {
  const [results, setResults] = useState<Record<string, TokenCheck>>();
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => ids.map((id) => claims[id]).filter(Boolean), [ids, claims]);
  async function run() {
    setBusy(true);
    const out: Record<string, TokenCheck> = {};
    for (const c of known) out[c.claimId] = await verifyToken(c.token);
    setResults(out);
    setBusy(false);
  }
  if (!known.length) return <p className="mt-1.5 text-[0.82rem] text-ink-soft">{ids.length} signed claims named; their tokens are not on this server any more.</p>;
  const ok = results && Object.values(results).filter((r) => r.ok).length;
  return (
    <div className="mt-2 border-t border-concrete pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy}>
          {busy ? "Verifying…" : `Verify the ${known.length} signed claims`}
        </Button>
        {results && (
          <p className="text-[0.86rem]" role="status">
            {ok === known.length ? (
              <>
                <b>All {ok} verify</b> against the wholesaler&apos;s published key, in this browser.
              </>
            ) : (
              <span className="bg-safety px-1 font-semibold text-safety-ink">
                {known.length - (ok ?? 0)} of {known.length} do not verify
              </span>
            )}
          </p>
        )}
      </div>
      {results && (
        <ul className="mt-1.5 grid gap-x-6 text-[0.82rem] md:grid-cols-2">
          {known.map((c) => {
            const r = results[c.claimId];
            return (
              <li key={c.claimId} className="py-0.5">
                <span className="font-semibold">{c.type}</span> of {c.productId}: {r?.ok ? claimLine(r.payload) : r ? r.problem : "…"}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function claimLine(p: Record<string, unknown>): string {
  const subject = (p.credentialSubject ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const until = typeof p.validUntil === "string" ? `, valid until ${when(p.validUntil)}` : "";
  if (subject.price) return `${fi(`€${(Number(subject.price.unitPriceCents) / 100).toFixed(2)}`)} per ${String(subject.price.per ?? "pack")}${until}`;
  if (subject.availability) {
    const a = subject.availability as { deliveryDate?: string; stock?: { known?: boolean; packs?: number | null }; cutoffPassed?: boolean };
    return `delivery ${a.deliveryDate ?? "?"}, stock ${a.stock?.known ? `${a.stock.packs} packs` : "not reported"}${a.cutoffPassed ? ", cut-off passed" : ""}${until}`;
  }
  if (subject.origin) return `origin ${String((subject.origin as { countryOfOrigin?: string | null }).countryOfOrigin ?? "not stated")}${until}`;
  return `signed${until}`;
}
