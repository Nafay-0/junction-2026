"use client";

import Link from "next/link";
import { Bot, ChevronRight, Smartphone } from "lucide-react";
import { Badge, Tag } from "../../../_ui/kit";
import { Target } from "../../../_ui/target";
import type { Overview, Safeguards } from "@/server/ops/views";
import { fi, num, pct, when, whenSeconds } from "../../_ui/format";
import { Details, Empty, KV, LiveMark, LoadError, Loading, PageHead, Section, ViaTag, useOps } from "../../_ui/kit";
import { FilterBar, useUrlState } from "../../_ui/filters";
import { Funnel } from "../../_ui/parts";

const WHERE: Record<string, string> = { gate: "At the gate", door: "At the door", quote: "When quoting", intake: "During the intake", operations: "By operations staff" };

/** Rules whose answer is "a person decides" rather than "no": they mark the line of the agent's autonomy. */
const ESCALATES = new Set(["per_order_limit", "substitution_rule", "order_splitting"]);

export function SafeguardsView() {
  const live = useOps<Safeguards>("/ops-api/safeguards", { pollMs: 3000 });
  const counts = useOps<Overview>("/ops-api/overview", { pollMs: 5000 }).data?.counters;
  const s = live.data;
  return (
    <>
      <PageHead
        title="Safeguards"
        purpose="What an agent may decide alone, what needs a person, and what is refused outright: the rule book exactly as the code runs it, grouped by what each rule protects, with how often it fired and its latest cases."
        right={s && <LiveMark at={whenSeconds(s.at)} error={live.error} />}
      />
      <LoadError message={live.error} />
      {!s ? <Loading /> : <Body s={s} counts={counts} />}
    </>
  );
}

function Body({ s, counts }: { s: Safeguards; counts?: Overview["counters"] }) {
  const [q, setQ] = useUrlState("q", "");
  const [show, setShow] = useUrlState("show", "all");
  const needle = q.trim().toLowerCase();
  const all = s.groups.flatMap((g) => g.rules);
  const fired = all.filter((r) => r.refused + r.sentToPerson > 0).length;
  const groups = s.groups
    .map((g) => ({
      ...g,
      rules: g.rules.filter((r) => (show === "all" || (show === "fired" ? r.refused + r.sentToPerson > 0 : ESCALATES.has(r.rule))) && (!needle || `${r.title} ${r.does} ${r.rule}`.toLowerCase().includes(needle))),
    }))
    .filter((g) => g.rules.length);
  return (
    <>
      <Autonomy s={s} counts={counts} />

      <div className="mt-2 grid grid-cols-1 gap-x-8 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <Section title="The rule book" aside={`${all.length} rules, ${fired} fired so far`}>
            <FilterBar
              q={q}
              setQ={setQ}
              placeholder="Find a rule: budget, allergen, signature…"
              options={[
                { id: "all", label: "Every rule", count: all.length },
                { id: "fired", label: "Fired", count: fired },
                { id: "person", label: "Hands to a person", count: all.filter((r) => ESCALATES.has(r.rule)).length },
              ]}
              value={show}
              setValue={setShow}
            />
            {groups.length === 0 && <Empty title="No rule matches">Clear the search or choose Every rule.</Empty>}
            {groups.map((g) => (
              <section key={g.id} aria-labelledby={`g-${g.id}`} className="mb-8">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-1">
                  <h3 id={`g-${g.id}`} className="display text-[1.2rem]">
                    {g.title}
                  </h3>
                  <p className="text-[0.86rem] text-ink-soft">{g.blurb}</p>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                  {g.rules.map((r) => (
                    <Rule key={r.rule} r={r} />
                  ))}
                </ul>
              </section>
            ))}
          </Section>
        </div>

        <div className="2xl:sticky 2xl:top-[4.5rem] 2xl:max-h-[calc(100dvh-5.5rem)] 2xl:self-start 2xl:overflow-y-auto">
          <Section title="The partner's live price service" id="live">
            <div className="rounded-xl border border-line bg-paper p-5">
              <Funnel catalogue={s.live.catalogue} considered={s.live.considered} priced={s.live.distinctPriced} />
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg bg-surface p-4">
                <Figure n={pct(s.live.avoidedShare)} label="of products looked at were never sent for a live price" />
                <Figure n={pct(s.live.catalogueUntouchedShare)} label="of the catalogue never priced" />
                <Figure n={num(s.live.liveCalls)} label={`live calls, ${num(s.live.productsPriced)} product lookups in all`} />
                <Figure n={num(s.live.searches)} label="master-data searches, free and local" />
              </dl>
              <p className="mt-4 text-[0.9rem] leading-relaxed text-ink-soft">
                At most <b>{s.live.limits.maxPerCall}</b> products per live call. Per agent, <b>{s.live.limits.maxCallsPerAgent}</b> calls and <b>{s.live.limits.maxProductsPerAgent}</b> different products in {s.live.limits.windowMinutes} minutes; quotes count too.{" "}
                {s.live.refusedLookups ? <b className="text-ink">{s.live.refusedLookups} lookups were refused by the limit.</b> : "No lookup has hit the limit yet."}
              </p>
            </div>
          </Section>

          <ReadTwice r={s.secondReading} />

          <Section title="Refused attempts" aside="What was tried, and the rule that stopped it">
            {s.refusedFeed.length === 0 ? (
              <Empty title="Nothing refused yet">Ask an agent for more than the weekly budget, or call the API with a changed mandate: the refusal appears here with its rule.</Empty>
            ) : (
              <ol className="max-h-[70vh] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-paper">
                {s.refusedFeed.map((c) => (
                  <li key={`${c.seq}-${c.rule}`} className="px-5 py-3.5 text-[0.9rem] leading-snug">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[0.84rem] text-ink-soft">
                      <span>
                        <span className="tabular">{when(c.at)}</span> <b className="font-semibold text-ink">{c.orgName}</b>
                      </span>
                      <ViaTag via={c.via} short />
                    </p>
                    <p className="mt-1.5">
                      <Badge tone="refused">{ruleWord(c, s)}</Badge>
                    </p>
                    <p className="mt-1.5 text-ink-soft">
                      <span className="text-ink">{fi(c.tried)}.</span> {fi(c.reason)}
                    </p>
                    {c.requestId && (
                      <Link href={`/ops/trace/${c.requestId}`} className="mt-1.5 inline-flex items-center gap-1 text-[0.86rem] font-medium text-petrol hover:underline">
                        Open the trace <ChevronRight aria-hidden size={14} />
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

/**
 * Autonomy at a glance: every gate decision so far as one bar (alone, a person, refused), and the three answers the
 * gate can give, each with the rules that give it. This is the line between what the agent decides and what it may not.
 */
function Autonomy({ s, counts }: { s: Safeguards; counts?: Overview["counters"] }) {
  const all = s.groups.flatMap((g) => g.rules);
  const decisions = s.totals.decisions;
  // Outcomes, from the order records: bought alone; bought or waiting after the gate handed it to a person; refused.
  const alone = counts?.byAgentAlone ?? 0;
  const toPerson = counts ? counts.byPerson + counts.waiting : s.totals.sentToPerson;
  const refused = counts?.refused ?? s.totals.refused;
  const total = Math.max(1, alone + toPerson + refused);
  const escalators = all.filter((r) => ESCALATES.has(r.rule));
  const tiers = [
    { key: "alone", n: alone, title: "The agent decides alone", body: "Inside the mandate the kitchen signed: allowed product groups, its requirements and allergens, in time, within the per-order limit and the weekly budget.", bar: "bg-petrol" },
    { key: "person", n: toPerson, title: "A named person signs off", body: `On their own phone, for exactly this order, when ${escalators.map((r) => r.title.charAt(0).toLowerCase() + r.title.slice(1)).join("; ")}.`, bar: "bg-safety" },
    { key: "refused", n: refused, title: "Refused, whoever asks", body: "No sign-off lifts these: a forged or expired mandate, a changed quote, a forbidden allergen, the weekly budget, a suspended agent.", bar: "bg-safety-ink" },
  ];
  return (
    <section aria-labelledby="autonomy" className="rounded-xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="autonomy" className="display text-[1.35rem] sm:text-[1.45rem]">
          Where the agent&apos;s autonomy ends
        </h2>
        <p className="text-[0.86rem] text-ink-soft tabular">
          {num(decisions)} gate decisions and {num(refused)} refusals so far
        </p>
      </div>
      <div className="mt-4 flex h-2.5 w-full gap-1" role="img" aria-label={`${alone} decided alone, ${toPerson} sent to a person, ${refused} refused`}>
        {tiers.map((t) => (t.n > 0 ? <span key={t.key} className={`rounded-full ${t.bar}`} style={{ flex: `${t.n} 1 0%` }} title={`${t.title}: ${t.n}`} /> : null))}
        {alone + toPerson + refused === 0 && <span className="flex-1 rounded-full bg-surface" />}
      </div>
      <ul className="mt-4 grid gap-3 lg:grid-cols-3">
        {tiers.map((t) => (
          <li
            key={t.key}
            className={t.key === "refused" ? "hazard-frame on-dark text-paper" : t.key === "person" ? "rounded-lg bg-safety-soft ring-1 ring-inset ring-safety/60" : "rounded-lg bg-petrol-soft"}
          >
            <div className="px-4 pb-4 pt-3.5">
              <p className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  {t.key === "alone" ? (
                    <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-petrol text-paper">
                      <Bot size={17} />
                    </span>
                  ) : t.key === "person" ? (
                    <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-safety text-safety-ink">
                      <Smartphone size={17} />
                    </span>
                  ) : (
                    <Target size={30} tone="safety" />
                  )}
                  <span className={`display text-[1.15rem] leading-tight ${t.key === "refused" ? "text-safety" : ""}`}>{t.title}</span>
                </span>
                <span className={`display text-[2rem] leading-none tabular ${t.key === "refused" ? "text-safety" : ""}`}>{num(t.n)}</span>
              </p>
              <p className={`mt-2 text-[0.9rem] leading-snug ${t.key === "refused" ? "text-paper/85" : "text-ink-soft"}`}>{t.body}</p>
              <p className={`mt-2 text-[0.8rem] tabular ${t.key === "refused" ? "text-paper/65" : "text-ink-soft"}`}>{Math.round((t.n / total) * 100)} % of outcomes so far</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9rem] text-ink-soft">
        Operations staff hold one more safeguard: suspending an agent or a whole organisation, which refuses its next call until someone resumes it.
        <Link href="/ops/control" className="inline-flex items-center gap-1 font-medium text-petrol hover:underline">
          Suspend or resume in Control <ChevronRight aria-hidden size={15} />
        </Link>
      </p>
    </section>
  );
}

function Rule({ r }: { r: Safeguards["groups"][number]["rules"][number] }) {
  const fired = r.refused + r.sentToPerson;
  const runs = r.passed + fired;
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1.15fr)_11rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">{r.title}</span>
          {ESCALATES.has(r.rule) && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-safety-soft px-2 text-[0.76rem] font-medium leading-5 text-safety-ink ring-1 ring-inset ring-safety/50">
              <Smartphone aria-hidden size={12} />
              hands it to a person
            </span>
          )}
        </p>
        <p className="mt-1 text-[0.9rem] leading-snug text-ink-soft">{r.does}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[0.8rem] text-ink-soft">
          <Tag tone="muted">{WHERE[r.where] ?? r.where}</Tag>
          <Details summary="Rule id">
            <KV k="rule" v={r.rule} />
          </Details>
        </div>
      </div>
      {/* how often it fired: one bar per rule, passed in petrol, to a person in yellow, refused in black */}
      <div className="text-[0.88rem] tabular">
        {runs === 0 ? (
          <p className="mt-1 text-ink-soft">Not run yet</p>
        ) : (
          <>
            <div className="mt-1.5 flex h-2 gap-[3px]" role="img" aria-label={`Passed ${r.passed}, to a person ${r.sentToPerson}, refused ${r.refused}`}>
              {r.passed > 0 && <span className="rounded-full bg-petrol/30" style={{ flex: `${r.passed} 1 0%` }} />}
              {r.sentToPerson > 0 && <span className="rounded-full bg-safety" style={{ flex: `${Math.max(r.sentToPerson, runs / 25)} 1 0%` }} />}
              {r.refused > 0 && <span className="rounded-full bg-safety-ink" style={{ flex: `${Math.max(r.refused, runs / 25)} 1 0%` }} />}
            </div>
            <p className="mt-2 leading-snug">
              {r.refused > 0 && <b className="font-semibold">{num(r.refused)} refused</b>}
              {r.refused > 0 && r.sentToPerson > 0 && ", "}
              {r.sentToPerson > 0 && <b className="font-semibold">{num(r.sentToPerson)} to a person</b>}
              {fired === 0 && <span className="text-ink-soft">Never fired</span>}
              <span className="text-ink-soft">, passed {num(r.passed)}</span>
            </p>
          </>
        )}
      </div>
      <div className="min-w-0 text-[0.88rem]">
        {r.recent.length === 0 ? (
          <p className="text-ink-soft">No cases yet.</p>
        ) : (
          <ul className="space-y-2">
            {r.recent.map((c) => (
              <li key={`${c.seq}-${c.rule}`} className="leading-snug">
                <span className="text-ink-soft tabular">{when(c.at)}</span> <b className="font-semibold">{c.orgName}</b>{" "}
                {c.requestId ? (
                  <Link href={`/ops/trace/${c.requestId}`} className="text-petrol decoration-petrol/40 underline-offset-2 hover:underline">
                    {fi(c.reason) || "open the trace"}
                  </Link>
                ) : (
                  <span>{fi(c.reason)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const UNAVAILABLE: Record<string, string> = { timeout: "late", at_capacity: "provider at capacity", failed: "failed", unreadable: "unreadable answer", over_limit: "daily model limit", not_a_purchase: "not read as an order", not_configured: "not configured", other_item: "read another of several items" };

/**
 * The second reader: every request a model reads is read again, at the same moment, by an independent open-weights
 * model. Plain code compares the two; a difference that matters becomes one question for the buyer. It never decides.
 */
function ReadTwice({ r }: { r: Safeguards["secondReading"] }) {
  const total = r.agreed + r.differed + r.unavailable;
  const { first, second } = r.readers;
  return (
    <Section title="Read twice" id="read-twice" aside="Two readers, different makers; plain code compares">
      <div className="rounded-xl border border-line bg-paper p-5">
        {total === 0 ? (
          <Empty title="No request read twice yet">With DOCK_SECOND_READER_MODEL set, every typed or spoken request is read again by an independent model before any price is fixed.</Empty>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg bg-surface p-4">
              <Figure n={num(r.agreed)} label="agreed: nothing asked" />
              <Figure n={num(r.differed)} label="differed: the buyer was asked" />
              <Figure n={num(r.unavailable)} label="read once: second reader unavailable" />
            </dl>
            <p className="mt-4 text-[0.9rem] leading-relaxed">
              {first.length ? <b>{first.join(", ")}</b> : "The interpreter"} reads first; {second.length ? <b>{second.join(", ")}</b> : "the second reader"} reads again. The second reading can only add a question: the order goes on the first reading, and the gate decides as always.
              {r.unavailable > 0 && (
                <span className="text-ink-soft">
                  {" "}
                  Unavailable: {Object.entries(r.unavailableBy).map(([k, n]) => `${UNAVAILABLE[k] ?? k} ${n}`).join(", ")}.
                </span>
              )}
            </p>
            {r.settled.keptFirst + r.settled.tookSecond + r.settled.rewrote > 0 && (
              <p className="mt-2 text-[0.9rem] text-ink-soft">
                Buyers kept the first reading {num(r.settled.keptFirst)} times, took the second {num(r.settled.tookSecond)}, wrote it again {num(r.settled.rewrote)}.
              </p>
            )}
            {r.recent.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[0.88rem]">
                {r.recent.map((c) => (
                  <li key={c.seq} className="leading-snug">
                    <span className="text-ink-soft tabular">{when(c.at)}</span> <b>{c.orgName}</b>: differed on {c.fields.join(", ")}{" "}
                    {c.requestId && (
                      <Link href={`/ops/trace/${c.requestId}`} className="font-medium text-petrol hover:underline">
                        Open the trace
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function ruleWord(c: Safeguards["refusedFeed"][number], s: Safeguards): string {
  for (const g of s.groups) for (const r of g.rules) if (r.rule === c.rule) return r.title;
  return "A rule of the gate";
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="display text-[1.65rem] leading-none tabular">{n}</dd>
      <p className="mt-1 text-[0.82rem] leading-snug text-ink-soft">{label}</p>
    </div>
  );
}
