"use client";

import { clock, money } from "../_ui/plain";
import { Target } from "../_ui/target";
import type { AttackResult, OutsideRun } from "@/server/show/types";
import { GatePanel } from "./gate-moment";
import { css } from "./css";
import { titleOf } from "./words";

/**
 * Acts two and three on the stage. Act two: the attack just run, large, in the gate's language (refused, or sent
 * to a person, with the rule named), and the ones before it in a column. Act three: an outside agent's calls as
 * they reach the gate, and what the gate decided.
 */
export type AttackMeta = { id: string; key: string; title: string; tried: string };

const HOW: Record<AttackResult["how"], string> = {
  refused: "Refused at the gate",
  person: "Held for the named person",
  stopped: "Stopped before any price",
  allowed: "Let through",
  error: "Could not run",
};

export function AttackBoard({ attacks, results, busy, recording }: { attacks: AttackMeta[]; results: AttackResult[]; busy?: string; recording?: string }) {
  const latest = results.at(-1);
  return (
    <section className={`${css.stage} flex h-full min-h-0 flex-col px-[clamp(0.9rem,2vw,2.6rem)] py-[clamp(0.6rem,1.4vw,1.8rem)]`} aria-label="Now try to break it">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className={`display ${css.day}`}>Now try to break it</h2>
        {recording && <span className={`rounded-full bg-paper/[0.12] px-[0.8em] py-[0.15em] font-medium ${css.small}`}>Recording of real runs, {recording}</span>}
      </div>
      <div className="mt-[clamp(0.6rem,1.2vw,1.4rem)] grid min-h-0 flex-1 gap-[clamp(0.8rem,2vw,2.4rem)] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-h-0">
          {busy && !latest?.id.startsWith(busy) && <p className={`text-paper/85 ${css.lead}`}>Trying: {attacks.find((a) => a.id === busy)?.tried}</p>}
          {latest ? <AttackSlab key={latest.id + latest.at} r={latest} /> : !busy && <p className={`max-w-[50ch] text-paper/85 ${css.lead}`}>Each key sends one attack through the real gate with this kitchen&apos;s own agent credentials, or a forged copy of them. Press 1 to 6, or S to suspend the agent from the operations side.</p>}
        </div>
        <ol className="min-h-0 space-y-[clamp(0.3rem,0.5vw,0.7rem)] overflow-hidden">
          {attacks.map((a) => {
            const r = [...results].reverse().find((x) => x.id === a.id);
            const held = r && (r.how === "refused" || r.how === "person" || r.how === "stopped");
            return (
              <li key={a.id} className={`flex items-start gap-[0.8em] rounded-[clamp(12px,1.1vw,22px)] px-[1em] py-[0.7em] ${r ? "bg-paper/[0.1]" : "bg-paper/[0.04] text-paper/60"}`}>
                <kbd className={`display flex size-[1.7em] shrink-0 items-center justify-center rounded-[0.4em] bg-paper text-petrol-deep shadow-[0_2px_0_rgb(0_0_0/0.25)] ${css.lead}`}>{a.key}</kbd>
                <div className="min-w-0">
                  <p className={`font-semibold ${css.body}`}>{a.title}</p>
                  {r && (
                    <p className={`flex items-center gap-[0.4em] ${held ? "text-safety" : "text-paper/85"} ${css.small}`}>
                      {held ? <Target size={18} tone="safety" className="size-[1.05em] shrink-0" /> : null}
                      {HOW[r.how]}
                      {r.rule ? `: ${titleOf(r.rule)}` : ""}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function AttackSlab({ r }: { r: AttackResult }) {
  const loud = r.held;
  const body = (
    <>
      <p className={`text-paper/80 ${css.small}`}>Tried: {r.tried}</p>
      <p className={`mt-3 text-paper ${css.body}`}>{r.message}</p>
      {r.notes.map((n) => (
        <p key={n} className={`mt-1 text-paper/75 ${css.small}`}>
          {n}
        </p>
      ))}
      <p className={`mt-3 text-paper/65 ${css.small}`}>
        {r.status ? `HTTP ${r.status}` : ""}
        {r.code ? `, ${r.code}` : ""} at {clock(r.at)}. Written to the ledger.
      </p>
    </>
  );
  if (!loud) {
    return (
      <div className={`rounded-[clamp(18px,1.6vw,32px)] bg-paper/[0.07] p-[clamp(0.9rem,1.4vw,1.8rem)] ring-1 ring-inset ring-paper/15 ${css.slabIn}`}>
        <p className={`display ${css.title}`}>
          {r.title}: {HOW[r.how]}
        </p>
        {body}
      </div>
    );
  }
  return (
    <div role="group" aria-label={r.title} className={`on-dark relative overflow-hidden rounded-[clamp(18px,1.6vw,32px)] bg-safety-ink shadow-[inset_0_0_0_1px_rgb(255_194_14/0.28),0_30px_80px_-30px_rgb(0_0_0/0.6)] ${css.slabIn}`}>
      <div aria-hidden className="relative h-[clamp(0.6rem,0.9vw,1.1rem)] overflow-hidden">
        <span className={`hazard absolute inset-y-0 left-0 w-1/2 ${css.armLeft}`} />
        <span className={`hazard absolute inset-y-0 right-0 w-1/2 ${css.armRight}`} />
      </div>
      <div className="p-[clamp(0.9rem,1.5vw,2rem)]">
        <div className="flex items-start gap-[clamp(0.7rem,1.2vw,1.6rem)]">
          <Target size={72} tone="safety" className="size-[clamp(2.6rem,3.8vw,5rem)] shrink-0" />
          <div className="min-w-0">
            <p className={`display leading-[0.92] text-safety ${css.gate}`}>{HOW[r.how]}</p>
            <p className={`mt-2 text-paper ${css.lead}`}>
              {r.title}. {r.rule ? <>The rule: <strong>{titleOf(r.rule)}</strong>.</> : null}
            </p>
          </div>
        </div>
        <div className="mt-[clamp(0.7rem,1.1vw,1.4rem)] rounded-[clamp(10px,0.9vw,18px)] bg-paper/[0.06] px-[1.1em] py-[0.9em]">{body}</div>
      </div>
    </div>
  );
}

export function OutsideBoard({ run, idle }: { run?: OutsideRun; idle?: string }) {
  return (
    <section className={`${css.stage} flex h-full min-h-0 flex-col px-[clamp(0.9rem,2vw,2.6rem)] py-[clamp(0.6rem,1.4vw,1.8rem)]`} aria-label="Any agent can order">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className={`display ${css.day}`}>Any agent can order</h2>
        {run?.source === "recording" && <span className={`rounded-full bg-paper/[0.12] px-[0.8em] py-[0.15em] font-medium ${css.small}`}>Recording of a real run{run.recordedAt ? `, ${clock(run.recordedAt)}` : ""}</span>}
      </div>
      {!run ? (
        <p className={`mt-4 max-w-[56ch] text-paper/85 ${css.lead}`}>{idle ?? "Press A to send in an outside agent. It gets no special door: only the open MCP interface any agent can use, and the same gate."}</p>
      ) : (
        <div className="mt-[clamp(0.6rem,1.2vw,1.4rem)] grid min-h-0 flex-1 gap-[clamp(0.8rem,2vw,2.4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-h-0 space-y-3">
            <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ${css.body}`}>
              <dt className="text-paper/70">Agent</dt>
              <dd>{run.runner === "aiven" ? "Aiven-hosted buyer (Managed Agents)" : "A reference buyer agent"}, on {run.model}</dd>
              <dt className="text-paper/70">Door</dt>
              <dd>{run.door}</dd>
              <dt className="text-paper/70">Buys for</dt>
              <dd>{run.kitchenName}</dd>
            </dl>
            <figure className="rounded-[clamp(14px,1.2vw,24px)] bg-paper/[0.07] px-[clamp(0.8rem,1.3vw,1.6rem)] py-[clamp(0.6rem,1vw,1.3rem)]">
              <figcaption className={`text-paper/65 ${css.small}`}>Its task</figcaption>
              <blockquote className={`mt-[0.2em] ${css.lead}`}>&ldquo;{run.task}&rdquo;</blockquote>
            </figure>
            {run.outcome && <p className={`display ${css.title}`}>{run.outcome}</p>}
            {run.gate && <GatePanel step={{ kind: "standing", day: "", title: "", status: "done", asked: "", did: [], memory: [], options: [], excluded: [], simulated: [], decisions: 0, askedPerson: 0, refused: 0, requestIds: [], orderIds: [], liveCalls: 0, gate: run.gate }} />}
            {run.costUsd !== undefined && <p className={`text-paper/70 ${css.small}`}>Model cost of this run: ${run.costUsd.toFixed(4)}{run.totalCents !== undefined ? `; order ${money(run.totalCents)}` : ""}.</p>}
          </div>
          <ol className="min-h-0 space-y-[clamp(0.25rem,0.4vw,0.55rem)] overflow-hidden" aria-label="Its calls at the door" aria-live="polite">
            {run.events.slice(-9).map((e, i) => (
              <li key={i + e.at} className={`grid grid-cols-[0.6em_minmax(0,1fr)] items-start gap-x-[0.7em] rounded-[clamp(10px,0.9vw,18px)] bg-paper/[0.07] px-[0.9em] py-[0.5em] ${css.small} ${css.lineIn}`}>
                <span aria-hidden className={`mt-[0.45em] size-[0.55em] rounded-full ${e.kind === "error" ? "bg-safety" : e.kind === "model" ? "bg-lavender-mid" : "bg-paper/55"}`} />
                <span>{e.text}</span>
              </li>
            ))}
            {run.state === "running" && <li className={`px-[0.9em] py-[0.5em] text-paper/70 ${css.small} ${css.breathe}`}>Working…</li>}
          </ol>
        </div>
      )}
    </section>
  );
}
