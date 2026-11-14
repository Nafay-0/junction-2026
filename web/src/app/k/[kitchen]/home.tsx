"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, Check, Clock, Package, Repeat, Sparkles, Truck } from "lucide-react";
import { Card, Empty, IconDisc, Panel, SectionTitle, Skeleton, Tag, buttonClass } from "../../_ui/kit";
import { GateCard } from "../../_ui/thread";
import { Art } from "../../_ui/art";
import { useFormat, useText } from "../../_i18n/provider";
import { money, num, say, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { ThreadComposer } from "./thread";
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
      <div role="alert" className="mt-6 rounded-xl border border-bad/20 bg-bad-soft p-5">
        <p className="font-semibold">{tx.loadFailed}</p>
        <p className="text-ink-soft">{overview.error}</p>
        <Button className="mt-3" size="sm" onClick={overview.refresh}>
          {tx.retry}
        </Button>
      </div>
    ) : (
      <div className="mt-6 space-y-6" aria-label={tx.loading}>
        <Skeleton className="h-72 !rounded-[28px]" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 !rounded-[20px]" />
          <Skeleton className="h-64 !rounded-[20px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-10 sm:mt-6 sm:space-y-12">
      {o.suspension && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-safety-soft p-4 ring-1 ring-inset ring-safety/60">
          <Target size={22} tone="safety" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">The purchasing agent is suspended</p>
            <p className="text-ink-soft">{say(o.suspension.message)}</p>
          </div>
        </div>
      )}
      <Hero o={o} cutoffs={cutoffs} now={now} />
      <div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
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

/**
 * The top of Home is the way into the conversation: the kitchen, where things stand, and the agent's field. Typing or
 * speaking here is the same as in the thread; the next cut-off sits beside it because it is what makes a request urgent.
 */
function Hero({ o, cutoffs, now }: { o: Overview; cutoffs?: CutoffReply; now: number }) {
  const { kitchen, agent } = usePortal();
  const tx = useText(HOME_TEXT);
  const f = useFormat();
  const waiting = o.orders.filter((x) => x.status === "pending_approval").length;
  const next = nextCutoff(cutoffs, now);
  const days = o.memory.deliveryWeekdays;
  const usual = o.requests.find((r) => r.family === o.standing[0]?.family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  const chip = "inline-flex min-h-10 items-center gap-2 rounded-full border border-paper/25 bg-paper/8 px-4 text-[0.9rem] font-medium text-paper transition-colors duration-150 hover:bg-paper/16 pointer-coarse:min-h-11";
  return (
    <section aria-label={tx.yourKitchen} className="on-dark relative overflow-hidden rounded-2xl bg-petrol-deep text-paper">
      {/* The picture is a generated illustration (DESIGN.md, Imagery): a band on a phone, the right half on a desk. */}
      <div className="relative h-32 sm:h-40 lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[46%]">
        <Art k="home" cover priority sizes="(min-width: 1024px) 34rem, 100vw" position="62% 50%" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-petrol-deep via-petrol-deep/20 to-transparent lg:bg-gradient-to-r lg:via-petrol-deep/35" />
      </div>
      <div className="relative grid gap-6 p-4 pt-3 sm:p-8 sm:pt-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10 lg:p-10">
        <div className="min-w-0">
          <p className="text-[0.92rem] text-paper/70">{tx.buysFor(kitchen.agentName)}</p>
          <h1 className="display mt-1.5 text-[2.1rem] text-paper sm:text-[2.9rem] lg:text-[3.3rem]">{kitchen.name}</h1>
          <p className="mt-3 max-w-[52ch] text-[1.02rem] leading-relaxed text-paper/85">
            {waiting ? (
              <>
                <strong className="font-semibold text-safety">{tx.waiting(waiting)}</strong>{" "}
              </>
            ) : (
              tx.nothingWaiting
            )}
            {days?.length ? tx.deliveries(weekdaysText(days, f.lang)) : ""}
          </p>
          <div className="mt-6 max-w-[38rem] text-ink">
            {/* Typing, speaking or a photo here goes straight into the thread, which then opens. */}
            <ThreadComposer id="need-home" size="lg" standalone label={tx.tellAgent} placeholder={tx.tellAgent} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {usual && (
              <button type="button" className={chip} onClick={() => agent.send({ kind: "repeat", request: usual })}>
                <Repeat aria-hidden size={15} />
                {tx.repeatUsual(usual.family ? familyL(usual.family, f.lang) : undefined)}
              </button>
            )}
            {kitchen.examples.slice(0, usual ? 1 : 2).map((ex) => (
              <button key={ex} type="button" className={`${chip} max-w-full`} onClick={() => agent.send({ kind: "ask", text: ex })}>
                <span className="truncate">“{ex}”</span>
              </button>
            ))}
          </div>
          <div className="mt-4 [&_a]:bg-paper/12 [&_a]:text-paper [&_button]:border-paper/25 [&_button]:bg-transparent [&_button]:text-paper [&_button:hover]:bg-paper/12 [&_span]:text-paper/70">
            <CallAgent />
          </div>
        </div>
        <div className="flex items-end lg:justify-end">
          <div className="w-full rounded-xl bg-petrol-deep/70 p-5 ring-1 ring-paper/15 backdrop-blur-md lg:max-w-[21rem]">
            <p className="flex items-center gap-2 text-[0.86rem] text-paper/70">
              <CalendarClock aria-hidden size={16} />
              {tx.nextCutoff}
            </p>
            {next ? (
              <>
                <p className="display mt-2 text-[2.6rem] text-lime tabular">{tx.span(untilParts(next.t, now))}</p>
                <p className="mt-1.5 text-[0.95rem] leading-snug text-paper/85">
                  {tx.heroLine(cutoffText(next.result?.offer?.orderBy, f.lang) ?? "", familyL(next.family, f.lang), next.result?.offer ? f.day(next.result.offer.deliveryDate) : tx.nextDay)}
                </p>
              </>
            ) : cutoffs ? (
              <p className="mt-2 text-[0.95rem] leading-snug text-paper/85">{tx.noCutoff}</p>
            ) : (
              <div className="mt-3 space-y-2" role="status" aria-label={tx.checkingCutoffs}>
                <span className="block h-8 w-32 animate-pulse rounded-md bg-paper/12 motion-reduce:animate-none" />
                <span className="block h-3 w-48 animate-pulse rounded-md bg-paper/12 motion-reduce:animate-none" />
              </div>
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
        <Empty
          title={tx.nothingForYou}
          glyph={
            <IconDisc tone="good">
              <Check size={22} strokeWidth={2.4} />
            </IconDisc>
          }
        >
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
            <Card pad>
              <div className="flex items-start gap-4">
                <IconDisc>
                  <Clock size={20} />
                </IconDisc>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.86rem] font-medium text-petrol">{tx.cutoffIn(untilText(s.t, now, f.lang))}</p>
                  <p className="mt-0.5 text-[1.15rem] font-semibold leading-snug">{tx.orderBy(familyL(s.family, f.lang), cutoffText(s.result?.offer?.orderBy, f.lang) ?? "")}</p>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-soft">{tx.soonDesc(s.result?.offer ? f.day(s.result.offer.deliveryDate) : tx.nextDay, shortProduct(pn(s.productId, s.name)), s.match === "nearest")}</p>
                  <RepeatButtons family={s.family} requests={o.requests} />
                </div>
              </div>
            </Card>
          </li>
        ))}
        {drift.map((d) => (
          <li key={d.family}>
            <Panel tone="agent" className="p-5">
              <p className="flex items-center gap-2 text-[0.86rem] font-medium text-lavender-deep">
                <Sparkles aria-hidden size={15} />
                {tx.noticed}
              </p>
              <p className="mt-1 text-[1.15rem] font-semibold capitalize leading-snug">{tx.drifted(familyL(d.family, f.lang))}</p>
              <p className="mt-1 leading-relaxed">{d.drift.warning ? d.drift.warning.charAt(0).toUpperCase() + d.drift.warning.slice(1) : ""}</p>
              <p className="mt-1 text-[0.9rem] text-ink-soft">{tx.driftNote}</p>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An order stopped at the gate and waiting for its person: the gate's own card, as it looks in the thread. */
function WaitingCard({ o, href, now }: { o: PortalOrder; href: string; now: number }) {
  const tx = useText(HOME_TEXT);
  const f = useFormat();
  const pn = useProductName();
  const a = o.authorised;
  return (
    <GateCard
      state="waiting"
      kind={tx.waitingLine(linesText(o, 2, f.lang, pn), f.day(o.deliveryDate), a.by === "waiting" ? f.ago(a.requestedAt, now) : f.ago(o.createdAt, now))}
      title={tx.stopped}
      reason={
        <>
          {tx.waitingFor(money(o.totalCents), a.by === "waiting" ? `${a.name}, ${f.role(a.role)}` : undefined)}
          {o.reasons.length > 0 && (
            <span className="mt-1.5 block space-y-0.5 text-[0.9rem] text-paper/75">
              {o.reasons.slice(0, 3).map((r) => (
                <span key={r} className="block">
                  {say(r)}
                </span>
              ))}
            </span>
          )}
        </>
      }
      approver={a.by === "waiting" ? { name: a.name, role: f.role(a.role) } : undefined}
      actions={
        <Link href={href} className={buttonClass("go", "sm")}>
          {tx.openOrder}
        </Link>
      }
    />
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
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
      <Button kind="primary" size="sm" onClick={() => agent.send({ kind: "repeat", request: last })}>
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
        <Empty
          title={tx.noOrders}
          glyph={
            <IconDisc tone="muted">
              <Package size={21} />
            </IconDisc>
          }
        >
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
      <Card>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="p-5 sm:p-6">
            <p className="display text-[2.6rem] text-ink tabular">{money(cents)}</p>
            <p className="mt-1 text-[0.92rem] text-ink-soft">{tx.inOrders(orders, money(Math.round(cents / 4)))}</p>
            <dl className="mt-5 divide-y divide-line">
              {families.map(([k, fa]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="capitalize">{familyL(k, f.lang)}</dt>
                  <dd className="font-semibold tabular">{[fa.L ? f.measure(Math.round(fa.L), "L") : "", fa.kg ? f.measure(Math.round(fa.kg), "kg") : ""].filter(Boolean).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="border-t border-line p-5 sm:border-l sm:border-t-0 sm:p-6">
            <figcaption className="text-[0.86rem] font-medium text-ink-soft">{tx.eurosWeek}</figcaption>
            <div className="mt-5 flex h-36 items-end gap-2" aria-hidden>
              {weeks.map((w, i) => {
                const v = byWeek.get(w)!;
                const now = i === 5;
                return (
                  <div key={w} className="group relative flex h-full flex-1 flex-col justify-end" title={tx.barTitle(f.day(w), money(v.cents), v.orders)}>
                    {now && v.cents > 0 && <span className="absolute -top-1 left-0 right-0 whitespace-nowrap text-center text-[0.76rem] font-semibold tabular">{num(Math.round(v.cents / 100), 0)} €</span>}
                    <div
                      className={`rounded-t-md transition-colors duration-150 ${now ? "bg-lime ring-1 ring-inset ring-ink/10" : "bg-petrol/80 group-hover:bg-petrol"}`}
                      style={{ height: `${Math.max(2, (v.cents / max) * (now ? 82 : 100))}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2 border-t border-line pt-1.5 text-[0.72rem] text-ink-soft" aria-hidden>
              {weeks.map((w, i) => (
                <span key={w} className={`flex-1 text-center ${i === 5 ? "font-semibold text-ink" : ""}`}>
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
            <p className="mt-3 text-[0.82rem] leading-snug text-ink-soft">{tx.soFar(money(last.cents))}</p>
          </figure>
        </div>
        <div className="border-t border-line bg-mist/60 px-5 py-4 sm:px-6">
          <p className="flex items-center gap-2 text-[0.86rem] font-medium text-lavender-deep">
            <Sparkles aria-hidden size={15} />
            {tx.agent7}
          </p>
          {o.week.placedAlone + o.week.sentForSignOff + o.week.corrected + o.week.refused === 0 ? (
            <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-soft">{tx.noAgent}</p>
          ) : (
            <p className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 leading-snug">
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
            <p className="mt-1.5 text-[0.88rem] leading-snug text-ink-soft">
              {tx.versus(money(Math.abs(vs.eurCents)), vs.eurCents >= 0, vs.co2Kg !== null ? num(Math.abs(vs.co2Kg), 1) : null, vs.co2Kg !== null && vs.co2Kg >= 0, vs.orders)}
            </p>
          )}
        </div>
      </Card>
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
        <Empty
          title={tx.noStanding}
          glyph={
            <IconDisc tone="muted">
              <Repeat size={20} />
            </IconDisc>
          }
          action={
            <Link href={`${base}/order`} className={buttonClass("primary", "sm")}>
              {tx.placeOrder}
            </Link>
          }
        >
          {tx.noStandingNote}
        </Empty>
      ) : (
        <ul className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 21rem), 1fr))" }}>
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
    <Card as="li" className="flex flex-col">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="display text-[1.4rem] capitalize text-ink">{familyL(s.family, f.lang)}</h3>
            <p className="mt-0.5 truncate text-[0.86rem] text-ink-soft">{tx.productOrders(shortProduct(pn(s.product.productId, s.product.name)), s.orders)}</p>
          </div>
          {drifted ? <Tag tone="agent">{tx.tagDrifted}</Tag> : <Tag tone="muted">{tx.tagSteady}</Tag>}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-surface px-3.5 py-3">
          <div className="min-w-0">
            <dt className="text-[0.74rem] text-ink-soft">{tx.usual}</dt>
            <dd className="display mt-0.5 text-[1.25rem] tabular">{f.measure(s.usual.amount, s.usual.unit)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.74rem] text-ink-soft">{tx.days}</dt>
            <dd className="mt-1 text-[0.95rem] font-semibold leading-tight">{s.weekdays.length ? weekdaysText(s.weekdays, f.lang) : tx.noFixedDay}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.74rem] text-ink-soft">{tx.next}</dt>
            <dd className="mt-1 text-[0.95rem] font-semibold leading-tight">{s.nextDue ? f.day(s.nextDue) : "–"}</dd>
          </div>
        </dl>
        <p className="mt-3.5 text-[0.92rem] leading-relaxed">
          {!item ? (
            <span className="text-ink-soft">{tx.notChecked}</span>
          ) : offer?.orderBy ? (
            <>
              {tx.orderByPrefix}
              <strong className="font-semibold">{cutoffText(offer.orderBy, f.lang)}</strong>
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
          <p className="mt-2.5 flex items-start gap-2 rounded-md bg-lavender px-3 py-2 text-[0.88rem] leading-snug">
            <Sparkles aria-hidden size={14} className="mt-[0.2em] shrink-0 text-lavender-deep" />
            <span>
              {s.drift.amountPct !== null && Math.abs(s.drift.amountPct) >= 10 && tx.amountDrift(s.drift.amountPct > 0 ? "+" : "−", Math.abs(s.drift.amountPct))}
              {s.drift.pricePct !== null && Math.abs(s.drift.pricePct) >= 10 && tx.priceDrift(s.drift.pricePct > 0 ? "+" : "−", Math.abs(s.drift.pricePct))}
            </span>
          </p>
        ) : (
          s.drift.amountPct !== null && <p className="mt-2 text-[0.84rem] text-ink-soft">{s.drift.amountPct === 0 ? tx.matches : tx.within(Math.abs(s.drift.amountPct))}</p>
        )}
        {last && (
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1 pt-4">
            <Button kind="primary" size="sm" onClick={() => agent.send({ kind: "repeat", request: last })}>
              <Repeat aria-hidden size={15} />
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
    </Card>
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
        <Empty
          title={tx.nothingBooked}
          glyph={
            <IconDisc tone="muted">
              <Truck size={21} />
            </IconDisc>
          }
        >
          {nextDue ? tx.nextUsual(f.day(nextDue)) : ""}
          {tx.bookedNote}
        </Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {coming.map((x) => {
              const [weekday, ...rest] = f.day(x.deliveryDate).split(" ");
              return (
                <li key={x.orderId}>
                  <Link href={`${base}/orders/${x.orderId}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-mist sm:px-5">
                    <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-petrol-soft py-1.5 text-petrol-deep">
                      <span className="text-[0.72rem] font-medium leading-tight">{weekday}</span>
                      <span className="display text-[1.05rem] leading-tight tabular">{rest.join(" ") || weekday}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{linesText(x, 3, f.lang, pn)}</span>
                      <span className="mt-0.5 block text-[0.86rem] text-ink-soft">{authorisedText(x, f.lang)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular">{money(x.totalCents)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
