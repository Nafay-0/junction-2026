"use client";

import Link from "next/link";
import type { Safeguards } from "@/server/ops/views";
import { fi, num, pct, when, whenSeconds } from "../../_ui/format";
import { Details, Empty, KV, LoadError, Loading, PageHead, Panel, Section, ViaTag, useOps } from "../../_ui/kit";

const WHERE: Record<string, string> = { gate: "at the gate", door: "at the door", quote: "when quoting", intake: "during the intake", operations: "by operations staff" };

export function SafeguardsView() {
  const live = useOps<Safeguards>("/ops-api/safeguards", { pollMs: 3000 });
  const s = live.data;
  return (
    <>
      <PageHead
        title="Safeguards"
        purpose="The rule book exactly as the code runs it, in plain words, grouped by what each rule protects, with how often it fired. Every refusal names its rule."
        right={s && <span className="tabular">Updated {whenSeconds(s.at)}</span>}
      />
      <LoadError message={live.error} />
      {!s ? <Loading /> : <Body s={s} />}
    </>
  );
}

function Body({ s }: { s: Safeguards }) {
  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div>
          <p className="text-[0.9rem] text-ink-soft">
            {num(s.totals.decisions)} gate decisions so far: {num(s.totals.sentToPerson)} times a rule sent the order to a person, {num(s.totals.refused)} refusals in all.
          </p>
          {s.groups.map((g) => (
            <Section key={g.id} title={g.title} aside={g.blurb}>
              <Panel>
                <ul className="divide-y divide-concrete">
                  {g.rules.map((r) => (
                    <li key={r.rule} className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)]">
                      <div>
                        <p className="font-semibold">{r.title}</p>
                        <p className="text-[0.86rem] leading-snug text-ink-soft">
                          {r.does} <span className="whitespace-nowrap">Checked {WHERE[r.where] ?? r.where}.</span>
                        </p>
                        <Details summary="Rule id" className="mt-0.5">
                          <KV k="rule" v={r.rule} />
                        </Details>
                      </div>
                      <div className="text-[0.86rem] tabular">
                        {r.refused + r.sentToPerson === 0 ? (
                          <p className="text-ink-soft">Not fired{r.passed ? `; passed ${num(r.passed)}×` : ""}</p>
                        ) : (
                          <>
                            {r.refused > 0 && (
                              <p>
                                <span className="bg-safety px-1 font-bold text-safety-ink">{num(r.refused)} refused</span>
                              </p>
                            )}
                            {r.sentToPerson > 0 && (
                              <p className="mt-0.5">
                                <span className="bg-safety/60 px-1 font-semibold">{num(r.sentToPerson)} to a person</span>
                              </p>
                            )}
                            {r.passed > 0 && <p className="mt-0.5 text-ink-soft">passed {num(r.passed)}×</p>}
                          </>
                        )}
                      </div>
                      <div className="text-[0.84rem]">
                        {r.recent.length === 0 ? (
                          <p className="text-ink-soft">No cases yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {r.recent.map((c) => (
                              <li key={`${c.seq}-${c.rule}`} className="leading-snug">
                                <span className="tabular text-ink-soft">{when(c.at)}</span> <b>{c.orgName}</b>{" "}
                                {c.requestId ? (
                                  <Link href={`/ops/trace/${c.requestId}`} className="underline decoration-concrete-deep underline-offset-2 hover:decoration-ink">
                                    {fi(c.reason) || "open trace"}
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
                  ))}
                </ul>
              </Panel>
            </Section>
          ))}
        </div>

        <div className="2xl:sticky 2xl:top-4 2xl:self-start">
          <Section title="The partner's live price service" id="live">
            <Panel className="px-4 py-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Figure n={pct(s.live.avoidedShare)} label="of products looked at were never sent for a live price" />
                <Figure n={pct(s.live.catalogueUntouchedShare)} label={`of the ${num(s.live.catalogue)}-product catalogue never priced`} />
                <Figure n={num(s.live.liveCalls)} label={`live calls, ${num(s.live.productsPriced)} product lookups in all`} />
                <Figure n={num(s.live.searches)} label="master-data searches, free and local" />
              </div>
              <p className="mt-3 border-t border-concrete pt-2 text-[0.86rem] leading-snug">
                Limits: at most <b>{s.live.limits.maxPerCall}</b> products per live call; per agent, <b>{s.live.limits.maxCallsPerAgent}</b> calls and <b>{s.live.limits.maxProductsPerAgent}</b> different products in {s.live.limits.windowMinutes} minutes. Quotes count too.
              </p>
              <p className="mt-1 text-[0.86rem]">
                {s.live.refusedLookups ? <span className="bg-safety px-1 font-semibold text-safety-ink">{s.live.refusedLookups} lookups refused by the limit</span> : "No lookup has hit the limit."}
              </p>
            </Panel>
          </Section>

          <Section title="Refused attempts" aside="What was tried, and the rule that stopped it">
            {s.refusedFeed.length === 0 ? (
              <Empty title="Nothing refused yet">Try placing an order over the weekly budget from a kitchen, or call the API with a changed mandate: the refusal shows here with its rule.</Empty>
            ) : (
              <Panel>
                <ol className="max-h-[70vh] divide-y divide-concrete overflow-y-auto">
                  {s.refusedFeed.map((c) => (
                    <li key={`${c.seq}-${c.rule}`} className="px-4 py-2 text-[0.86rem] leading-snug">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span>
                          <span className="tabular text-ink-soft">{when(c.at)}</span> <b>{c.orgName}</b>
                        </span>
                        <ViaTag via={c.via} />
                      </p>
                      <p className="mt-0.5">
                        {fi(c.tried)}. <span className="bg-safety px-1 font-semibold text-safety-ink">Stopped: {ruleWord(c, s)}</span>
                      </p>
                      <p className="mt-0.5 text-ink-soft">
                        {fi(c.reason)}
                        {c.requestId && (
                          <>
                            {" "}
                            <Link href={`/ops/trace/${c.requestId}`} className="underline underline-offset-2">
                              Trace
                            </Link>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function ruleWord(c: Safeguards["refusedFeed"][number], s: Safeguards): string {
  for (const g of s.groups) for (const r of g.rules) if (r.rule === c.rule) return r.title.toLowerCase();
  return c.rule.replaceAll("_", " ");
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <p className="font-display text-[1.8rem] font-bold leading-none tabular">{n}</p>
      <p className="mt-1 text-[0.8rem] leading-snug text-ink-soft">{label}</p>
    </div>
  );
}
