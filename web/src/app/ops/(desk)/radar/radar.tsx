"use client";

import { useState, type ReactNode } from "react";
import type { HoldCard, NoticeCard, RadarView } from "@/server/radar/views";
import { api } from "../../../_client/api";
import { fi, num, since, span, when } from "../../_ui/format";
import { Button, Details, Empty, LoadError, Loading, PageHead, Panel, Section, useNow, useOps } from "../../_ui/kit";
import { Target } from "../../../_ui/target";

type Evidence = { value: string; sentence?: string; verified: boolean; english?: string };

const fiDate = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : "undated");
const LANG: Record<string, string> = { fi: "Finnish", sv: "Swedish", en: "English" };
const STATUS: Record<string, string> = { ok: "Working", never_checked: "Not checked yet", degraded: "Working, layout changed", down: "Not reachable", layout_changed: "Layout changed: needs a look", paused: "Paused" };
const HAZARD: Record<string, string> = { allergen: "Undeclared allergen", microbial: "Microbes", foreign_body: "Foreign bodies", chemical: "Chemical limit", spoilage: "Spoilage", labelling: "Labelling", other: "Other" };

async function post(body: Record<string, unknown>) {
  return api<Record<string, unknown>>("POST", "/ops-api/radar", body);
}

export function RadarScreen() {
  const live = useOps<RadarView>("/ops-api/radar", { pollMs: 2000 });
  const now = useNow();
  const v = live.data;
  const fi1 = v?.sources.find((s) => s.id === "ruokavirasto-fi");
  return (
    <>
      <PageHead
        title="Recall radar"
        purpose="Is anything we sell being recalled? The radar reads food authorities' recall notices on the open web, keeps each fact with the sentence it came from, matches them against the assortment in code, and holds a product an authority names before any agent can order it. Doubtful matches wait for a person."
        right={v && now && fi1?.lastCheckAt ? <span className="tabular">Ruokavirasto checked {since(fi1.lastCheckAt, now)}</span> : undefined}
      />
      <LoadError message={live.error} />
      {!v || !now ? <Loading /> : <Body v={v} now={now} refresh={live.refresh} />}
    </>
  );
}

function Body({ v, now, refresh }: { v: RadarView; now: number; refresh: () => void }) {
  const drillHolds = v.holds.filter((h) => h.drill);
  const realHolds = v.holds.filter((h) => !h.drill);
  return (
    <>
      <Panel rule className="grid grid-cols-2 divide-line/70 sm:grid-cols-3 xl:grid-cols-6 xl:divide-x">
        <Tile n={num(v.stats.read)} label={`real notices read since ${fiDate(v.stats.window)}`} />
        <Tile n={num(v.stats.matchedAny)} label="matched anything in the assortment" sub={`${v.stats.confirmed} on a hard identifier, ${v.stats.possible} possible`} />
        <Tile n={num(v.stats.holds)} label="real products on hold" gate={v.stats.holds > 0} sub={drillHolds.length ? `and ${drillHolds.length} drill hold${drillHolds.length > 1 ? "s" : ""}` : undefined} />
        <Tile n={num(v.stats.review)} label="matches waiting for a person" safety={v.stats.review > 0} />
        <Tile n={num(v.spend.contextDevCredits)} label="Context.dev credits used" sub={`${num(v.spend.contextDevCalls)} reads${v.spend.contextDevRemaining !== undefined ? `, ${num(v.spend.contextDevRemaining)} left on the account` : ""}`} />
        <Tile n={`$${v.spend.exaDollars.toFixed(3)}`} label="Exa spent" sub={`${num(v.spend.exaCalls)} searches since ${when(v.spend.since, new Date(now))}`} />
      </Panel>

      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <DrillSection v={v} now={now} refresh={refresh} />
          <Section title="Products on hold" aside={v.holds.length ? `${v.holds.length} in force` : undefined}>
            {v.holds.length === 0 ? (
              <Empty title="Nothing is held">A product goes on hold when a recent notice names it by EAN, or by producer, exact name and pack size. Agents then cannot quote or order it, and waiting orders with it cannot be approved.</Empty>
            ) : (
              <ul className="space-y-3">
                {[...drillHolds, ...realHolds].map((h) => (
                  <HoldRow key={h.holdId} h={h} now={now} refresh={refresh} />
                ))}
              </ul>
            )}
            {v.lifted.length > 0 && (
              <Details summary={`${v.lifted.length} lifted hold${v.lifted.length > 1 ? "s" : ""}`} className="mt-2">
                {v.lifted.map((h) => (
                  <p key={h.holdId} className="font-sans">
                    {h.drill ? "DRILL: " : ""}
                    {h.productName}: lifted {when(h.liftedAt, new Date(now))} by {h.liftedBy}, “{h.liftReason}”. Refused {h.refusals} call{h.refusals === 1 ? "" : "s"}.
                  </p>
                ))}
              </Details>
            )}
          </Section>
          <Section title="Waiting for a person" aside={v.review.length ? `${v.review.length} match${v.review.length > 1 ? "es" : ""}` : undefined}>
            {v.review.length === 0 ? (
              <Empty title="Nothing to review">Possible matches (the same brand and a similar name, but no EAN or exact name and pack) and confirmed matches on older notices come here. Code never holds a product on a possible match.</Empty>
            ) : (
              <ul className="space-y-3">
                {v.review.map((m) => (
                  <ReviewRow key={m.matchId} m={m} refresh={refresh} />
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div>
          <SourcesSection v={v} now={now} refresh={refresh} />
        </div>
      </div>

      <NoticesSection v={v} now={now} />
      <p className="mt-6 text-[0.82rem] text-ink-soft">
        Nothing here is decided by a language model. Context.dev&apos;s extraction proposes facts and copies the sentence each came from; code keeps only EANs with a valid check digit that are on the page, checks every quoted sentence against the page text, matches in code and decides holds in code. Catalogue: {v.partners.catalogue === "valio" ? `the partner's ${num(v.partners.products)} products (synthetic, inspired by the real world)` : "the 12-product seed"}; GTIN matching {v.partners.gtinMatching ? "on" : "off (run pnpm radar:gtins)"}.
      </p>
    </>
  );
}

function Tile({ n, label, sub, safety, gate }: { n: ReactNode; label: string; sub?: string; safety?: boolean; gate?: boolean }) {
  return (
    <div className="min-w-0 border-b border-line/70 px-4 py-3 xl:border-b-0">
      <p className="display flex items-center gap-2 text-[2.1rem] leading-none tabular">
        {gate ? <span className="bg-safety-ink px-1.5 text-safety">{n}</span> : n}
        {safety && <span aria-hidden className="hazard-thin inline-block size-3.5" />}
      </p>
      <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.82rem] text-ink-soft">{sub}</p>}
    </div>
  );
}

function Msg({ m }: { m?: { ok: boolean; text: string } }) {
  if (!m) return null;
  return <p className={`mt-1.5 text-[0.85rem] ${m.ok ? "text-ink-soft" : "font-semibold"}`}>{m.text}</p>;
}

// ---------- drill ----------

function DrillSection({ v, now, refresh }: { v: RadarView; now: number; refresh: () => void }) {
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const chosen = productId || v.drill.candidates[0]?.productId || "";
  async function publish() {
    setBusy(true);
    setMsg(undefined);
    const r = await post({ action: "drill", productId: chosen });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Drill notice published. The radar reads the drill page every few seconds until it picks it up." } : { ok: false, text: r.error.message });
    refresh();
  }
  async function end(drillId: string) {
    const r = await post({ action: "end_drill", drillId });
    if (!r.ok) setMsg({ ok: false, text: r.error.message });
    refresh();
  }
  return (
    <Section title="Drill" aside="Never a real recall">
      <div className="bg-paper">
        <div className="flex items-center gap-2 bg-petrol-deep px-4 py-2 text-[0.92rem] font-semibold text-paper">
          <span aria-hidden className="size-2.5 border-2 border-paper" />
          A drill: a test notice on AimoPilot&apos;s own page, never a real recall
        </div>
        <div className="px-4 py-3">
          <p className="text-[0.92rem] leading-snug text-ink-soft">
            Publishes a notice marked “Harjoitus / Drill” on <a className="underline" href={v.partners.drillUrl} target="_blank" rel="noreferrer">AimoPilot&apos;s drill page</a>, in the authority&apos;s layout. The radar picks it up through the same reader and matching as a real notice ({v.partners.drillReadVia === "context.dev" ? "read by Context.dev from the public address" : "read directly: Context.dev cannot reach this server's own address; set RADAR_PUBLIC_URL to a public one"}), and holds the product. Then try to order it.
          </p>
          {v.drill.active.length === 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-[0.88rem] font-semibold">
                Product to recall in the drill
                <select value={chosen} onChange={(e) => setProductId(e.target.value)} className="mt-1 block min-h-11 w-full border-2 border-line bg-paper px-2 text-[0.95rem] font-normal focus:border-petrol">
                  {v.drill.candidates.map((c) => (
                    <option key={c.productId} value={c.productId}>
                      {c.name}: {c.why}
                    </option>
                  ))}
                </select>
              </label>
              <Button kind="primary" size="md" onClick={publish} disabled={busy || !chosen}>
                {busy ? "Publishing…" : "Publish drill notice"}
              </Button>
            </div>
          )}
          {v.drill.active.map((d) => (
            <div key={d.drillId} className="mt-3">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <p className="basis-full text-[0.95rem]">
                  <span className="text-ink-soft">Drill recall of</span> <b>{d.productName}</b>
                </p>
                {/* The stopwatch: from the notice going up to the first refused order. */}
                <p className="basis-full">
                  <span className="block text-[0.82rem] text-ink-soft">{d.secondsToRefusal !== undefined ? "Notice to stopped order" : "Since the notice went up"}</span>
                  <span className="display text-[2.6rem] leading-none tabular">{d.secondsToRefusal !== undefined ? span(d.secondsToRefusal * 1000) : span(now - Date.parse(d.publishedAt))}</span>
                </p>
              </div>
              <ol className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                <Step n={1} label="Published" value={when(d.publishedAt, new Date(now))} done />
                <Step n={2} label="Picked up by the radar" value={d.secondsToPickUp !== undefined ? `+${span(d.secondsToPickUp * 1000)}` : "waiting…"} done={d.secondsToPickUp !== undefined} />
                <Step n={3} label="Product held" value={d.secondsToHold !== undefined ? `+${span(d.secondsToHold * 1000)}` : "…"} done={d.secondsToHold !== undefined} tone="gate" />
                <Step n={4} label="An order stopped" value={d.secondsToRefusal !== undefined ? `+${span(d.secondsToRefusal * 1000)}` : "try to order it"} done={d.secondsToRefusal !== undefined} tone="gate" />
              </ol>
              <p className="mt-2 flex flex-wrap gap-4 text-[0.92rem] font-semibold text-petrol">
                <a href={d.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Open the drill notice
                </a>
                <button type="button" className="underline underline-offset-2" onClick={() => void end(d.drillId)}>
                  End drill and lift its hold
                </button>
              </p>
            </div>
          ))}
          <Msg m={msg} />
        </div>
      </div>
    </Section>
  );
}

function Step({ n, label, value, done, tone = "plain" }: { n: number; label: string; value: string; done?: boolean; tone?: "plain" | "gate" }) {
  const look = !done ? "border-2 border-dashed border-line text-ink-soft" : tone === "gate" ? "bg-safety-ink text-paper" : "bg-petrol text-paper";
  return (
    <li className={`px-3 py-2 ${look}`}>
      <span className={`block text-[0.82rem] ${done ? (tone === "gate" ? "text-safety" : "text-paper/80") : ""}`}>
        {n}. {label}
      </span>
      <span className="display text-[1.3rem] leading-tight tabular">{value}</span>
    </li>
  );
}

// ---------- holds ----------

function HoldRow({ h, now, refresh }: { h: HoldCard; now: number; refresh: () => void }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  async function lift(e: React.FormEvent) {
    e.preventDefault();
    const r = await post({ action: "lift", holdId: h.holdId, reason });
    if (!r.ok) return setMsg({ ok: false, text: r.error.message });
    setReason("");
    refresh();
  }
  return (
    <li className="bg-paper">
      <div aria-hidden className="hazard h-2.5" />
      <div className="px-4 py-3">
        <p className="flex items-center gap-2 text-[0.88rem] font-semibold">
          <Target size={16} tone="safety" />
          {h.drill ? "Held for a drill" : "Held: no quote, no order"}
        </p>
        <p className="display mt-1 text-[1.4rem] leading-tight">{h.productName}</p>
        <p className="mt-0.5 text-[0.9rem]">{h.reason}</p>
        <p className="mt-1 text-[0.88rem] text-ink-soft">
          Held {when(h.placedAt, new Date(now))} by {h.placedBy === "radar" ? "the radar (confirmed identifier)" : h.placedBy.replace(/^operator:/, "")}. {h.refusals} call{h.refusals === 1 ? "" : "s"} refused
          {h.lastRefusalAt ? `, last ${since(h.lastRefusalAt, now)}` : ""}.{" "}
          <a href={h.noticeUrl} target="_blank" rel="noreferrer" className="font-semibold text-petrol underline underline-offset-2">
            Read the notice
          </a>
        </p>
        {h.orders.length > 0 && (
          <ul className="mt-2 space-y-1 text-[0.85rem]">
            {h.orders.map((o) => (
              <li key={o.orderId} className={o.affected ? "font-semibold" : "text-ink-soft"}>
                {o.orgName}: {o.status}
                {o.deliveryDate ? `, delivery ${fiDate(o.deliveryDate)}` : ""}. {o.why}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={lift} className="mt-2 flex flex-wrap gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why lift it (stock checked: other batch…)" aria-label="Why lift the hold" className="min-h-10 min-w-0 flex-1 border-2 border-line px-2 text-[0.92rem] focus:border-petrol focus:outline-none" />
          <Button type="submit" disabled={!reason.trim()}>
            Lift hold
          </Button>
        </form>
        <Msg m={msg} />
      </div>
    </li>
  );
}

// ---------- review ----------

function ReviewRow({ m, refresh }: { m: RadarView["review"][number]; refresh: () => void }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  async function decide(decision: "confirm" | "dismiss") {
    const r = await post({ action: "review", matchId: m.matchId, decision, reason });
    if (!r.ok) return setMsg({ ok: false, text: r.error.message });
    setReason("");
    refresh();
  }
  return (
    <li className="border-l-[10px] border-safety bg-paper px-4 py-3">
      <p className="text-[0.88rem] font-semibold text-ink-soft">
        {m.drill ? "Drill, " : ""}
        {m.strength === "confirmed" ? "a confirmed identifier on an older notice" : "a possible match"}: a person decides
      </p>
      <p className="font-semibold">{m.productName}</p>
      <p className="text-[0.88rem]">
        Notice: “{m.notice.title}” ({m.notice.publisher}, {fiDate(m.notice.publishedOn)}){m.noticeProduct ? `, product “${m.noticeProduct}”` : ""}.
      </p>
      <p className="mt-1 text-[0.85rem] text-ink-soft">{m.why}</p>
      {m.reviewReason && <p className="text-[0.85rem] text-ink-soft">{m.reviewReason}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (written to the ledger)" aria-label="Reason" className="min-h-10 min-w-0 flex-1 border-2 border-line px-2 text-[0.92rem] focus:border-petrol focus:outline-none" />
        <Button kind="stop" disabled={!reason.trim()} onClick={() => void decide("confirm")}>
          Confirm and hold
        </Button>
        <Button disabled={!reason.trim()} onClick={() => void decide("dismiss")}>
          Dismiss
        </Button>
      </div>
      <a href={m.notice.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[0.9rem] font-semibold text-petrol underline underline-offset-2">
        Open the notice
      </a>
      <Msg m={msg} />
    </li>
  );
}

// ---------- sources ----------

function SourcesSection({ v, now, refresh }: { v: RadarView; now: number; refresh: () => void }) {
  const [busy, setBusy] = useState<string>();
  async function check(sourceId: string) {
    setBusy(sourceId);
    await post({ action: "check", sourceId });
    setBusy(undefined);
    refresh();
  }
  return (
    <Section title="Sources" aside="Checked on a schedule; Context.dev watches the authority's list between checks">
      <Panel rule>
        <ul className="divide-y divide-line/70">
          {v.sources.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-semibold">
                  {s.drill && <span className="mr-1.5 border border-petrol px-1 text-[0.78rem] font-semibold text-petrol">Drill page</span>}
                  <a href={s.homeUrl} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2">
                    {s.name}
                  </a>
                </p>
                <span className={`inline-flex items-center gap-1.5 text-[0.88rem] font-semibold ${s.status === "ok" ? "text-petrol" : "text-ink"}`}>
                  <span aria-hidden className={`size-2.5 ${s.status === "ok" ? "bg-petrol" : s.status === "down" || s.status === "layout_changed" ? "bg-ink" : "border-2 border-ink-soft"}`} />
                  {STATUS[s.status] ?? s.status}
                </span>
              </div>
              <p className="text-[0.8rem] text-ink-soft">
                {s.publisher}, in {LANG[s.language]}
                {s.independent ? "" : ", the same authority in another language"}
              </p>
              <p className="mt-1 text-[0.85rem] tabular">
                Last checked {since(s.lastCheckAt, now)}
                {s.lastCheckAt && s.nextCheckAt && !s.drill ? `, next ${Date.parse(s.nextCheckAt) > now ? `in ${span(Date.parse(s.nextCheckAt) - now)}` : "now"}` : ""}
                {s.listed !== undefined ? `; ${num(s.listed)} listed` : ""}; {num(s.noticesRead)} read
              </p>
              {s.monitor && (
                <p className="text-[0.82rem] text-ink-soft tabular">
                  Context.dev monitor every {s.monitor.everyMinutes} min: last run {since(s.monitor.lastRunAt, now)}
                  {s.monitor.nextRunAt ? `, next ${Date.parse(s.monitor.nextRunAt) > now ? `in ${span(Date.parse(s.monitor.nextRunAt) - now)}` : "due"}` : ""}
                  {s.monitor.lastChangeAt ? `, last change ${since(s.monitor.lastChangeAt, now)}` : ", no change yet"}
                </p>
              )}
              {s.lastError && <p className="mt-1 text-[0.82rem]">{s.lastError}</p>}
              <p className="mt-1 text-[0.8rem] text-ink-soft">{s.about}</p>
              <button type="button" disabled={busy === s.id} onClick={() => void check(s.id)} className="mt-1 text-[0.88rem] font-semibold text-petrol underline underline-offset-2 disabled:opacity-50">
                {busy === s.id ? "Checking…" : "Check now"}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="mt-2 text-[0.8rem] text-ink-soft">
        A source that cannot be reached, or whose page changed layout, shows here and raises no alarm; it is never read as &ldquo;no recalls&rdquo;. Budget per run: {num(v.spend.budget.contextDevCredits)} Context.dev credits, ${v.spend.budget.exaDollars} of Exa. {num(v.spend.cacheHits)} reads came from cache.
      </p>
    </Section>
  );
}

// ---------- notices ----------

function NoticesSection({ v, now }: { v: RadarView; now: number }) {
  const [filter, setFilter] = useState<"matched" | "all" | "drill">("matched");
  const shown = v.notices.filter((n) => (filter === "all" ? !n.drill : filter === "drill" ? n.drill : n.matches.length > 0 && !n.drill));
  const tabs: [typeof filter, string][] = [
    ["matched", `Matched (${v.notices.filter((n) => n.matches.length > 0 && !n.drill).length})`],
    ["all", `All real notices (${v.notices.filter((n) => !n.drill).length})`],
    ["drill", `Drills (${v.notices.filter((n) => n.drill).length})`],
  ];
  return (
    <Section title="Notices" aside={<span className="tabular">Newest first</span>}>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`min-h-9 px-3 text-[0.9rem] font-semibold ${filter === id ? "bg-petrol text-paper" : "border-2 border-line bg-paper hover:border-petrol"}`}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title={filter === "matched" ? "No notice matched the assortment" : "No notices yet"}>
          {filter === "matched" ? "The catalogue is synthetic and inspired by the real world, so most real notices concern nothing it sells. Nothing is forced: see All real notices." : "The radar has not read this source yet."}
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((n) => (
            <NoticeRow key={n.noticeId} n={n} now={now} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Said({ label, e }: { label: string; e?: Evidence }) {
  if (!e) return null;
  return (
    <div className="mt-1.5">
      <p className="text-[0.82rem] font-semibold text-ink-soft">{label}</p>
      <p className="text-[0.9rem]">“{e.sentence ?? e.value}”</p>
      {e.english && <p className="text-[0.82rem] text-ink-soft">{e.english}</p>}
      {!e.verified && <p className="text-[0.75rem] font-semibold">Not found verbatim on the page: not used for matching.</p>}
    </div>
  );
}

function NoticeRow({ n, now }: { n: NoticeCard; now: number }) {
  return (
    <li className={`bg-paper px-4 py-3 ${n.matches.length ? "border-t-[3px] border-petrol" : ""}`}>
      {n.drill && <p className="mb-1 inline-block border border-petrol px-1.5 text-[0.82rem] font-semibold text-petrol">Drill, not a real recall</p>}
      <p className="text-[0.85rem] text-ink-soft">
        {n.publisher}, {fiDate(n.publishedOn)}, in {LANG[n.language] ?? n.language}; seen {when(n.seenAt, new Date(now))}
        {n.readBy ? `, read by ${n.readBy}` : ""}
      </p>
      <a href={n.url} target="_blank" rel="noreferrer" className="display mt-0.5 block text-[1.25rem] leading-tight underline decoration-line underline-offset-2" lang={n.language}>
        {n.title}
      </a>
      {n.state === "unreadable" && <p className="mt-1 text-[0.85rem]">Could not be read: {n.readError}. Retried on the next check.</p>}
      {n.state === "listed" && <p className="mt-1 text-[0.85rem] text-ink-soft">Listed; reading…</p>}
      {n.summaryEnglish && <p className="mt-1 text-[0.88rem]">{n.summaryEnglish}</p>}
      {n.hazard && (
        <p className="mt-1 text-[0.85rem]">
          <span className="font-semibold">{HAZARD[n.hazard.kind] ?? n.hazard.kind}</span>
          {n.hazard.allergens.length ? `: ${n.hazard.allergens.join(", ")}` : ""}
        </p>
      )}
      {n.products.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[0.85rem]">
          {n.products.slice(0, 6).map((p, i) => (
            <li key={i}>
              <span lang={n.language}>{p.name.value}</span>
              {p.pack && !p.name.value.includes(p.pack) ? `, ${p.pack}` : ""}
              {p.eans.length ? <span className="text-ink-soft tabular">, EAN {p.eans.join(", ")}</span> : null}
              {p.lots ? <span className="text-ink-soft">, {p.lots}</span> : null}
            </li>
          ))}
          {n.products.length > 6 && <li className="text-ink-soft">and {n.products.length - 6} more</li>}
        </ul>
      )}
      {n.matches.length > 0 && (
        <ul className="mt-2 space-y-1">
          {n.matches.map((m) => (
            <li key={m.matchId} className="border-l-4 border-petrol pl-2 text-[0.9rem]">
              <span className="font-semibold">{m.productName}</span>: {m.strength === "confirmed" ? "confirmed" : "possible"} ({m.status.replaceAll("_", " ")}). {fi(m.why)}
              {m.reviewReason && m.status === "confirmed" ? <span className="block text-ink-soft">{m.reviewReason}</span> : null}
              {m.review ? <span className="block text-ink-soft">{m.review.decision === "confirm" ? "Confirmed" : "Dismissed"} by {m.review.by}: “{m.review.reason}”</span> : null}
            </li>
          ))}
        </ul>
      )}
      {n.feed && <p className="mt-1 text-[0.85rem] text-ink-soft">RASFF {n.feed.reference}, {n.feed.classification}; countries {n.feed.countries.join(", ")}</p>}
      <Details summary="What the notice says, in its own words" className="mt-2">
        <div className="font-sans text-[0.85rem] text-ink" lang={n.language}>
          <Said label="Hazard" e={n.hazard?.text} />
          <Said label="Consumers are told" e={n.consumerAction} />
          <Said label="Businesses and kitchens are told" e={n.businessAction} />
          {n.products.map((p, i) => (
            <Said key={i} label={`Product ${i + 1}`} e={p.name} />
          ))}
          {n.eans.length > 0 && <p className="mt-1.5 text-[0.8rem]">EANs on the page (valid check digit): {n.eans.join(", ")}</p>}
        </div>
      </Details>
      {(n.corroboration.length > 0 || n.sameAs.length > 0) && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-[0.88rem] text-petrol">
          {n.sameAs.map((x) => (
            <a key={x.noticeId} href={x.url} target="_blank" rel="noreferrer" className="underline">
              {LANG[x.language]} version
            </a>
          ))}
          {n.corroboration.map((c) => (
            <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="underline" title={c.title}>
              Also: {hostOf(c.url)} (found by Exa)
            </a>
          ))}
        </p>
      )}
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
