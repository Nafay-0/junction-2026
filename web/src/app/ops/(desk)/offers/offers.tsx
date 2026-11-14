"use client";

import { useState } from "react";
import type { Campaign, OffersView } from "@/server/offers/service";
import { api } from "../../../_client/api";
import { verifySigned, type KeySet } from "../../../_client/verify-signed";
import { Badge } from "../../../_ui/kit";
import { num, when } from "../../_ui/format";
import { Button, Details, Empty, LoadError, Loading, Num, PageHead, Panel, Section, useNow, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";

type Offer = OffersView["offers"][number];
type Found = { productId: string; name: string; category: string; packSize: number; unit: string };

const STATUS: Record<string, { label: string; tone: "good" | "info" | "neutral" | "refused" | "bad" }> = {
  offered: { label: "Open", tone: "info" },
  accepted: { label: "Accepted: an ordinary order started", tone: "good" },
  declined: { label: "Declined", tone: "neutral" },
  muted: { label: "Muted by the kitchen", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  withheld: { label: "Held back", tone: "refused" },
};
const RULE: Record<string, string> = {
  offers_off: "The kitchen turned offers off",
  forbidden_by_rule: "The kitchen's rules forbid it",
  muted: "The kitchen muted this kind",
  declined_recently: "Declined in the last 30 days",
  already_offered: "Already offered, still open",
  weekly_cap: "Weekly cap reached",
  not_available: "No live price or delivery",
  unsupported_claim: "The data does not back the claim",
  recall_hold: "Held by the recall radar",
};
const REASON: Record<string, string> = { cheaper: "Cheaper like-for-like", new_in_assortment: "New in the assortment", in_season: "In season", more_reliable: "More reliable", lower_carbon: "Lower carbon", new_to_kitchen: "New to the kitchen" };
const CLAIMS = ["new_in_assortment", "in_season", "cheaper"] as const;

const post = <T,>(body: Record<string, unknown>) => api<T>("POST", "/ops-api/offers", body);

export function OffersScreen() {
  const live = useOps<OffersView>("/ops-api/offers", { pollMs: 3000 });
  const now = useNow();
  const v = live.data;
  return (
    <>
      <PageHead
        title="Selling agent"
        purpose="Our own agent, offering the buyers' agents what is genuinely worth it: new in the assortment, in season in Finland, or a like-for-like cheaper per litre, more reliable or lower in carbon than what a kitchen buys every week. Plain code picks from data and checks every guardrail; each offer is signed, open and never an order. Kitchens can mute it or turn it off."
        right={v ? <span className="tabular">{num(v.stats.liveCalls)} live price calls this process</span> : undefined}
      />
      <LoadError message={live.error} />
      {!v || !now ? <Loading label="Reading the selling agent…" /> : <Body v={v} now={now} refresh={live.refresh} />}
    </>
  );
}

function Body({ v, now, refresh }: { v: OffersView; now: number; refresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string>();
  const run = async () => {
    setRunning(true);
    const r = await post<{ run: { kitchen: string; offered: unknown[]; withheld: unknown[] }[] }>({ action: "run" });
    setRunning(false);
    setNote(r.ok ? `Ran over ${r.data.run.length} kitchens: ${r.data.run.reduce((s, x) => s + x.offered.length, 0)} offered, ${r.data.run.reduce((s, x) => s + x.withheld.length, 0)} held back.` : r.error.message);
    refresh();
  };
  const sent = v.offers.filter((o) => o.status !== "withheld");
  const held = v.offers.filter((o) => o.status === "withheld");
  return (
    <>
      <Panel className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 xl:divide-x xl:divide-line">
        <Num n={num(v.stats.offered)} label="offers sent" sub={`at most ${v.stats.weeklyCap} a kitchen a week`} />
        <Num n={num(v.stats.open)} label="open now" />
        <Num n={num(v.stats.accepted)} label="accepted" sub="each an ordinary order through the gate" />
        <Num n={num(v.stats.declined + v.stats.muted)} label="declined or muted" />
        <Num n={num(v.stats.withheld)} label="held back by a guardrail" />
        <Num n={num(v.stats.kitchensOff)} label="kitchens with offers off" />
      </Panel>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button kind="primary" onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "Run the selling agent now"}
        </Button>
        {note && <p className="text-[0.9rem] text-ink-soft" role="status">{note}</p>}
      </div>

      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <Section title="What it offered, to whom, and what happened" aside={sent.length ? `${sent.length}` : undefined}>
            {sent.length === 0 ? (
              <Empty title="No offers yet">Run the selling agent, or start a campaign for a product. Only products the data supports reach a kitchen.</Empty>
            ) : (
              <Table label="Offers">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kitchen</th>
                    <th>Product and why</th>
                    <th>What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {sent.map((o) => (
                    <OfferRow key={o.offerId} o={o} now={now} />
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
          <Section title="Held back, and why" aside={held.length ? `${held.length}` : undefined}>
            {held.length === 0 ? (
              <Empty title="Nothing held back yet">When a guardrail stops a product (the kitchen&apos;s rules, a mute, offers off, the weekly cap, a claim the data does not back), it is listed here with the rule.</Empty>
            ) : (
              <ul className="space-y-2">
                {held.slice(0, 30).map((o) => (
                  <li key={o.offerId} className="rounded-lg border border-line bg-paper px-3 py-2 text-[0.9rem]">
                    <p>
                      <span className="font-semibold">{o.kitchenName}</span> · {o.productName}
                    </p>
                    <p className="text-ink-soft">
                      <Badge tone="refused">{RULE[o.rule ?? ""] ?? o.rule}</Badge> {o.reason} <span className="tabular">({when(o.at, new Date(now))})</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div>
          <CampaignForm refresh={refresh} />
          <Section title="Campaigns" aside={v.campaigns.length ? `${v.campaigns.length}` : undefined}>
            {v.campaigns.length === 0 ? <Empty title="No campaigns yet">A campaign names one product; the selling agent decides kitchen by kitchen whether it is relevant, and says why not.</Empty> : v.campaigns.map((c) => <CampaignCard key={c.campaignId} c={c} now={now} />)}
          </Section>
          <Section title="What kitchens told it">
            {v.prefs.length === 0 ? (
              <Empty title="No mutes">A kitchen can say no, ask not to be offered a kind of thing again, or turn offers off. The selling agent reads it before it picks anything.</Empty>
            ) : (
              <ul className="space-y-1 text-[0.9rem]">
                {v.prefs.map((p) => (
                  <li key={p.orgId}>
                    <span className="font-semibold">{p.orgId}</span>: {p.off ? `offers off (${p.off.by})` : "offers on"}
                    {p.mutes.length ? `; muted ${p.mutes.map((m) => `${m.scope} ${m.value.replaceAll("_", " ")}`).join(", ")}` : ""}
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

function OfferRow({ o, now }: { o: Offer; now: number }) {
  const st = STATUS[o.status] ?? STATUS.offered;
  return (
    <tr>
      <td className="tabular whitespace-nowrap">{when(o.at, new Date(now))}</td>
      <td>{o.kitchenName}</td>
      <td>
        <p className="font-semibold">{o.productName}</p>
        <p className="text-[0.86rem] text-ink-soft">{o.reasons.map((r) => REASON[r.kind] ?? r.kind).join(" · ")}</p>
        <p className="text-[0.86rem]">{o.line}</p>
        {o.lineBy === "model" && <p className="text-[0.78rem] text-ink-soft">Line by a model, checked against the figures</p>}
        <Proof offerId={o.offerId} />
      </td>
      <td>
        <Badge tone={st.tone}>{st.label}</Badge>
        {o.answer && (
          <p className="mt-1 text-[0.82rem] text-ink-soft">
            {o.answer.by}, {o.answer.via}
            {o.answer.scope ? ` (${o.answer.scope})` : ""}
            {o.answer.requestId ? ` · ${o.answer.requestId}` : ""}
          </p>
        )}
      </td>
    </tr>
  );
}

function Proof({ offerId }: { offerId: string }) {
  const [out, setOut] = useState<string>();
  const check = async () => {
    setOut("Checking…");
    const t = await post<{ token: string }>({ action: "token", offerId });
    if (!t.ok) return setOut(t.error.message);
    const keys = (await (await fetch("/.well-known/jwks.json")).json()) as KeySet;
    const r = await verifySigned(t.data.token, keys);
    setOut(r.ok ? "Signature valid against the published keys" : `Does not verify: ${r.message}`);
  };
  return (
    <p className="mt-1 text-[0.8rem]">
      <button type="button" className="text-petrol underline underline-offset-2" onClick={() => void check()}>
        Check the signature
      </button>
      {out && <span className="ml-2 text-ink-soft">{out}</span>}
    </p>
  );
}

function CampaignForm({ refresh }: { refresh: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [pick, setPick] = useState<Found>();
  const [isNew, setNew] = useState(true);
  const [claims, setClaims] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const search = async () => {
    const r = await post<{ products: Found[] }>({ action: "search", q });
    setFound(r.ok ? r.data.products : []);
  };
  const start = async () => {
    if (!pick) return;
    setBusy(true);
    const r = await post<{ campaign: Campaign }>({ action: "campaign", productId: pick.productId, listAsNew: isNew, claims });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    const c = r.data.campaign;
    setMsg(`${c.results.filter((x) => x.outcome === "offered").length} kitchens offered, ${c.results.filter((x) => x.outcome !== "offered").length} not.`);
    refresh();
  };
  return (
    <Section title="Start a campaign">
      <Panel className="space-y-3 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label className="sr-only" htmlFor="campaign-q">
            Product
          </label>
          <input id="campaign-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product: oat drink, whipping cream…" className="min-h-11 w-full rounded-lg border border-line-strong bg-paper px-3 text-[0.95rem]" />
          <Button type="submit">Find</Button>
        </form>
        {found.length > 0 && (
          <ul className="space-y-1">
            {found.map((p) => (
              <li key={p.productId}>
                <label className="flex cursor-pointer items-center gap-2 text-[0.9rem]">
                  <input type="radio" name="campaign-product" checked={pick?.productId === p.productId} onChange={() => setPick(p)} />
                  <span>
                    {p.name} <span className="text-ink-soft">({p.category.replaceAll("_", " ")}, {p.productId})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-2 text-[0.9rem]">
          <input type="checkbox" checked={isNew} onChange={(e) => setNew(e.target.checked)} /> It is new in our assortment (listed today)
        </label>
        <fieldset className="text-[0.9rem]">
          <legend className="text-ink-soft">We want to say (each must be backed by the data for that kitchen, or it is not sent):</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {CLAIMS.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={claims.includes(c)} onChange={(e) => setClaims(e.target.checked ? [...claims, c] : claims.filter((x) => x !== c))} /> {REASON[c]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button kind="primary" disabled={!pick || busy} onClick={() => void start()}>
            {busy ? "The selling agent is deciding…" : "Start: let the agent choose the kitchens"}
          </Button>
          {msg && <p className="text-[0.88rem] text-ink-soft" role="status">{msg}</p>}
        </div>
      </Panel>
    </Section>
  );
}

function CampaignCard({ c, now }: { c: Campaign; now: number }) {
  const offered = c.results.filter((r) => r.outcome === "offered");
  return (
    <Panel className="mb-3 p-4">
      <p className="font-semibold">{c.productName}</p>
      <p className="text-[0.84rem] text-ink-soft">
        {c.by}, {when(c.at, new Date(now))}
        {c.listedAsNew ? " · listed as new" : ""}
        {c.claims.length ? ` · wants to say: ${c.claims.map((x) => REASON[x] ?? x).join(", ")}` : ""}
      </p>
      <p className="mt-1 text-[0.9rem]">
        Relevant to {offered.length} of {c.results.length} kitchens.
      </p>
      <Details summary="Kitchen by kitchen" className="mt-1">
        <ul className="space-y-1 font-sans">
          {c.results.map((r) => (
            <li key={r.kitchen}>
              <Badge tone={r.outcome === "offered" ? "good" : r.outcome === "withheld" ? "refused" : "neutral"}>{r.outcome === "offered" ? "Offered" : r.outcome === "withheld" ? (RULE[r.rule ?? ""] ?? "Held back") : "Not relevant"}</Badge> <span className="font-semibold">{r.name}</span>: {r.reason}
            </li>
          ))}
        </ul>
      </Details>
    </Panel>
  );
}
