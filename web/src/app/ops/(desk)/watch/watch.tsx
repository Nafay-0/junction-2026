"use client";

import Link from "next/link";
import { useState } from "react";
import type { Finding, Renewal, Stage, WatchView } from "@/server/watch/service";
import { api } from "../../../_client/api";
import { verifySigned, type KeySet } from "../../../_client/verify-signed";
import { Badge } from "../../../_ui/kit";
import { fi, num, when } from "../../_ui/format";
import { Button, Details, Empty, LoadError, Loading, Num, PageHead, Panel, Section, useNow, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";

type Kitchens = { slug: string; name: string; kind: string; standing: { family: string; productId: string; name: string; weekdays: number[] }[] }[];
type View = WatchView & { kitchens: Kitchens };

const post = <T,>(body: Record<string, unknown>) => api<T>("POST", "/ops-api/watch", body);
const eur = (c?: number | null) => (c === undefined || c === null ? "" : `${(c / 100).toFixed(2).replace(".", ",")} €`);
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DECISION: Record<string, { label: string; tone: "good" | "info" | "neutral" | "refused" | "bad" }> = {
  switched: { label: "Switched: committed within the mandate", tone: "good" },
  ordered_alone: { label: "Ordered alone (auto-renew)", tone: "good" },
  sent_for_sign_off: { label: "Sent for sign-off", tone: "info" },
  kept: { label: "Kept as it is", tone: "neutral" },
  refused: { label: "Refused by the gate", tone: "refused" },
};

export function WatchScreen() {
  const live = useOps<View>("/ops-api/watch", { pollMs: 3000 });
  const now = useNow();
  const v = live.data;
  return (
    <>
      <PageHead
        title="Kitchen watch"
        purpose="Products a kitchen buys every week that cannot come, with good, better and best substitutes."
        about="Each kitchen's own agent watches what it buys every week and what is still to come: one live availability call for its key products, a finding when one cannot come for its day, with good, better, best substitutes. It learns each recurring order from the kitchen's own orders and, where the kitchen switched auto-renew on, renews it before the cut-off, or holds it and asks when the amount or the price has drifted. Every order goes through the gate."
        right={v ? <span className="tabular" title={v.schedule.minutes ? undefined : v.schedule.reason}>{num(v.stats.liveCalls)} live calls since start{v.schedule.minutes ? ` · runs every ${v.schedule.minutes} min` : " · runs when asked"}</span> : undefined}
      />
      <LoadError message={live.error} />
      {!v || !now ? <Loading label="Reading the watch…" /> : <Body v={v} now={now} refresh={live.refresh} />}
    </>
  );
}

function Body({ v, now, refresh }: { v: View; now: number; refresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string>();
  const run = async () => {
    setRunning(true);
    const r = await post<{ run: { findings: unknown[]; renewals: { state: string }[]; liveCalls: number }[] }>({ action: "run", fresh: true });
    setRunning(false);
    setNote(r.ok ? `Watched ${r.data.run.length} kitchens: ${r.data.run.reduce((s, x) => s + x.findings.length, 0)} findings, ${r.data.run.reduce((s, x) => s + x.renewals.length, 0)} renewals, ${r.data.run.reduce((s, x) => s + x.liveCalls, 0)} live calls.` : r.error.message);
    refresh();
  };
  return (
    <>
      <Panel className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 xl:divide-x xl:divide-line">
        <Num n={num(v.stats.findingsOpen)} label="open findings" sub={`${num(v.stats.findings)} in all`} />
        <Num n={num(v.stats.placedAlone)} label="ordered alone" sub="within the mandate and the kitchen's preferences" />
        <Num n={num(v.stats.sentForSignOff)} label="sent for sign-off" />
        <Num n={num(v.stats.held)} label="renewals held" sub="drifted: the kitchen is asked" />
        <Num n={num(v.stats.autoRenewOn)} label="auto-renew on" sub="off by default" />
        <Num n={num(v.stats.staged)} label="staged now" sub="demo and test kitchens only" />
      </Panel>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button kind="primary" onClick={() => void run()} disabled={running}>
          {running ? "Watching…" : "Run the watch now"}
        </Button>
        {note && (
          <p className="text-[0.9rem] text-ink-soft" role="status">
            {note}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <Section title="What the watch found, and what was decided" aside={v.findings.length ? `${v.findings.length}` : undefined}>
            {v.findings.length === 0 ? <Empty title="Nothing found yet">When a product a kitchen buys every week, or has on its way, cannot come for its day, it is listed here with the substitutes the agent proposed.</Empty> : v.findings.map((f) => <FindingCard key={f.findingId} f={f} now={now} />)}
          </Section>
          <Section title="Recurring orders renewed or held" aside={v.renewals.length ? `${v.renewals.length}` : undefined}>
            {v.renewals.length === 0 ? (
              <Empty title="No renewals yet">Only for recurring orders the kitchen switched auto-renew on for: placed before the cut-off when nothing drifted, held with the reason when something did.</Empty>
            ) : (
              <Table label="Renewals">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kitchen</th>
                    <th>Recurring order</th>
                    <th>What the agent did</th>
                  </tr>
                </thead>
                <tbody>
                  {v.renewals.map((r) => (
                    <RenewalRow key={r.renewalId} r={r} now={now} />
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </div>
        <div>
          <StageForm kitchens={v.kitchens} refresh={refresh} />
          <Section title="Staged now" aside={v.stages.filter((g) => !g.liftedAt).length || undefined}>
            <Stages stages={v.stages} refresh={refresh} now={now} />
          </Section>
          <Section title="Backups lined up" aside={v.backups.filter((b) => b.state === "set" || b.state === "used").length || undefined}>
            <Backups backups={v.backups} now={now} />
          </Section>
          <Section title="Auto-renew, as kitchens chose it">
            {v.auto.length === 0 ? (
              <Empty title="Off everywhere">Off by default. A kitchen switches it on for a recurring order in its conversation or through its agent; who chose it is recorded.</Empty>
            ) : (
              <ul className="space-y-1 text-[0.9rem]">
                {v.auto.map((a) => (
                  <li key={`${a.orgId}:${a.family}`}>
                    <Badge tone={a.on ? "good" : "neutral"}>{a.on ? "On" : "Off"}</Badge> <span className="font-semibold" title={a.orgId}>{a.kitchenName ?? "A kitchen no longer here"}</span> · {a.family.replaceAll("_", " ")}: {a.by}, {a.via}, <span className="tabular">{when(a.at, new Date(now))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Runs">
            {v.runs.length === 0 ? (
              <Empty title="No run in this process yet" />
            ) : (
              <ul className="space-y-1 text-[0.86rem] tabular">
                {v.runs.slice(0, 8).map((r) => (
                  <li key={r.at}>
                    {when(r.at, new Date(now))} · {r.by}: {r.kitchens} kitchens, {r.findings} findings, {r.placed} placed, {r.held} held, {r.liveCalls} live calls
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function FindingCard({ f, now }: { f: Finding; now: number }) {
  const d = f.decision ? DECISION[f.decision.action] : undefined;
  return (
    <Panel className="mb-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {f.kitchenName} · {f.product.name}
        </p>
        <span className="tabular text-[0.84rem] text-ink-soft">{when(f.at, new Date(now))}</span>
      </div>
      <p className="mt-1 text-[0.9rem]">
        {f.staged && <Badge tone="staged">Staged for the demo</Badge>} Needed {fi(f.need.date)} for {f.need.source === "order" && f.need.orderId ? <Link href={`/ops/orders/${f.need.orderId}`} title={f.need.orderId} className="text-petrol underline decoration-petrol/30 underline-offset-4">an order</Link> : "the recurring order"} ({fi(`${f.need.amount} ${f.need.unit}`)}): {f.shortfall.reason === "later" ? `earliest ${fi(f.shortfall.backOn)}` : fi(f.problems.join(", "))}
        {f.shortfall.backOn ? `, back ${fi(f.shortfall.backOn)}` : ""}.
      </p>
      {f.substitutes.length === 0 ? (
        <p className="mt-2 text-[0.9rem] text-ink-soft">No substitute can come by that day.</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-[0.88rem]">
          {f.substitutes.map((s) => (
            <li key={s.productId}>
              <span className="font-semibold capitalize">{s.rank}</span>: {s.name} <span className="text-ink-soft">({fi(s.why)})</span> <Badge tone={s.insidePreferences ? "good" : "info"}>{s.insidePreferences ? "the agent may order it alone" : "needs a person"}</Badge>
              {!s.insidePreferences && <span className="text-[0.82rem] text-ink-soft"> {fi(s.outside.join("; "))}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.88rem]">
        {f.state === "open" && <Badge tone="info">Waiting for the kitchen</Badge>}
        {f.state === "resolved" && <Badge tone="neutral">Resolved: it can come again</Badge>}
        {d && <Badge tone={d.tone}>{d.label}</Badge>}
        {f.decision && (
          <span className="text-ink-soft">
            {f.decision.by}, {f.decision.via}
            {f.decision.orderId && (
              <>
                {" · "}
                <Link href={`/ops/orders/${f.decision.orderId}`} title={f.decision.orderId} className="text-petrol underline decoration-petrol/30 underline-offset-4">
                  the order
                </Link>
              </>
            )}
            {f.decision.approver ? ` · signer ${f.decision.approver}` : ""}
            {f.decision.note ? ` · ${f.decision.note}` : ""}
          </span>
        )}
      </div>
      <Details summary="Search and proof" className="mt-1">
        <p className="font-sans text-[0.84rem]">
          Candidates: {f.search.mapCandidates} from the knowledge map, {f.search.searchCandidates} from the product search ({f.search.path ?? "no search"}), {f.search.priced} priced in one live call.
        </p>
        {f.claim ? <ClaimCheck findingId={f.findingId} claimId={f.claim.claimId} simulated={f.claim.simulated} /> : <p className="font-sans text-[0.84rem]">No signed availability claim (no offer returned).</p>}
      </Details>
    </Panel>
  );
}

function ClaimCheck({ findingId, claimId, simulated }: { findingId: string; claimId: string; simulated: boolean }) {
  const [out, setOut] = useState<string>();
  const check = async () => {
    setOut("Checking…");
    const t = await post<{ token: string }>({ action: "claim", findingId });
    if (!t.ok) return setOut(t.error.message);
    const keys = (await (await fetch("/.well-known/jwks.json")).json()) as KeySet;
    const r = await verifySigned(t.data.token, keys);
    setOut(r.ok ? "Signature valid against the published keys" : `Does not verify: ${r.message}`);
  };
  return (
    <p className="font-sans text-[0.84rem]">
      Availability claim {claimId}
      {simulated ? " (simulated: staged)" : ""}.{" "}
      <button type="button" className="text-petrol underline underline-offset-2" onClick={() => void check()}>
        Check the signature
      </button>
      {out && <span className="ml-2 text-ink-soft">{out}</span>}
    </p>
  );
}

function RenewalRow({ r, now }: { r: Renewal; now: number }) {
  const o = r.outcome;
  const tone = r.state === "held" ? "info" : r.state === "failed" ? "refused" : r.state === "skipped" ? "neutral" : o?.status === "committed" ? "good" : "info";
  const label =
    r.state === "held" ? "Held: the kitchen is asked" : r.state === "skipped" ? "Skipped by the kitchen" : r.state === "failed" ? "Refused by the gate" : o?.status === "committed" ? (r.state === "answered" ? "Ordered on the kitchen's answer" : "Placed alone") : o?.status === "pending_approval" ? "Sent for sign-off" : (o?.status ?? r.state);
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{when(r.at, new Date(now))}</td>
      <td>{r.kitchenName}</td>
      <td>
        <p className="font-semibold">
          {r.product.name}, {r.deliveryDate}
        </p>
        <p className="text-[0.84rem] text-ink-soft">
          Usually {r.amounts.usual} {r.amounts.unit}; learned from {r.basedOn.orders} orders over {r.basedOn.weeks.length} weeks
        </p>
        {r.drift.portions && (
          <p className="text-[0.84rem]">
            Portions {r.drift.portions.direction}: {r.drift.portions.points.map((p) => p.amount).join(" → ")} {r.amounts.unit} since {r.drift.portions.since} ({r.drift.portions.pct > 0 ? "+" : ""}
            {r.drift.portions.pct} %)
          </p>
        )}
        {r.drift.cost && (
          <p className="text-[0.84rem]">
            Cost per {r.amounts.unit}: {eur(r.drift.cost.from)} → {eur(r.drift.cost.to)} since {r.drift.cost.since} ({r.drift.cost.pct > 0 ? "+" : ""}
            {r.drift.cost.pct} %)
          </p>
        )}
        {r.drift.basket && (
          <p className="text-[0.84rem]">
            The usual {r.drift.basket.amount} {r.amounts.unit} today: {eur(r.drift.basket.nowCents)} against {eur(r.drift.basket.usualCents)} ({r.drift.basket.pct > 0 ? "+" : ""}
            {r.drift.basket.pct} %)
          </p>
        )}
      </td>
      <td>
        {r.staged && <Badge tone="staged">Staged</Badge>} <Badge tone={tone}>{label}</Badge>
        <p className="mt-1 text-[0.82rem] text-ink-soft">{fi(r.decision.reason)}</p>
        {o?.substitute && <p className="text-[0.82rem]">Substitute: {o.substitute.name} ({o.substitute.insidePreferences ? "inside the kitchen's preferences" : "needs a person"})</p>}
        {o?.orderId && (
          <p className="text-[0.82rem] text-ink-soft">
            <Link href={`/ops/orders/${o.orderId}`} className="text-petrol underline decoration-petrol/30 underline-offset-4">
              {o.orderId}
            </Link>{" "}
            · {eur(o.totalCents)}
            {o.approver ? ` · signer ${o.approver}` : ""}
          </p>
        )}
        {o?.refused && <p className="text-[0.82rem] text-ink-soft">{o.refused.message}</p>}
        {r.answer && (
          <p className="text-[0.82rem] text-ink-soft">
            {r.answer.by} answered {r.answer.choice.replace("_", " ")} ({r.answer.via})
          </p>
        )}
        <p className="text-[0.78rem] text-ink-soft">
          Auto-renew by {r.autoRenew.by}, {r.autoRenew.via}
        </p>
      </td>
    </tr>
  );
}

function Backups({ backups, now }: { backups: View["backups"]; now: number }) {
  const shown = backups.filter((b) => b.state !== "offered" || b.alternatives.length).slice(0, 30);
  if (shown.length === 0) return <Empty title="None yet">Only for a product with a poor delivery record (the wholesaler&apos;s history, below 9 in 10): the kitchen can line up a backup at order time. Nothing is bought unless the product then cannot come.</Empty>;
  const label: Record<string, { text: string; tone: "good" | "info" | "neutral" | "refused" | "bad" }> = { cleared: { text: "Cleared by a reset", tone: "neutral" }, offered: { text: "Offered", tone: "neutral" }, set: { text: "Lined up", tone: "info" }, declined: { text: "No backup wanted", tone: "neutral" }, used: { text: "Used", tone: "good" } };
  return (
    <ul className="space-y-2 text-[0.9rem]">
      {shown.map((b) => (
        <li key={b.backupId} className="rounded-lg border border-line bg-paper px-3 py-2">
          <p>
            <Badge tone={label[b.state].tone}>{label[b.state].text}</Badge> <span className="font-semibold">{b.kitchenName}</span> · {b.product.name}, {b.need.date}
          </p>
          <p className="text-ink-soft">
            {b.record.words} ({Math.round(b.record.share * 100)} %).{" "}
            {b.chosen ? `Backup: ${b.chosen.name}, chosen by ${b.chosen.by}${b.chosen.how === "you_choose" ? " (\"you choose\")" : ""}.` : b.alternatives.length ? `${b.alternatives.length} alternatives offered.` : "No alternative with a better record."}
          </p>
          {b.used && (
            <p className="text-[0.84rem]">
              {b.used.staged && <Badge tone="staged">Staged</Badge>} Used {when(b.used.at, new Date(now))}: {b.used.orderId && (
                <Link href={`/ops/orders/${b.used.orderId}`} className="text-petrol underline decoration-petrol/30 underline-offset-4">
                  {b.used.orderId}
                </Link>
              )}{" "}
              {b.used.orderId ? `${b.used.status}${b.used.totalCents ? `, ${eur(b.used.totalCents)}` : ""}${b.used.approver ? `, signer ${b.used.approver}` : ""}` : `refused: ${b.used.refused?.message ?? ""}`}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function StageForm({ kitchens, refresh }: { kitchens: Kitchens; refresh: () => void }) {
  const [slug, setSlug] = useState(kitchens[0]?.slug ?? "");
  const k = kitchens.find((x) => x.slug === slug);
  const [family, setFamily] = useState("");
  const pick = k?.standing.find((s) => s.family === family) ?? k?.standing[0];
  const [until, setUntil] = useState("");
  const [cost, setCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const stage = async (action: "stage_stock_out" | "stage_drift") => {
    if (!k || !pick) return;
    setBusy(true);
    const r = await post<{ stage: Stage }>(action === "stage_stock_out" ? { action, kitchen: k.slug, productId: pick.productId, ...(until ? { until } : {}) } : { action, kitchen: k.slug, family: pick.family, cost });
    setBusy(false);
    setMsg(r.ok ? `Staged for ${k.name}. Run the watch to see the agent notice it.` : r.error.message);
    refresh();
  };
  return (
    <Section title="Stage a condition (demo and test kitchens)">
      <Panel className="space-y-3 p-4 text-[0.9rem]">
        <p className="text-ink-soft">The partner&apos;s live data will not run out on cue. A staged stock-out applies to every live answer this one kitchen gets (its agent, its orders, the watch), never to another kitchen; it is marked staged wherever it shows, signed as simulated, and lifted by a test account reset.</p>
        {kitchens.length === 0 ? (
          <p>No demo kitchen with a recurring order.</p>
        ) : (
          <>
            <label className="block">
              <span className="text-ink-soft">Kitchen</span>
              <select value={slug} onChange={(e) => (setSlug(e.target.value), setFamily(""))} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-paper px-3">
                {kitchens.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.name} ({x.kind === "account" ? "test account" : x.kind})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-ink-soft">What it buys every week</span>
              <select value={pick?.family ?? ""} onChange={(e) => setFamily(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-paper px-3">
                {(k?.standing ?? []).map((s) => (
                  <option key={s.family} value={s.family}>
                    {s.name} ({s.weekdays.map((d) => DAY[d]).join(", ")})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-ink-soft">Out of stock until</span>
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 block min-h-11 rounded-lg border border-line-strong bg-paper px-3" />
              </label>
              <Button kind="primary" disabled={busy || !pick} onClick={() => void stage("stage_stock_out")}>
                Stage a stock-out of this product
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} /> and the price creeping up
              </label>
              <Button disabled={busy || !pick} onClick={() => void stage("stage_drift")}>
                Stage creeping portions (80, 90, 100, 110 %)
              </Button>
            </div>
          </>
        )}
        {msg && <p role="status">{msg}</p>}
      </Panel>
    </Section>
  );
}

function Stages({ stages, refresh, now }: { stages: Stage[]; refresh: () => void; now: number }) {
  const on = stages.filter((g) => !g.liftedAt);
  if (on.length === 0) return <Empty title="Nothing staged">The watch reads the partner&apos;s live figures and the kitchens&apos; real orders.</Empty>;
  return (
    <ul className="space-y-2">
      {on.map((g) => (
        <li key={g.stageId} className="rounded-lg border border-line bg-paper px-3 py-2 text-[0.9rem]">
          <p>
            <Badge tone="staged">Staged</Badge> <span className="font-semibold">{g.kitchenName}</span>: {g.kind === "stock_out" ? `${g.productName} out of stock until ${g.until}` : `${g.family} orders creeping up`}
          </p>
          <p className="text-ink-soft">
            {g.by}, <span className="tabular">{when(g.at, new Date(now))}</span>{" "}
            <button type="button" className="text-petrol underline underline-offset-2" onClick={() => void post({ action: "lift", stageId: g.stageId }).then(refresh)}>
              Lift it
            </button>
          </p>
        </li>
      ))}
    </ul>
  );
}
