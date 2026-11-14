"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MirrorStatus } from "@/server/mariadb/mirror";
import type { Similar } from "@/server/mariadb/vector";
import type { Described, TimeMachineView } from "@/server/mariadb/service";
import type { Difference, Verdict } from "@/server/mariadb/replay";
import { Check, Database, Route } from "lucide-react";
import { api } from "../../../_client/api";
import { Badge, Select, Tag, buttonClass } from "../../../_ui/kit";
import { ruleTitle } from "../../../_ui/plain";
import { fi, money, when, whenSeconds } from "../../_ui/format";
import { Button, Details, Empty, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";
import { Stamp, Table } from "../../_ui/parts";
import { useUrlState } from "../../_ui/filters";
import { TIME_MACHINE_TEXT } from "./time-machine.text";

type Reply =
  | { attached: false; env: string; sentence: string }
  | { attached: true; server: string; status: MirrorStatus; health: { state: string; sentence: string }; vectors: string | null; view?: TimeMachineView; reachable?: false; sentence?: string };

const AREA = {
  mandate: { label: "Mandate", mark: "h-7 w-1 rounded-full bg-petrol" },
  kitchen_rule: { label: "Kitchen rule", mark: "h-5 w-1 rounded-full bg-lavender-deep" },
  hold: { label: "Recall hold", mark: "h-7 w-1.5 rounded-full hazard-thin" },
  suspension: { label: "Suspension", mark: "h-7 w-1.5 rounded-full bg-safety ring-1 ring-safety-ink/40" },
  budget: { label: "Weekly spend", mark: "h-2.5 w-0.5 rounded-full bg-ink-soft/50" },
} as const;

const RULE_EXTRA: Record<string, string> = { recall_hold: "No product on a recall hold", operator_suspension: "Not suspended by the wholesaler's staff" };
const titleOf = (rule: string) => RULE_EXTRA[rule] ?? ruleTitle(rule);
const stampKind = (o: Verdict["outcome"] | string) => (o === "auto_approve" ? "committed" : o === "needs_human_approval" ? "waiting" : o === "reject" || o === "refused_at_door" ? "refused" : "other");
const OUTCOME: Record<string, string> = { auto_approve: "Placed by the agent alone", needs_human_approval: "Needs a person's sign-off", reject: "Refused by the gate", refused_at_door: "Refused at the door", no_mandate: "No mandate in force" };
const RULE_OUTCOME: Record<string, string> = { pass: "passes", escalate: "a person signs", fail: "refused" };

export function TimeMachineScreen() {
  const [order, setOrder] = useUrlState("order", "");
  const [org, setOrg] = useUrlState("org", "");
  const [at, setAt] = useUrlState("at", "");
  const [request] = useUrlState("request", "");
  const path = `/ops-api/time-machine?${new URLSearchParams({ ...(order ? { order } : {}), ...(request && !order ? { request } : {}), ...(org && !order ? { org } : {}), ...(at ? { at } : {}) })}`;
  const live = useOps<Reply>(path, { pollMs: 20_000 });
  const r = live.data;
  return (
    <>
      <PageHead
        title={TIME_MACHINE_TEXT.en.title}
        purpose={TIME_MACHINE_TEXT.en.purpose}
        right={r?.attached ? <MirrorMark r={r} /> : undefined}
      />
      <LoadError message={live.error} />
      {!r ? (
        <Loading label="Asking MariaDB…" />
      ) : !r.attached ? (
        <NotAttached env={r.env} sentence={r.sentence} />
      ) : r.reachable === false || !r.view ? (
        <Empty title="MariaDB did not answer">{r.sentence ?? r.health.sentence}</Empty>
      ) : r.view.kitchens.length === 0 ? (
        <Empty title={TIME_MACHINE_TEXT.en.emptyTitle}>{TIME_MACHINE_TEXT.en.empty}</Empty>
      ) : (
        <Machine
          v={r.view}
          vectors={r.vectors}
          order={order}
          pick={(o) => {
            setOrder(o);
            setAt("");
          }}
          pickOrg={(o) => {
            setOrder("");
            setOrg(o);
          }}
          setAt={setAt}
        />
      )}
    </>
  );
}

function MirrorMark({ r }: { r: Extract<Reply, { attached: true }> }) {
  const ok = r.health.state === "current";
  return (
    <span className="inline-flex max-w-[30rem] items-start gap-2 text-right" role="status" title={r.health.sentence}>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? "breathe bg-good" : "border-[1.5px] border-ink-soft"}`} />
      <span>
        MariaDB at {r.server}. {ok ? `Mirror current${r.status.lastOkAt ? `, written ${whenSeconds(r.status.lastOkAt)}` : ""}.` : r.health.state === "behind" ? "The mirror is behind; ordering is not affected." : "The mirror cannot write just now; ordering is not affected."}
      </span>
    </span>
  );
}

function NotAttached({ env, sentence }: { env: string; sentence: string }) {
  return (
    <div className="mt-2 flex max-w-[82ch] flex-wrap gap-4 rounded-xl border border-dashed border-line-strong bg-paper/60 p-5 sm:p-6">
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-petrol-soft text-petrol">
        <Database size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="display text-[1.35rem]">No time machine on this deployment</p>
        <p className="mt-1.5 leading-relaxed">{sentence}</p>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
          To see it, run it locally against the pinned MariaDB (one command, from <code className="rounded-xs bg-surface px-1.5 py-0.5 text-[0.88em] text-ink">web/</code>): <code className="rounded-xs bg-surface px-1.5 py-0.5 text-[0.88em] text-ink">pnpm mariadb:reproduce</code>, then start the app with <code className="rounded-xs bg-surface px-1.5 py-0.5 text-[0.88em] text-ink">{env}</code> set to the address it prints. A hosted MariaDB 11.8 or later works the same way.
        </p>
      </div>
    </div>
  );
}

function Machine({ v, vectors, order, pick, pickOrg, setAt }: { v: TimeMachineView; vectors: string | null; order: string; pick: (o: string) => void; pickOrg: (o: string) => void; setAt: (iso: string) => void }) {
  const orders = v.orders.filter((o) => o.orgId === v.orgId);
  const [shown, setShown] = useState(v.at);
  const [prevAt, setPrevAt] = useState(v.at);
  if (prevAt !== v.at) {
    setPrevAt(v.at);
    setShown(v.at);
  }
  useEffect(() => {
    if (shown === v.at) return;
    const t = setTimeout(() => setAt(shown), 250);
    return () => clearTimeout(t);
  }, [shown, v.at, setAt]);

  const placed = v.order?.body.createdAt;
  const start = Math.min(...[...v.moments.map((m) => Date.parse(m.at)), placed ? Date.parse(placed) : Infinity, Date.parse(v.now) - 7 * 86_400_000]) - 3_600_000;
  const end = Date.parse(v.now);
  const pos = (iso: string) => `${Math.max(0, Math.min(100, ((Date.parse(iso) - start) / (end - start)) * 100))}%`;
  const relation = placed && Math.abs(Date.parse(shown) - Date.parse(placed)) <= 1 ? `the instant before ${shortId(v.order!.orderId)} arrived` : `${Math.max(0, Math.round((end - Date.parse(shown)) / 86_400_000))} days before now`;

  return (
    <div>
      {/* Pick an order or a kitchen */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Select label="Kitchen" value={v.orgId ?? ""} onChange={pickOrg} className="w-full sm:w-[16rem]">
          {v.kitchens.map((k) => (
            <option key={k.orgId} value={k.orgId}>
              {k.name}
            </option>
          ))}
        </Select>
        <Select label="Order" value={order || v.order?.orderId || ""} onChange={pick} className="w-full min-w-0 sm:w-[28rem] sm:max-w-full">
          <option value="">No order: pick a moment only</option>
          {orders.map((o) => (
            <option key={o.orderId} value={o.orderId}>
              {when(o.createdAt)}, {money(o.totalCents)}, {o.summary.slice(0, 60)} ({OUTCOME[o.outcome]?.toLowerCase() ?? o.outcome}{o.door ? `, via ${o.door === "mcp" || o.door === "rest" ? o.door.toUpperCase() : o.door}` : ""})
            </option>
          ))}
        </Select>
        {v.order && (
          <Link className={buttonClass("secondary", "md")} href={`/ops/trace/${v.order.body.requestId}`}>
            <Route aria-hidden size={16} />
            Open its trace
          </Link>
        )}
      </div>

      {/* The one bold thing: the time rail, with a mark for every moment a rule changed */}
      <div className="mt-6 rounded-xl border border-line bg-paper px-5 pb-5 pt-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p>
            <span className="display text-[2.1rem] tabular">{when(shown)}</span>
            <span className="ml-3 text-ink-soft">{relation}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {placed && (
              <Button kind="plain" onClick={() => setShown(new Date(Date.parse(placed) - 1).toISOString())}>
                The order&apos;s moment
              </Button>
            )}
            <Button kind="plain" onClick={() => setShown(new Date(end - 1000).toISOString())}>
              Now
            </Button>
          </div>
        </div>
        <div className="relative mt-3 h-9" aria-hidden>
          <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-line" />
          {v.moments.map((m, i) => (
            <button
              key={`${m.at}${i}`}
              type="button"
              tabIndex={-1}
              title={`${when(m.at)}: ${AREA[m.what as keyof typeof AREA]?.label ?? m.what}, ${m.by}`}
              onClick={() => setShown(m.at)}
              className={`absolute bottom-0 -translate-x-1/2 ${AREA[m.what as keyof typeof AREA]?.mark ?? "h-3 w-px bg-ink"}`}
              style={{ left: pos(m.at) }}
            />
          ))}
          {placed && <span className="absolute -top-1 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-ink" style={{ left: pos(placed) }} title="The order" />}
        </div>
        <input
          type="range"
          aria-label="Moment to look at"
          min={start}
          max={end}
          step={60_000}
          value={Math.min(end, Math.max(start, Date.parse(shown)))}
          onChange={(e) => setShown(new Date(Number(e.target.value)).toISOString())}
          className="block w-full accent-lime [&::-webkit-slider-thumb]:size-5"
        />
        <div className="mt-1 flex justify-between text-[0.82rem] text-ink-soft tabular">
          <span>{when(new Date(start).toISOString())}</span>
          <span>now, {when(v.now)}</span>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.82rem] text-ink-soft">
          {Object.entries(AREA).map(([k, a]) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={`inline-block ${a.mark.replace(/h-\S+/, "h-3")}`} />
              {a.label}
            </li>
          ))}
          {placed && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block border-x-[5px] border-t-[7px] border-x-transparent border-t-ink" />
              the order
            </li>
          )}
        </ul>
      </div>

      {v.replay && v.order && <Verdicts v={v} />}

      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
        <Section title={`The rules at ${when(v.at)}`} aside={`${v.orgName}`}>
          <RuleList rows={v.rulesAt} other={v.rulesNow} side="then" />
        </Section>
        <Section title="The rules now" aside={when(v.now)}>
          <RuleList rows={v.rulesNow} other={v.rulesAt} side="now" />
        </Section>
      </div>

      <Changes v={v} />

      {v.order && <Similar orderId={v.order.orderId} vectors={vectors} />}

      <Section title="How each answer was read">
        <p className="mb-2 max-w-[78ch] text-[0.95rem] leading-snug text-ink-soft">
          Each panel above is one statement on MariaDB. The tables are declared <code>WITH SYSTEM VERSIONING</code>: the app only inserts, updates and deletes current rows, and MariaDB keeps every earlier version with the moment it stopped being true. <code>gate_rules</code> is a view over the five of them, and <code>FOR SYSTEM_TIME</code> applied to the view reaches each table under it.
        </p>
        <Table label="Statements run for this page">
          <thead>
            <tr>
              <th>Question</th>
              <th>Rows</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {v.sql.map((s, i) => (
              <tr key={i}>
                <td>
                  <p>{s.label}</p>
                  <Details summary="The statement">
                    <pre className="whitespace-pre-wrap break-normal">{s.sql}</pre>
                    <p>Parameters: {JSON.stringify(s.params)}</p>
                  </Details>
                </td>
                <td className="tabular">{s.rows}</td>
                <td className="whitespace-nowrap tabular">{s.ms.toFixed(2).replace(".", ",")} ms</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}

function Verdicts({ v }: { v: TimeMachineView }) {
  const r = v.replay!;
  const o = v.order!;
  const sameMoment = Math.abs(Date.parse(v.at) - (Date.parse(o.body.createdAt) - 1)) <= 1;
  const diffs: Difference[] = r.atVsNow;
  return (
    <Section title="Would it pass today?" aside={`${o.summary}, ${money(o.totalCents)}${o.doorText ? `; came through ${o.doorText}` : ""}`}>
      <div className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
        <VerdictCard heading={sameMoment ? `When it arrived, ${when(o.body.createdAt)}` : `At ${when(v.at)}`} verdict={r.at} />
        <VerdictCard heading={`Today, ${when(v.now)}`} verdict={r.now} />
      </div>
      {diffs.length ? (
        <Table className="mt-3" label="The rules whose answer differs">
          <thead>
            <tr>
              <th>The rule that differs</th>
              <th>{sameMoment ? "Then" : `At ${when(v.at)}`}</th>
              <th>Now</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.rule}>
                <td className="font-semibold">{titleOf(d.rule)}</td>
                <td>{RULE_OUTCOME[d.then?.outcome ?? ""] ?? "not checked"}</td>
                <td className={d.at?.outcome === "fail" ? "font-semibold" : ""}>{RULE_OUTCOME[d.at?.outcome ?? ""] ?? "not checked"}</td>
                <td className="max-w-[46ch] text-ink-soft">{fi(d.at?.outcome === "pass" ? d.then?.reason : d.at?.reason)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="mt-3 flex items-center gap-2.5 rounded-lg bg-good-soft px-4 py-3">
          <Check aria-hidden size={17} strokeWidth={2.6} className="shrink-0 text-good" />
          Every rule gives the same answer {sameMoment ? "today as when it arrived" : "at both moments"}.</p>
      )}
      <ul className="mt-3 space-y-1 text-[0.92rem] leading-snug">
        <li>
          <b>The gate, run again:</b> the same pure function the order went through (<code>evaluatePolicy</code>), given the rules from MariaDB. The order&apos;s own facts stay as they were: its quote, prices, lines, the moment it was placed and the agent&apos;s mandate id and window; only the rules come from the moment chosen.
        </li>
        <li>
          <b>Against the rules the instant before it arrived</b>, the replay {r.reproduces.same ? "reproduces exactly what the gate decided then" : `differs from what the gate recorded then (${r.reproduces.rules.join(", ")})`}
          {r.mandateFromOrder
            ? ". The agent presented its mandate with this very order, a moment before the mirror wrote it, so the terms the order carried stand in for that instant"
            : r.termsDisagree.length
              ? `; the mirrored mandate differs from the one the order carried in ${r.termsDisagree.join(", ")}`
              : ", and the mirrored mandate terms match the mandate the order carried"}
          .
        </li>
        <li className="text-ink-soft">
          <b className="text-ink">What the kitchen reads on its order page:</b> {fi(r.kitchenSentence)}
        </li>
      </ul>
    </Section>
  );
}

function VerdictCard({ heading, verdict }: { heading: string; verdict: Verdict }) {
  const hits = verdict.rules.filter((x) => x.outcome !== "pass");
  return (
    <div className="p-5 sm:p-6">
      <p className="text-[0.88rem] text-ink-soft">{heading}</p>
      <div className="mt-2.5">
        <Stamp kind={stampKind(verdict.outcome)} label={OUTCOME[verdict.outcome]} />
      </div>
      <p className="mt-3 max-w-[60ch] text-[0.95rem] leading-snug">{fi(verdict.headline)}</p>
      <p className="mt-2 text-[0.85rem] text-ink-soft">
        {verdict.rules.length} checks; {hits.length ? `${hits.length} not passed: ${hits.map((h) => titleOf(h.rule).toLowerCase()).join("; ")}` : "all passed"}.
        {verdict.read.perOrderLimitCents !== undefined && ` Read: limit ${money(verdict.read.perOrderLimitCents)}, spent this week ${money(verdict.read.spentCents)} of ${money(verdict.read.weeklyBudgetCents)}.`}
      </p>
    </div>
  );
}

const sig = (r: Described) => `${r.area}|${r.item}`;
const sameValue = (a: Described, b: Described) => JSON.stringify({ ...a.value, issuedAs: 0 }) === JSON.stringify({ ...b.value, issuedAs: 0 });

function RuleList({ rows, other, side }: { rows: Described[]; other: Described[]; side: "then" | "now" }) {
  if (!rows.length) return <Empty title="Nothing in force">No mandate, rule, hold or suspension was in force for this kitchen at that moment.</Empty>;
  const order = ["mandate", "kitchen_rule", "hold", "suspension", "budget"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  return (
    <ul className="space-y-2">
      {sorted.map((r) => {
        const twin = other.find((o) => sig(o) === sig(r));
        const state = !twin ? (side === "now" ? "new since" : "gone by now") : sameValue(r, twin) ? "same" : "changed";
        const gate = r.area === "hold" || r.area === "suspension";
        return (
          <li key={sig(r)} className={`relative overflow-hidden rounded-lg border bg-paper py-3.5 pl-6 pr-4 ${state === "same" ? "border-line" : "border-petrol/45"}`}>
            <span aria-hidden className={`absolute inset-y-3 left-2.5 w-1 rounded-full ${gate ? (r.area === "hold" ? "hazard-thin" : "bg-safety") : state === "same" ? "bg-line-strong" : "bg-petrol"}`} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-semibold">{r.title}</p>
              {state !== "same" && <Badge tone="info">{state === "changed" ? "differs" : state}</Badge>}
            </div>
            <ul className="mt-1 space-y-0.5 text-[0.93rem] leading-snug">
              {r.lines.map((l, i) => {
                const moved = state === "changed" && twin && !twin.lines.includes(l);
                return (
                  <li key={i} className={moved ? "-mx-1.5 rounded-xs bg-lime-soft px-1.5 font-semibold" : ""}>
                    {fi(l)}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[0.82rem] text-ink-soft">
              In force since {when(r.since)}, set by {r.by}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Changes({ v }: { v: TimeMachineView }) {
  const [spend, setSpend] = useState(false);
  const main = v.changes.filter((c) => c.area !== "Weekly spend");
  const budget = v.changes.filter((c) => c.area === "Weekly spend");
  const list = spend ? v.changes : main;
  return (
    <Section title={`What changed between ${when(v.at)} and now`} aside={`${main.length} change${main.length === 1 ? "" : "s"} of rule${budget.length ? `, ${budget.length} of weekly spend` : ""}`}>
      {list.length === 0 ? (
        <Empty title="Nothing changed">Every rule this kitchen&apos;s orders are judged by is the same now as at {when(v.at)}.</Empty>
      ) : (
        <Table label="Changes, oldest first">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Changed by</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap tabular">{when(c.at)}</td>
                <td>
                  <span className="mr-2">
                    <Tag tone="muted">{c.area}</Tag>
                  </span>
                  {fi(c.what)}
                </td>
                <td className="text-ink-soft">{c.by}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {budget.length > 0 && (
        <button type="button" className={buttonClass("secondary", "sm", "mt-3")} onClick={() => setSpend(!spend)}>
          {spend ? "Hide the changes of weekly spend" : `Show the ${budget.length} changes of weekly spend too`}
        </button>
      )}
    </Section>
  );
}

function Similar({ orderId, vectors }: { orderId: string; vectors: string | null }) {
  const [res, setRes] = useState<{ available: boolean; reason?: string; rows?: Similar[]; sql?: string; ms?: number }>();
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState(orderId);
  if (prev !== orderId) {
    setPrev(orderId);
    setRes(undefined);
  }
  const rows = useMemo(() => res?.rows ?? [], [res]);
  async function run() {
    setBusy(true);
    const r = await api<{ similar: NonNullable<typeof res> }>("GET", `/ops-api/time-machine?similar=${encodeURIComponent(orderId)}`);
    setRes(r.ok ? r.data.similar : { available: false, reason: r.error.message });
    setBusy(false);
  }
  return (
    <Section title="Decisions like this one" aside={vectors ? `by meaning, ${vectors}` : "no embedding model on this deployment"}>
      <p className="mb-3 max-w-[78ch] text-[0.95rem] leading-snug text-ink-soft">
        The gate&apos;s plain-language decisions, nearest by meaning (MariaDB Vector), each with the mandate terms that were in force when it was made: one statement joining <code>VEC_DISTANCE_COSINE</code> over the vector index to <code>FOR SYSTEM_TIME ALL</code>. Measured on the seeded scenario: vector search found the right decisions in 44% of top-five slots on 10 questions over 78 templated decisions (MariaDB&apos;s keyword search: 20%). A small sample.
      </p>
      {!res ? (
        <Button kind="primary" disabled={busy || !vectors} onClick={() => void run()}>
          {busy ? "Searching…" : "Find decisions like this one"}
        </Button>
      ) : !res.available ? (
        <p className="rounded-lg bg-surface px-4 py-3">{res.reason}</p>
      ) : (
        <>
          <Table label="Nearest decisions">
            <thead>
              <tr>
                <th>Distance</th>
                <th>When</th>
                <th>Decision</th>
                <th>Mandate then</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i}>
                  <td className="tabular">{Math.max(0, s.distance).toFixed(3).replace(".", ",")}</td>
                  <td className="whitespace-nowrap tabular">
                    {when(s.at)}
                    {s.doorText && <span className="block text-[0.82rem] text-ink-soft">via {s.doorText}</span>}
                  </td>
                  <td className="max-w-[60ch]">
                    <p className="font-semibold">{OUTCOME[s.outcome] ?? s.outcome}{s.rulesHit.length ? `: ${s.rulesHit.map((x) => titleOf(x).toLowerCase()).join("; ")}` : ""}</p>
                    <p className="text-[0.88rem] text-ink-soft">{fi(s.explanation).slice(0, 260)}</p>
                  </td>
                  <td className="text-[0.88rem]">
                    {s.termsThen ? (
                      <>
                        {money(s.termsThen.perOrderLimitCents)} alone, {money(s.termsThen.weeklyBudgetCents)} a week{s.termsThen.forbiddenAllergens.length ? `, never ${s.termsThen.forbiddenAllergens.join(", ")}` : ""}
                        <span className="block text-ink-soft">since {when(s.termsThen.since)}</span>
                      </>
                    ) : (
                      <span className="text-ink-soft">not mirrored</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Details className="mt-2" summary={`The statement (${String(res.ms).replace(".", ",")} ms)`}>
            <pre className="whitespace-pre-wrap break-normal">{res.sql}</pre>
          </Details>
        </>
      )}
    </Section>
  );
}

const shortId = (id: string) => `order ${id.slice(4, 10)}…`;
