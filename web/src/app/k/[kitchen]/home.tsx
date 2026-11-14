"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Plate, SectionTitle, Skeleton, Tag, buttonClass } from "../../_ui/kit";
import { Glyph } from "../../_ui/glyphs";
import { Art } from "../../_ui/art";
import { useFormat, useText } from "../../_i18n/provider";
import { money, num, say, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { familyL } from "./family.text";
import { authorisedText, linesText } from "./history";
import { HOME_TEXT, type Until } from "./home.text";
import { usePortal, weekdaysText } from "./portal";
import { CallAgent } from "./call-agent";
import { Button } from "./ui";
import type { CutoffReply, Overview, PortalOrder, PortalRequest, Standing } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";
import { useProductName } from "./names";

type Fmt = ReturnType<typeof useFormat>;

/** The parts of `untilText` ("in 5 h 20 min", "in 3 days", "passed"), for the hero's bare "5 h 20 min". */
function untilParts(ms: number, now: number): Until {
  const d = ms - now;
  if (d <= 0) return { k: "passed" };
  const min = Math.round(d / 60_000);
  if (min < 60) return { k: "min", min };
  const h = Math.floor(min / 60);
  if (h < 36) return { k: "h", h, min: min % 60 };
  return { k: "days", days: Math.round(h / 24) };
}

/** "17.11." from "Tue 17.11." in any language. */
function dayMonth(iso: string, f: Fmt): string {
  return f.day(iso).replace(/^\S+ /, "");
}

/**
 * Home: a working kitchen. What needs the buyer now, the next cut-off, what the kitchen has actually ordered (from its
 * recorded history, with the period named), standing orders and their drift, and the deliveries coming.
 */
export function Home() {
  const { overview, ui } = usePortal();
  const tx = useText(HOME_TEXT);
  const [cutoffs, setCutoffs] = useState<CutoffReply>();
  const [cutoffError, setCutoffError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void ui<CutoffReply>("GET", "cutoffs").then((r) => {
      if (!live) return;
      if (r.ok) setCutoffs(r.data);
      else setCutoffError(r.error.message);
    });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [ui]);

  const o = overview.data;
  if (!o) {
    return overview.error ? (
      <div role="alert" className="mt-8 border-l-[6px] border-petrol bg-paper p-4">
        <p className="font-semibold">{tx.loadFailed}</p>
        <p className="text-ink-soft">{overview.error}</p>
        <Button className="mt-2" onClick={overview.refresh}>
          {tx.retry}
        </Button>
      </div>
    ) : (
      <div className="mt-5 space-y-4" aria-label={tx.loading}>
        <Skeleton className="h-56" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-10">
      {o.suspension && (
        <div role="alert" className="border-l-[6px] border-petrol bg-paper p-4">
          <p className="font-semibold">The purchasing agent is suspended</p>
          <p className="text-ink-soft">{say(o.suspension.message)}</p>
        </div>
      )}
      <Hero o={o} cutoffs={cutoffs} now={now} />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Attention o={o} cutoffs={cutoffs} now={now} />
        <Ledger o={o} />
      </div>
      <StandingOrders o={o} cutoffs={cutoffs} cutoffError={cutoffError} now={now} />
      <Deliveries o={o} />
    </div>
  );
}

// ---------- the top: whose kitchen, the next cut-off, the two ways to hand work over ----------

function nextCutoff(cutoffs: CutoffReply | undefined, now: number) {
  return (cutoffs?.items ?? [])
    .flatMap((i) => {
      const t = cutoffMs(i.result?.offer?.orderBy);
      return t !== undefined && t > now ? [{ ...i, t }] : [];
    })
    .sort((a, b) => a.t - b.t)[0];
}

function Hero({ o, cutoffs, now }: { o: Overview; cutoffs?: CutoffReply; now: number }) {
  const { kitchen, agent } = usePortal();
  const tx = useText(HOME_TEXT);
  const f = useFormat();
  const waiting = o.orders.filter((x) => x.status === "pending_approval").length;
  const next = nextCutoff(cutoffs, now);
  const days = o.memory.deliveryWeekdays;
  const usual = o.requests.find((r) => r.family === o.standing[0]?.family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  return (
    <section aria-label={tx.yourKitchen} className="on-dark relative overflow-hidden bg-petrol-deep text-paper">
      <div className="relative grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 p-6 sm:p-8">
          <p className="text-[1rem] text-paper/75">{tx.buysFor(kitchen.agentName)}</p>
          <h1 className="display mt-2 text-[2.8rem] text-paper sm:text-[3.8rem]">{kitchen.name}</h1>
          <p className="mt-3 max-w-[56ch] text-[1.1rem] leading-snug text-paper/90">
            {waiting ? (
              <>
                <strong className="text-safety">{tx.waiting(waiting)}</strong>{" "}
              </>
            ) : (
              tx.nothingWaiting
            )}
            {days?.length ? tx.deliveries(weekdaysText(days, f.lang)) : ""}
          </p>
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <Button kind="go" size="lg" onClick={agent.open}>
              {tx.tellAgent}
            </Button>
            {usual && (
              <Button kind="ghost-dark" size="lg" onClick={() => agent.send({ kind: "repeat", request: usual })}>
                {tx.repeatUsual(usual.family ? familyL(usual.family, f.lang) : undefined)}
              </Button>
            )}
          </div>
          <div className="mt-4 [&_button]:border-paper/70 [&_button]:bg-transparent [&_button]:text-paper [&_span]:text-paper/70">
            <CallAgent />
          </div>
        </div>
        {/* The picture is a generated illustration (DESIGN.md §6); the next cut-off sits on it as a solid plate. */}
        <div className="relative flex min-h-[15rem] items-end sm:min-h-[18rem]">
          <div className="absolute inset-0">
            <Art k="home" cover priority sizes="(min-width: 1024px) 34rem, 100vw" position="62% 50%" />
          </div>
          <div className="relative w-full bg-petrol-deep p-5 sm:m-6 sm:w-auto sm:max-w-[22rem] lg:ml-auto">
          {next ? (
            <>
              <p className="text-[0.95rem] text-paper/75">{tx.nextCutoff}</p>
              <p className="display mt-1 text-[3.2rem] text-lime tabular">{tx.span(untilParts(next.t, now))}</p>
              <p className="mt-1 leading-snug text-paper/90">
                {tx.heroLine(cutoffText(next.result?.offer?.orderBy, f.lang) ?? "", familyL(next.family, f.lang), next.result?.offer ? f.day(next.result.offer.deliveryDate) : tx.nextDay)}
              </p>
            </>
          ) : cutoffs ? (
            <>
              <p className="text-[0.95rem] text-paper/75">{tx.nextCutoff}</p>
              <p className="mt-1 leading-snug text-paper/90">{tx.noCutoff}</p>
            </>
          ) : (
            <p className="text-paper/70">{tx.checkingCutoffs}</p>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- needs you now ----------

function Attention({ o, cutoffs, now }: { o: Overview; cutoffs?: CutoffReply; now: number }) {
  const { base } = usePortal();
  const tx = useText(HOME_TEXT);
  const pn = useProductName();
  const f = useFormat();
  const waiting = o.orders.filter((x) => x.status === "pending_approval");
  const soon = (cutoffs?.items ?? []).flatMap((i) => {
    const t = cutoffMs(i.result?.offer?.orderBy);
    return t !== undefined && t > now && t - now < 24 * 3_600_000 ? [{ ...i, t }] : [];
  });
  const drift = o.standing.filter((s) => s.drift.warning);
  const empty = waiting.length === 0 && soon.length === 0 && drift.length === 0;
  const next = nextCutoff(cutoffs, now);
  return (
    <section aria-labelledby="now">
      <SectionTitle id="now">{tx.needsYou}</SectionTitle>
      {empty && (
        <Empty title={tx.nothingForYou} glyph={<CheckSquare />}>
          {next ? tx.nextCutoffIs(cutoffText(next.result?.offer?.orderBy, f.lang) ?? "", familyL(next.family, f.lang)) : ""}
          {tx.emptyNote}
        </Empty>
      )}
      <ul className="space-y-3">
        {waiting.map((w) => (
          <li key={w.orderId}>
            <WaitingCard o={w} href={`${base}/orders/${w.orderId}`} now={now} />
          </li>
        ))}
        {soon.map((s) => (
          <li key={s.productId}>
            <Plate>
              <div className="p-4 sm:p-5">
                <p className="text-[0.9rem] font-semibold text-petrol">{tx.cutoffIn(untilText(s.t, now, f.lang))}</p>
                <p className="mt-1 text-[1.3rem] font-semibold leading-snug">
                  {tx.orderBy(familyL(s.family, f.lang), cutoffText(s.result?.offer?.orderBy, f.lang) ?? "")}
                </p>
                <p className="mt-1 leading-snug text-ink-soft">
                  {tx.soonDesc(s.result?.offer ? f.day(s.result.offer.deliveryDate) : tx.nextDay, shortProduct(pn(s.productId, s.name)), s.match === "nearest")}
                </p>
                <RepeatButtons family={s.family} requests={o.requests} />
              </div>
            </Plate>
          </li>
        ))}
        {drift.map((d) => (
          <li key={d.family}>
            <Plate tone="agent">
              <div className="p-4 sm:p-5">
                <p className="text-[0.9rem] font-semibold text-lavender-deep">{tx.noticed}</p>
                <p className="mt-1 text-[1.3rem] font-semibold capitalize leading-snug">{tx.drifted(familyL(d.family, f.lang))}</p>
                <p className="mt-1 leading-snug">{d.drift.warning ? d.drift.warning.charAt(0).toUpperCase() + d.drift.warning.slice(1) : ""}</p>
                <p className="mt-1 text-[0.95rem] text-ink-soft">{tx.driftNote}</p>
              </div>
            </Plate>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckSquare() {
  return (
    <span aria-hidden className="flex size-11 items-center justify-center bg-petrol text-[1.4rem] font-bold text-paper">
      ✓
    </span>
  );
}

function WaitingCard({ o, href, now }: { o: PortalOrder; href: string; now: number }) {
  const tx = useText(HOME_TEXT);
  const pn = useProductName();
  const f = useFormat();
  const a = o.authorised;
  return (
    <div className="hazard-frame on-dark">
      <div className="flex flex-wrap items-start gap-4 p-4 text-paper">
        <Target size={48} tone="safety" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="display text-[1.9rem] leading-none text-safety">{tx.stopped}</p>
          <p className="mt-1.5 text-[1.1rem] font-semibold leading-snug">
            {tx.waitingFor(money(o.totalCents), a.by === "waiting" ? `${a.name}, ${f.role(a.role)}` : undefined)}
          </p>
          <p className="text-[0.95rem] text-paper/75">
            {tx.waitingLine(linesText(o, 2, f.lang, pn), f.day(o.deliveryDate), a.by === "waiting" ? f.ago(a.requestedAt, now) : f.ago(o.createdAt, now))}
          </p>
          {o.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 leading-snug text-paper/90">
              {o.reasons.slice(0, 3).map((r) => (
                <li key={r}>{say(r)}</li>
              ))}
            </ul>
          )}
        </div>
        <Link href={href} className={buttonClass("go")}>
          {tx.openOrder}
        </Link>
      </div>
    </div>
  );
}

/** Repeat the family's last order, or change it, from Home: the Order page does the work. */
function RepeatButtons({ family, requests }: { family: string; requests: PortalRequest[] }) {
  const { agent } = usePortal();
  const tx = useText(HOME_TEXT);
  const f = useFormat();
  const last = requests.find((r) => r.family === family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  if (!last) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <Button kind="primary" onClick={() => agent.send({ kind: "repeat", request: last })}>
        {tx.repeatLast(familyL(family, f.lang))}
      </Button>
      <Button
        kind="quiet"
        onClick={() => {
          agent.setFollowUp(last);
          agent.focus();
        }}
      >
        {tx.repeatChange}
      </Button>
    </div>
  );
}

// ---------- the kitchen's own book: what it ordered, from its recorded history ----------

function isoMonday(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

function Ledger({ o }: { o: Overview }) {
  const tx = useText(HOME_TEXT);
  const f = useFormat();
  const placed = o.orders.filter((x) => x.status === "committed" || x.status === "history");
  const familyOf = new Map(o.requests.flatMap((r) => (r.order && r.family ? [[r.order.orderId, r.family] as const] : [])));
  if (placed.length === 0)
    return (
      <section aria-labelledby="book">
        <SectionTitle id="book">{tx.ordered}</SectionTitle>
        <Empty title={tx.noOrders} glyph={<Glyph kind="case" size={44} />}>
          {tx.noOrdersNote}
        </Empty>
      </section>
    );
  const todayMonday = isoMonday(o.today);
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${todayMonday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (5 - i) * 7);
    return d.toISOString().slice(0, 10);
  });
  const byWeek = new Map(weeks.map((w) => [w, { cents: 0, orders: 0 }]));
  const since = weeks[2]; // the last four weeks, this one included
  let cents = 0;
  let orders = 0;
  const fam = new Map<string, { L: number; kg: number; cents: number }>();
  for (const x of placed) {
    const w = byWeek.get(isoMonday(x.createdAt));
    if (w) {
      w.cents += x.totalCents;
      w.orders += 1;
    }
    if (x.createdAt.slice(0, 10) < since) continue;
    cents += x.totalCents;
    orders += 1;
    for (const l of x.lines) {
      const key = familyOf.get(x.orderId) ?? (/cream|kerma/i.test(l.name) ? "cream" : /milk|maito/i.test(l.name) ? "milk" : "other");
      const acc = fam.get(key) ?? { L: 0, kg: 0, cents: 0 };
      const amount = l.quantity * (l.packSize ?? 0);
      if (l.unit === "L") acc.L += amount;
      if (l.unit === "kg") acc.kg += amount;
      acc.cents += (l.unitPriceCents ?? 0) * l.quantity;
      fam.set(key, acc);
    }
  }
  const max = Math.max(1, ...[...byWeek.values()].map((w) => w.cents));
  const last = byWeek.get(weeks[5])!;
  const end = new Date(`${o.today}T12:00:00Z`);
  const families = [...fam.entries()].filter(([k, v]) => k !== "other" && (v.L > 0 || v.kg > 0)).sort((a, b) => b[1].cents - a[1].cents);
  const vs = o.week.versusAlternative;
  return (
    <section aria-labelledby="book">
      <SectionTitle id="book" aside={tx.last4(dayMonth(since, f), dayMonth(end.toISOString().slice(0, 10), f))}>
        {tx.ordered}
      </SectionTitle>
      <Plate>
        <div className="grid gap-px bg-line sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="bg-paper p-5">
            <p className="display text-[3rem] text-ink tabular">{money(cents)}</p>
            <p className="text-ink-soft">
              {tx.inOrders(orders, money(Math.round(cents / 4)))}
            </p>
            <dl className="mt-4 space-y-1.5">
              {families.map(([k, fa]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
                  <dt className="capitalize">{familyL(k, f.lang)}</dt>
                  <dd className="font-semibold tabular">{[fa.L ? f.measure(Math.round(fa.L), "L") : "", fa.kg ? f.measure(Math.round(fa.kg), "kg") : ""].filter(Boolean).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="bg-paper p-5">
            <figcaption className="text-[0.9rem] font-semibold">{tx.eurosWeek}</figcaption>
            <div className="mt-4 flex h-36 items-end gap-[2px]" aria-hidden>
              {weeks.map((w, i) => {
                const v = byWeek.get(w)!;
                const now = i === 5;
                return (
                  <div key={w} className="group relative flex h-full flex-1 flex-col justify-end" title={tx.barTitle(f.day(w), money(v.cents), v.orders)}>
                    {now && v.cents > 0 && <span className="absolute -top-0.5 left-0 right-0 text-center text-[0.78rem] font-semibold tabular">{num(Math.round(v.cents / 100), 0)} €</span>}
                    <div className={`${now ? "border-2 border-petrol bg-petrol-soft" : "bg-petrol group-hover:bg-petrol-deep"}`} style={{ height: `${Math.max(2, (v.cents / max) * (now ? 82 : 100))}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-[2px] text-[0.75rem] text-ink-soft" aria-hidden>
              {weeks.map((w, i) => (
                <span key={w} className="flex-1 text-center">
                  {i === 5 ? tx.thisWeek : dayMonth(w, f)}
                </span>
              ))}
            </div>
            <table className="sr-only">
              <caption>{tx.caption}</caption>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w}>
                    <th>{tx.weekOf(f.day(w))}</th>
                    <td>{money(byWeek.get(w)!.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[0.85rem] leading-snug text-ink-soft">
              {tx.soFar(money(last.cents))}
            </p>
          </figure>
        </div>
        <div className="border-t border-line px-5 py-4">
          <p className="text-[0.9rem] font-semibold">{tx.agent7}</p>
          {o.week.placedAlone + o.week.sentForSignOff + o.week.corrected + o.week.refused === 0 ? (
            <p className="mt-1 leading-snug text-ink-soft">{tx.noAgent}</p>
          ) : (
            <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 leading-snug">
              <span>
                <strong className="tabular">{o.week.placedAlone}</strong>
                {tx.placedAlone}
              </span>
              <span>
                <strong className="tabular">{o.week.sentForSignOff}</strong>
                {tx.sentForSignOff}
                {o.week.waiting ? tx.nWaiting(o.week.waiting) : ""}
              </span>
              <span>
                <strong className="tabular">{o.week.corrected}</strong>
                {tx.corrected}
              </span>
              {o.week.refused > 0 && (
                <span>
                  <strong className="tabular">{o.week.refused}</strong>
                  {tx.refused}
                </span>
              )}
            </p>
          )}
          {vs.orders > 0 && (
            <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">
              {tx.versus(money(Math.abs(vs.eurCents)), vs.eurCents >= 0, vs.co2Kg !== null ? num(Math.abs(vs.co2Kg), 1) : null, vs.co2Kg !== null && vs.co2Kg >= 0, vs.orders)}
            </p>
          )}
        </div>
      </Plate>
    </section>
  );
}

// ---------- standing orders ----------

function StandingOrders({ o, cutoffs, cutoffError, now }: { o: Overview; cutoffs?: CutoffReply; cutoffError?: string; now: number }) {
  const { base } = usePortal();
  const tx = useText(HOME_TEXT);
  const rows = o.standing;
  return (
    <section aria-labelledby="standing">
      <SectionTitle id="standing" aside={cutoffError ? tx.cutoffsFailed(cutoffError) : !cutoffs ? tx.checkingShort : cutoffs.cached ? tx.cached : tx.liveCalls(cutoffs.liveCalls, cutoffs.items.length)}>
        {tx.standing}
      </SectionTitle>
      {rows.length === 0 ? (
        <Empty title={tx.noStanding} glyph={<Glyph kind="case" size={44} />} action={<Link href={`${base}/order`} className={buttonClass("primary")}>{tx.placeOrder}</Link>}>
          {tx.noStandingNote}
        </Empty>
      ) : (
        <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 22rem), 1fr))" }}>
          {rows.map((s) => (
            <StandingCard key={s.family} s={s} item={cutoffs?.items.find((i) => i.family === s.family)} requests={o.requests} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StandingCard({ s, item, requests, now }: { s: Standing; item?: CutoffReply["items"][number]; requests: PortalRequest[]; now: number }) {
  const { agent } = usePortal();
  const tx = useText(HOME_TEXT);
  const pn = useProductName();
  const f = useFormat();
  const last = requests.find((r) => r.family === s.family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  const offer = item?.result?.offer;
  const t = cutoffMs(offer?.orderBy);
  const drifted = !!s.drift.warning;
  return (
    <li className="flex flex-col bg-paper">
      <div aria-hidden className={drifted ? "h-1.5 bg-lavender-deep" : "h-1.5 bg-petrol"} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="display text-[1.9rem] capitalize text-ink">{familyL(s.family, f.lang)}</h3>
            <p className="truncate text-[0.9rem] text-ink-soft">
              {tx.productOrders(shortProduct(pn(s.product.productId, s.product.name)), s.orders)}
            </p>
          </div>
          {drifted ? <Tag tone="agent">{tx.tagDrifted}</Tag> : <Tag tone="muted">{tx.tagSteady}</Tag>}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-px bg-line">
          <div className="bg-paper py-1.5 pr-2">
            <dt className="text-[0.78rem] text-ink-soft">{tx.usual}</dt>
            <dd className="display text-[1.5rem] tabular">{f.measure(s.usual.amount, s.usual.unit)}</dd>
          </div>
          <div className="bg-paper py-1.5 pl-3 pr-2">
            <dt className="text-[0.78rem] text-ink-soft">{tx.days}</dt>
            <dd className="font-semibold leading-tight">{s.weekdays.length ? weekdaysText(s.weekdays, f.lang) : tx.noFixedDay}</dd>
          </div>
          <div className="bg-paper py-1.5 pl-3">
            <dt className="text-[0.78rem] text-ink-soft">{tx.next}</dt>
            <dd className="font-semibold leading-tight">{s.nextDue ? f.day(s.nextDue) : "–"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[0.95rem] leading-snug">
          {!item ? (
            <span className="text-ink-soft">{tx.notChecked}</span>
          ) : offer?.orderBy ? (
            <>
              {tx.orderByPrefix}
              <strong>{cutoffText(offer.orderBy, f.lang)}</strong>
              <span className="text-ink-soft">
                {tx.forDay(f.day(offer.deliveryDate), t !== undefined ? untilText(t, now, f.lang) : "")}
                {item.match === "nearest" ? tx.closest : ""}
              </span>
            </>
          ) : offer ? (
            <span className="text-ink-soft">{tx.noCutoffStated(f.day(offer.deliveryDate))}</span>
          ) : (
            <span className="text-ink-soft">{item.result?.problems.includes("cutoff_passed") ? tx.passed : tx.noOffer}</span>
          )}
        </p>
        {drifted ? (
          <p className="mt-2 bg-lavender px-2.5 py-1.5 text-[0.92rem] leading-snug">
            {s.drift.amountPct !== null && Math.abs(s.drift.amountPct) >= 10 && tx.amountDrift(s.drift.amountPct > 0 ? "+" : "−", Math.abs(s.drift.amountPct))}
            {s.drift.pricePct !== null && Math.abs(s.drift.pricePct) >= 10 && tx.priceDrift(s.drift.pricePct > 0 ? "+" : "−", Math.abs(s.drift.pricePct))}
          </p>
        ) : (
          s.drift.amountPct !== null && <p className="mt-2 text-[0.88rem] text-ink-soft">{s.drift.amountPct === 0 ? tx.matches : tx.within(Math.abs(s.drift.amountPct))}</p>
        )}
        {last && (
          <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
            <Button kind="primary" onClick={() => agent.send({ kind: "repeat", request: last })}>
              {tx.repeat}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                agent.setFollowUp(last);
                agent.focus();
              }}
            >
              {tx.repeatChange}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------- deliveries ----------

function Deliveries({ o }: { o: Overview }) {
  const { base } = usePortal();
  const tx = useText(HOME_TEXT);
  const pn = useProductName();
  const f = useFormat();
  const coming = o.orders.filter((x) => (x.status === "committed" || x.status === "pending_approval") && x.deliveryDate >= o.today).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const nextDue = o.standing.map((s) => s.nextDue).filter((d): d is string => !!d).sort()[0];
  return (
    <section aria-labelledby="deliveries">
      <SectionTitle id="deliveries">{tx.coming}</SectionTitle>
      {coming.length === 0 ? (
        <Empty title={tx.nothingBooked} glyph={<Glyph kind="case" size={44} />}>
          {nextDue ? tx.nextUsual(f.day(nextDue)) : ""}
          {tx.bookedNote}
        </Empty>
      ) : (
        <Plate>
          <ul className="divide-y divide-line">
            {coming.map((x) => (
              <li key={x.orderId}>
                <Link href={`${base}/orders/${x.orderId}`} className="grid items-baseline gap-x-5 px-5 py-3.5 hover:bg-mist sm:grid-cols-[9rem_1fr_auto]">
                  <span className="display text-[1.5rem]">{f.day(x.deliveryDate)}</span>
                  <span className="min-w-0">
                    {linesText(x, 3, f.lang, pn)}
                    <span className="block text-[0.9rem] text-ink-soft">{authorisedText(x, f.lang)}</span>
                  </span>
                  <span className="font-semibold tabular">{money(x.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Plate>
      )}
    </section>
  );
}
