"use client";

import Link from "next/link";
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
              <section key={g.id} aria-labelledby={`g-${g.id}`} className="mb-6">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 border-b-[3px] border-petrol pb-1.5">
                  <h3 id={`g-${g.id}`} className="display text-[1.35rem]">
                    {g.title}
                  </h3>
                  <p className="text-[0.88rem] text-ink-soft">{g.blurb}</p>
                </div>
                <ul className="divide-y divide-line/70 bg-paper">
                  {g.rules.map((r) => (
                    <Rule key={r.rule} r={r} />
                  ))}
                </ul>
              </section>
            ))}
          </Section>
        </div>

        <div className="2xl:sticky 2xl:top-4 2xl:max-h-[calc(100dvh-2rem)] 2xl:self-start 2xl:overflow-y-auto">
          <Section title="The partner's live price service" id="live">
            <div className="bg-paper px-4 py-4">
              <div aria-hidden className="-mx-4 -mt-4 mb-4 h-[3px] bg-petrol" />
              <Funnel catalogue={s.live.catalogue} considered={s.live.considered} priced={s.live.distinctPriced} />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/70 pt-3">
                <Figure n={pct(s.live.avoidedShare)} label="of products looked at were never sent for a live price" />
                <Figure n={pct(s.live.catalogueUntouchedShare)} label="of the catalogue never priced" />
                <Figure n={num(s.live.liveCalls)} label={`live calls, ${num(s.live.productsPriced)} product lookups in all`} />
                <Figure n={num(s.live.searches)} label="master-data searches, free and local" />
              </dl>
              <p className="mt-3 border-t border-line/70 pt-2 text-[0.9rem] leading-snug">
                At most <b>{s.live.limits.maxPerCall}</b> products per live call. Per agent, <b>{s.live.limits.maxCallsPerAgent}</b> calls and <b>{s.live.limits.maxProductsPerAgent}</b> different products in {s.live.limits.windowMinutes} minutes; quotes count too.{" "}
                {s.live.refusedLookups ? <b>{s.live.refusedLookups} lookups were refused by the limit.</b> : "No lookup has hit the limit yet."}
              </p>
            </div>
          </Section>

          <Section title="Refused attempts" aside="What was tried, and the rule that stopped it">
            {s.refusedFeed.length === 0 ? (
              <Empty title="Nothing refused yet">Ask an agent for more than the weekly budget, or call the API with a changed mandate: the refusal appears here with its rule.</Empty>
            ) : (
              <ol className="max-h-[70vh] divide-y divide-line/70 overflow-y-auto bg-paper">
                {s.refusedFeed.map((c) => (
                  <li key={`${c.seq}-${c.rule}`} className="px-4 py-2.5 text-[0.9rem] leading-snug">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[0.85rem] text-ink-soft">
                      <span>
                        <span className="tabular">{when(c.at)}</span> <b className="text-ink">{c.orgName}</b>
                      </span>
                      <ViaTag via={c.via} short />
                    </p>
                    <p className="mt-1">
                      <span className="text-ink-soft">{fi(c.tried)}. </span>
                      <span className="bg-safety-ink px-1.5 py-px font-semibold text-safety">{ruleWord(c, s)}</span>
                    </p>
                    <p className="mt-1 text-ink-soft">
                      {fi(c.reason)}
                      {c.requestId && (
                        <>
                          {" "}
                          <Link href={`/ops/trace/${c.requestId}`} className="font-semibold text-petrol underline underline-offset-2">
                            Open the trace
                          </Link>
                        </>
                      )}
                    </p>
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
    { key: "alone", n: alone, title: "The agent decides alone", body: "Inside the mandate the kitchen signed: allowed product groups, its requirements and allergens, in time, within the per-order limit and the weekly budget.", look: "bg-petrol text-paper", bar: "bg-petrol" },
    { key: "person", n: toPerson, title: "A named person signs off", body: `On their own phone, for exactly this order, when ${escalators.map((r) => r.title.charAt(0).toLowerCase() + r.title.slice(1)).join("; ")}.`, look: "border-l-[10px] border-safety bg-paper", bar: "hazard-thin" },
    { key: "refused", n: refused, title: "Refused, whoever asks", body: "No sign-off lifts these: a forged or expired mandate, a changed quote, a forbidden allergen, the weekly budget, a suspended agent.", look: "bg-safety-ink text-paper", bar: "bg-safety-ink" },
  ];
  return (
    <section aria-labelledby="autonomy" className="bg-paper">
      <div aria-hidden className="h-[3px] bg-petrol" />
      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="autonomy" className="display text-[1.6rem]">
            Where the agent&apos;s autonomy ends
          </h2>
          <p className="text-[0.88rem] text-ink-soft tabular">
            {num(decisions)} gate decisions and {num(refused)} refusals so far
          </p>
        </div>
        <div className="mt-3 flex h-4 w-full gap-[3px]" role="img" aria-label={`${alone} decided alone, ${toPerson} sent to a person, ${refused} refused`}>
          {tiers.map((t) => (t.n > 0 ? <span key={t.key} className={t.bar} style={{ flex: `${t.n} 1 0%` }} title={`${t.title}: ${t.n}`} /> : null))}
          {alone + toPerson + refused === 0 && <span className="flex-1 bg-mist" />}
        </div>
        <ul className="mt-3 grid gap-2 lg:grid-cols-3">
          {tiers.map((t) => (
            <li key={t.key} className={`px-4 py-3 ${t.look}`}>
              <p className="flex items-baseline justify-between gap-3">
                <span className="display text-[1.3rem] leading-tight">{t.title}</span>
                <span className={`display text-[2rem] leading-none tabular ${t.key === "refused" ? "text-safety" : ""}`}>{num(t.n)}</span>
              </p>
              <p className={`mt-1 text-[0.9rem] leading-snug ${t.key === "person" ? "text-ink-soft" : "text-paper/85"}`}>{t.body}</p>
              <p className={`mt-1 text-[0.8rem] tabular ${t.key === "person" ? "text-ink-soft" : "text-paper/70"}`}>{Math.round((t.n / total) * 100)} % of outcomes so far</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.9rem] text-ink-soft">
          Operations staff hold one more safeguard: suspending an agent or a whole organisation, which refuses its next call until someone resumes it.{" "}
          <Link href="/ops/control" className="font-semibold text-petrol underline underline-offset-2">
            Suspend or resume in Control
          </Link>
        </p>
      </div>
    </section>
  );
}

function Rule({ r }: { r: Safeguards["groups"][number]["rules"][number] }) {
  const fired = r.refused + r.sentToPerson;
  const runs = r.passed + fired;
  return (
    <li className={`grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.15fr)_12rem_minmax(0,1fr)] ${fired ? "" : "text-ink/90"}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{r.title}</span>
          {ESCALATES.has(r.rule) && <span className="text-[0.8rem] font-semibold text-ink-soft">hands it to a person</span>}
        </p>
        <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">{r.does}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.8rem] text-ink-soft">
          <span>{WHERE[r.where] ?? r.where}</span>
          <Details summary="Rule id">
            <KV k="rule" v={r.rule} />
          </Details>
        </div>
      </div>
      {/* how often it fired: one bar per rule, passed in petrol, to a person in yellow, refused in black */}
      <div className="text-[0.88rem] tabular">
        {runs === 0 ? (
          <p className="text-ink-soft">Not run yet</p>
        ) : (
          <>
            <div className="flex h-2.5 gap-[2px]" role="img" aria-label={`Passed ${r.passed}, to a person ${r.sentToPerson}, refused ${r.refused}`}>
              {r.passed > 0 && <span className="bg-petrol/35" style={{ flex: `${r.passed} 1 0%` }} />}
              {r.sentToPerson > 0 && <span className="bg-safety" style={{ flex: `${Math.max(r.sentToPerson, runs / 25)} 1 0%` }} />}
              {r.refused > 0 && <span className="bg-safety-ink" style={{ flex: `${Math.max(r.refused, runs / 25)} 1 0%` }} />}
            </div>
            <p className="mt-1.5 leading-snug">
              {r.refused > 0 && <b>{num(r.refused)} refused</b>}
              {r.refused > 0 && r.sentToPerson > 0 && ", "}
              {r.sentToPerson > 0 && <b>{num(r.sentToPerson)} to a person</b>}
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
          <ul className="space-y-1.5">
            {r.recent.map((c) => (
              <li key={`${c.seq}-${c.rule}`} className="leading-snug">
                <span className="text-ink-soft tabular">{when(c.at)}</span> <b>{c.orgName}</b>{" "}
                {c.requestId ? (
                  <Link href={`/ops/trace/${c.requestId}`} className="text-petrol underline decoration-line underline-offset-2 hover:decoration-petrol">
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

function ruleWord(c: Safeguards["refusedFeed"][number], s: Safeguards): string {
  for (const g of s.groups) for (const r of g.rules) if (r.rule === c.rule) return r.title;
  return "A rule of the gate";
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="display text-[1.8rem] leading-none tabular">{n}</dd>
      <p className="mt-1 text-[0.82rem] leading-snug text-ink-soft">{label}</p>
    </div>
  );
}
