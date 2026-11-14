"use client";

import { useMemo, useState } from "react";
import type { TraceStep } from "@/server/ops/trace";
import type { TraceView } from "@/server/ops/views";
import { Check, Minus, Quote, Sparkles, X } from "lucide-react";
import { Badge, Field } from "../../../../_ui/kit";
import { fi, num, when } from "../../../_ui/format";
import { Button } from "../../../_ui/kit";
import { CheckGrid, CountBar, Table } from "../../../_ui/parts";
import { verifyToken, type TokenCheck } from "../../../_ui/verify-client";

/** What each kind of step is called on the lane. */
export const PHASE_WORD: Record<TraceStep["phase"], string> = {
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
  committed: "Signed order",
  declined: "Declined",
  refused: "Refused",
  control: "Operations",
  other: "Step",
};

/** The station a step belongs to on the strip: a few names, so the strip reads from across the table. */
export function stationOf(s: TraceStep): string {
  switch (s.phase) {
    case "checked":
    case "answered":
      return "Kitchen";
    case "chosen":
      return "Options";
    case "declined":
      return "Declined";
    default:
      return PHASE_WORD[s.phase];
  }
}

/** One line for a folded station and for the transport's caption. */
export function summaryOf(s: TraceStep): string {
  if (s.phase === "asked" && s.lines[0]) return s.lines[0];
  if (s.phase === "gate" && s.checks?.length) {
    const hits = s.checks.filter((c) => c.outcome !== "pass");
    const fail = hits.find((c) => c.outcome === "fail");
    if (fail) return `Refused: ${fail.title.toLowerCase()}`;
    if (hits.length) return `${hits.length === 1 ? "One check" : `${hits.length} checks`} sent it to a person: ${hits.map((h) => h.title.toLowerCase()).join(", ")}`;
    return `All ${s.checks.length} checks passed`;
  }
  return fi(s.title);
}

// ---------- the body of an open station, per phase ----------

export function StationBody({ s, claims, animate, dark = false }: { s: TraceStep; claims: TraceView["claims"]; animate: boolean; dark?: boolean }) {
  const facts = s.facts.filter((f) => !/^(Quote|Order|Code|Named product)$/.test(f.label));
  return (
    <div className="mt-2.5">
      {s.phase === "asked" ? (
        <>
          {s.lines.map((l, i) => (
            <blockquote key={i} className="flex max-w-[64ch] gap-3 rounded-lg bg-surface px-4 py-3.5 sm:px-5">
              <Quote aria-hidden size={18} className="mt-1 shrink-0 text-petrol" fill="currentColor" strokeWidth={0} />
              <p className="text-[1.12rem] font-medium leading-snug sm:text-[1.2rem]">{fi(l)}</p>
            </blockquote>
          ))}
          <Facts facts={facts} />
        </>
      ) : s.phase === "understood" ? (
        <>
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 rounded-lg bg-surface px-4 py-3.5 md:grid-cols-4">
              {facts.map((f) => (
                <Field key={f.label} label={f.label}>
                  {fi(f.value)}
                </Field>
              ))}
            </dl>
          )}
          <Lines lines={s.lines} />
        </>
      ) : s.phase === "refused" ? (
        <div className={`mt-1 rounded-lg ${dark ? "bg-paper/6" : "bg-safety-ink text-paper"} px-4 py-3 ${animate ? "barrier-left" : ""}`}>
          <p className="flex items-center gap-2 text-[1rem] font-semibold text-safety">
            <X aria-hidden size={17} strokeWidth={2.8} /> The gate said no, and named the rule.
          </p>
          {s.lines.map((l, i) => (
            <p key={i} className="mt-1 max-w-[80ch] leading-snug text-paper/90">
              {fi(l)}
            </p>
          ))}
        </div>
      ) : s.phase === "gate" ? (
        <>
          <Lines lines={s.lines.filter((l) => !s.checks?.some((c) => c.reason && fi(c.reason) === fi(l)))} dark={dark} />
          <Facts facts={facts} dark={dark} />
          {s.checks && (
            <div className="mt-4">
              <p className={`mb-2.5 text-[0.88rem] ${dark ? "text-paper/70" : "text-ink-soft"}`}>
                {s.checks.length} checks, run by plain code on the exact order: {s.checks.filter((c) => c.outcome === "pass").length} passed
                {s.checks.some((c) => c.outcome === "escalate") ? `, ${s.checks.filter((c) => c.outcome === "escalate").length} sent it to a person` : ""}
                {s.checks.some((c) => c.outcome === "fail") ? `, ${s.checks.filter((c) => c.outcome === "fail").length} refused it` : ""}.
              </p>
              <CheckGrid checks={s.checks} dark={dark} stagger={animate} />
            </div>
          )}
        </>
      ) : s.phase === "signoff" ? (
        <SignOff s={s} facts={facts} animate={animate} />
      ) : s.phase === "committed" ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg bg-good-soft px-4 py-3.5">
          <span className={`inline-flex items-center gap-2 rounded-full bg-good py-1.5 pl-2 pr-4 text-paper ${animate ? "stamp" : ""}`}>
            <Check aria-hidden size={18} strokeWidth={3} />
            <span className="display text-[1.2rem]">Signed</span>
          </span>
          <div className="min-w-0 flex-1">
            <Lines lines={s.lines} tight />
            <Facts facts={facts} />
          </div>
        </div>
      ) : (
        <>
          <Lines lines={s.lines} dark={dark} />
          <Facts facts={facts} dark={dark} />
        </>
      )}

      {s.phase === "searched" && s.products && s.products.length > 0 && <ProductList rows={s.products} />}
      {s.phase === "priced" && s.products && <LiveCheck rows={s.products} untouched={s.untouched} />}
      {s.phase === "quoted" && s.products && <QuoteLines rows={s.products} />}
      {s.phase === "options" && s.products && s.products.length > 0 && <Options rows={s.products} />}
      {s.excluded && s.excluded.length > 0 && <Excluded groups={s.excluded} />}
      {s.applied && s.applied.length > 0 && (
        <ul className="mt-3.5 space-y-1.5 rounded-lg bg-lavender px-4 py-3 text-[0.94rem]">
          {s.applied.map((a, i) => (
            <li key={i} className="flex gap-2.5">
              <Sparkles aria-hidden size={15} className="mt-[0.2em] shrink-0 text-lavender-deep" />
              <span>
                <b className="font-semibold">{fi(a.text)}</b>, applied from the kitchen&apos;s memory{a.by ? `: stated by ${a.by}` : ""}
                {a.at ? `, ${a.at.length > 10 ? when(a.at) : fi(a.at)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.memory && s.memory.length > 0 && (
        <p className={`mt-2.5 flex gap-2 text-[0.88rem] ${dark ? "text-paper/70" : "text-ink-soft"}`}>
          <Sparkles aria-hidden size={14} className="mt-[0.2em] shrink-0 text-lavender-deep" />
          Also used the kitchen&apos;s own memory ({s.memory.join("; ")}). What the kitchen keeps private is named here, never shown.
        </p>
      )}
      {s.claimIds && s.claimIds.length > 0 && <Claims ids={s.claimIds} claims={claims} />}
    </div>
  );
}

function Lines({ lines, tight = false, dark = false }: { lines: string[]; tight?: boolean; dark?: boolean }) {
  if (!lines.length) return null;
  return (
    <div className={`space-y-0.5 ${tight ? "" : "mt-1"}`}>
      {lines.map((l, i) => (
        <p key={i} className={`max-w-[76ch] text-[0.97rem] leading-relaxed ${dark ? "text-paper/88" : ""}`}>
          {fi(l)}
        </p>
      ))}
    </div>
  );
}

function Facts({ facts, dark = false }: { facts: { label: string; value: string }[]; dark?: boolean }) {
  if (!facts.length) return null;
  return (
    <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 text-[0.9rem]">
      {facts.map((f) => (
        <div key={f.label} className="flex items-baseline gap-1.5">
          <dt className={dark ? "text-paper/65" : "text-ink-soft"}>{f.label}</dt>
          <dd className="font-semibold tabular">{fi(f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- products ----------

function ProductList({ rows }: { rows: NonNullable<TraceStep["products"]> }) {
  return (
    <ol className="mt-3.5 divide-y divide-line/70 rounded-lg border border-line text-[0.93rem]">
      {rows.map((p, i) => (
        <li key={p.id} className="flex gap-3 px-4 py-2">
          <span className="w-6 shrink-0 text-right text-ink-soft tabular">{i + 1}</span>
          <span className="min-w-0">{p.name}</span>
        </li>
      ))}
    </ol>
  );
}

/** A live-check note ("€1.01 per pack, stock not reported, delivery Mon 16.11., order by Sun 15.11. 17.00") as columns. */
function splitOffer(note = "") {
  const parts = fi(note).split(/, (?=[a-z€\d])/);
  const out: { price?: string; stock?: string; delivery?: string; orderBy?: string; problem?: string } = {};
  for (const raw of parts) {
    const p = raw.trim();
    if (/^cannot be quoted|^no offer/.test(p)) out.problem = p.replace(/^cannot be quoted: /, "");
    else if (/€/.test(p) && !out.price) out.price = p.replace(/ per pack$/, "");
    else if (/stock/.test(p)) out.stock = p;
    else if (/^delivery /.test(p)) out.delivery = p.replace(/^delivery /, "");
    else if (/^later than asked/.test(p)) out.delivery = `${out.delivery ?? ""}, later than asked`;
    else if (/cut-off|^order by/.test(p)) out.orderBy = p.replace(/^order by /, "");
  }
  return out;
}

function LiveCheck({ rows, untouched }: { rows: NonNullable<TraceStep["products"]>; untouched?: string }) {
  return (
    <>
      <Table inset className="mt-3.5" label="Products sent for a live price check">
        <thead>
          <tr>
            <th>Product</th>
            <th className="text-right">Price per pack</th>
            <th>Stock</th>
            <th>Delivery</th>
            <th>Order by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const o = splitOffer(p.note);
            const problem = p.tone === "safety";
            return (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                {o.problem ? (
                  <td colSpan={4}>
                    <NotSo>{o.problem}</NotSo>
                  </td>
                ) : (
                  <>
                    <td className="whitespace-nowrap text-right tabular">{o.price ?? "–"}</td>
                    <td className="min-w-[8rem]">{o.stock ? /none in stock/.test(o.stock) ? <NotSo>none in stock</NotSo> : o.stock.replace(/^stock not reported$/, "not reported by the wholesaler") : "–"}</td>
                    <td className="whitespace-nowrap">{o.delivery ? /later than asked/.test(o.delivery) ? <NotSo>{o.delivery}</NotSo> : o.delivery : "–"}</td>
                    <td className="whitespace-nowrap">{o.orderBy ? /passed/.test(o.orderBy) ? <NotSo>{o.orderBy}</NotSo> : o.orderBy : problem ? "–" : "–"}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
      {untouched && (
        <p className="mt-2.5 flex items-center gap-2.5 text-[0.9rem] text-ink-soft">
          <span aria-hidden className="inline-block h-1.5 w-12 shrink-0 rounded-full bg-line-strong" />
          {fi(untouched).replace(/(\d),(\d{3})/g, "$1 $2")}
        </p>
      )}
    </>
  );
}

/** A fact that rules a product out: said plainly in ink with a cross, never in warning yellow (that is the gate's). */
function NotSo({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 font-medium text-ink">
      <X aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-ink-soft" />
      {children}
    </span>
  );
}

function QuoteLines({ rows }: { rows: NonNullable<TraceStep["products"]> }) {
  return (
    <Table inset className="mt-3.5" label="The quoted lines">
      <thead>
        <tr>
          <th>Product</th>
          <th className="text-right">Packs and price</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const note = fi(p.note);
          const [main, sub] = note.split(/, in place of /);
          return (
            <tr key={p.id}>
              <td className="font-medium">
                {p.name}
                {sub && <span className="mt-0.5 block text-[0.86rem] font-normal text-ink-soft">A substitute, in place of {sub}</span>}
              </td>
              <td className="whitespace-nowrap text-right tabular">{main}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Options as good, better, best columns. The rank word leads, then the total, then the lines and what it gives up. */
function Options({ rows }: { rows: NonNullable<TraceStep["products"]> }) {
  const cards = rows.map((p) => {
    const m = /^(?:(\w+): )?(option \d+|opt_\w+)(?: \((.+)\))?$/i.exec(p.name);
    const rank = m?.[1];
    const option = (m?.[2] ?? p.name).replace(/^opt_/, "option ");
    const labels = m?.[3];
    const note = fi(p.note);
    const total = /(\d[\d\s ]*,\d{2}\s?€)$/.exec(note)?.[1];
    const rest = total ? note.slice(0, note.length - total.length).replace(/,\s*$/, "") : note;
    const match = /^(meets the whole request|gives up [^,]+)/.exec(rest)?.[1];
    const lines = (match ? rest.slice(match.length).replace(/^,\s*/, "") : rest).split(" + ").filter(Boolean);
    return { id: p.id, rank, option, labels, total, match, lines, compromise: p.tone === "safety" };
  });
  return (
    <ul className={`mt-3.5 grid gap-2.5 ${cards.length >= 3 ? "lg:grid-cols-3" : cards.length === 2 ? "md:grid-cols-2" : ""}`}>
      {cards.map((c, i) => {
        const best = c.rank?.toLowerCase() === "best" || (!c.rank && i === 0);
        return (
          <li key={c.id} className={`flex flex-col rounded-lg border p-4 ${best ? "border-petrol/45" : "border-line"}`}>
            <p className="flex items-start justify-between gap-3">
              <span className={`rounded-full px-2.5 text-[0.76rem] font-semibold leading-6 ${best ? "bg-lime text-ink" : "bg-surface text-ink-soft"}`}>{c.rank ? c.rank.charAt(0).toUpperCase() + c.rank.slice(1) : c.option}</span>
              {c.total && <span className="display text-[1.35rem] leading-none tabular">{c.total}</span>}
            </p>
            {(c.rank || c.labels) && (
              <p className="mt-1.5 text-[0.82rem] text-ink-soft">
                {c.rank ? c.option : ""}
                {c.labels ? `${c.rank ? ", " : ""}${c.labels}` : ""}
              </p>
            )}
            <ul className="mt-2 space-y-1 text-[0.9rem] leading-snug">
              {c.lines.map((l, k) => (
                <li key={k}>{l}</li>
              ))}
            </ul>
            {c.match && (
              <p className={`mt-auto flex items-start gap-1.5 pt-3 text-[0.86rem] font-medium ${c.compromise ? "text-ink-soft" : "text-good"}`}>
                {c.compromise ? <Minus aria-hidden size={15} strokeWidth={2.6} className="mt-[0.15em] shrink-0 text-notice" /> : <Check aria-hidden size={15} strokeWidth={2.6} className="mt-[0.15em] shrink-0" />}
                {c.match.replace(/^./, (x) => x.toUpperCase())}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Excluded({ groups }: { groups: NonNullable<TraceStep["excluded"]> }) {
  const max = Math.max(...groups.map((g) => g.count));
  const total = groups.reduce((a, g) => a + g.count, 0);
  return (
    <div className="mt-5 border-t border-line/70 pt-4">
      <p className="text-[0.95rem] font-semibold">
        Ruled out, and why: {num(total)} product{total === 1 ? "" : "s"}
      </p>
      <div className="mt-2 grid gap-x-8 gap-y-1 md:grid-cols-2">
        {groups.map((g) => (
          <CountBar key={g.reason} count={g.count} max={max} label={g.reason.charAt(0).toUpperCase() + g.reason.slice(1)} sub={g.examples.length ? `For example ${g.examples.join("; ")}` : undefined} tone="ink" />
        ))}
      </div>
    </div>
  );
}

// ---------- sign-off ----------

function SignOff({ s, facts, animate }: { s: TraceStep; facts: { label: string; value: string }[]; animate: boolean }) {
  const decided = /approved|declined/.test(s.title);
  const approved = /approved/.test(s.title);
  return (
    <div className={`mt-1 flex flex-wrap items-start gap-x-6 gap-y-3 ${decided ? "" : "rounded-lg bg-safety-soft px-4 py-3.5 ring-1 ring-inset ring-safety/60"}`}>
      <div className="min-w-0 flex-1 basis-[22rem]">
        <Lines lines={s.lines} />
        <Facts facts={facts} />
      </div>
      {decided ? (
        <span className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 ${approved ? "bg-good text-paper" : "bg-surface text-ink ring-1 ring-inset ring-line-strong"} ${animate ? "stamp" : ""}`}>
          {approved ? <Check aria-hidden size={18} strokeWidth={3} /> : <X aria-hidden size={18} strokeWidth={2.6} />}
          <span className="display text-[1.2rem]">{approved ? "Approved" : "Declined"}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-full bg-safety px-3.5 py-1.5 text-[0.92rem] font-semibold text-safety-ink">
          <span aria-hidden className="breathe size-2 rounded-full bg-safety-ink" />A person decides
        </span>
      )}
    </div>
  );
}

// ---------- signed claims ----------

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
  if (!known.length) return <p className="mt-3 text-[0.88rem] text-ink-soft">{ids.length} signed claims are named here; their tokens are no longer on this server.</p>;
  const ok = results && Object.values(results).filter((r) => r.ok).length;
  return (
    <div className="mt-4 border-t border-line/70 pt-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy}>
          {busy ? "Verifying…" : `Verify the ${known.length} signed claims here`}
        </Button>
        {results ? (
          <p className="text-[0.92rem]" role="status">
            {ok === known.length ? (
              <>
                <b>All {ok} verify</b> against the wholesaler&apos;s published key, in this browser.
              </>
            ) : (
              <span className="rounded-full bg-safety-ink px-2.5 py-0.5 font-semibold text-safety">
                {known.length - (ok ?? 0)} of {known.length} do not verify
              </span>
            )}
          </p>
        ) : (
          <p className="text-[0.88rem] text-ink-soft">Price, stock and origin, each a W3C credential signed by the wholesaler.</p>
        )}
      </div>
      {results && (
        <Table inset className="mt-3" label="Signed claims">
          <thead>
            <tr>
              <th>Claim</th>
              <th>What it states</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {known.map((c) => {
              const r = results[c.claimId];
              return (
                <tr key={c.claimId}>
                  <td className="font-semibold capitalize">{c.type}</td>
                  <td>{r?.ok ? claimLine(r.payload) : r ? r.problem : "…"}</td>
                  <td>{r?.ok ? <Badge tone="good">Verified</Badge> : <Badge tone="refused">Does not verify</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function claimLine(p: Record<string, unknown>): string {
  const subject = (p.credentialSubject ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const until = typeof p.validUntil === "string" ? `, valid until ${fi(p.validUntil)}` : "";
  if (subject.price) return `${fi(`€${(Number(subject.price.unitPriceCents) / 100).toFixed(2)}`)} per ${fi(`per ${String(subject.price.per ?? "pack")}`).replace(/^per /, "")}${until}`;
  if (subject.availability) {
    const a = subject.availability as { deliveryDate?: string; stock?: { known?: boolean; packs?: number | null }; cutoffPassed?: boolean };
    return `Delivery ${a.deliveryDate ? fi(a.deliveryDate) : "not stated"}, stock ${a.stock?.known ? `${a.stock.packs} packs` : "not reported"}${a.cutoffPassed ? ", cut-off passed" : ""}${until}`;
  }
  if (subject.origin) {
    const c = (subject.origin as { countryOfOrigin?: string | null }).countryOfOrigin;
    return `Origin ${c ? (COUNTRY[c.toLowerCase()] ?? c.toUpperCase()) : "not stated"}${until}`;
  }
  return `Signed${until}`;
}

const COUNTRY: Record<string, string> = { fi: "Finland", se: "Sweden", ee: "Estonia", de: "Germany", dk: "Denmark", nl: "the Netherlands", no: "Norway", pl: "Poland", lt: "Lithuania", lv: "Latvia", fr: "France", it: "Italy", es: "Spain" };
