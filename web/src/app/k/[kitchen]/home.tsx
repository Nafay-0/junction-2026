"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Plate, SectionTitle, Skeleton, Tag, buttonClass } from "../../_ui/kit";
import { Glyph } from "../../_ui/glyphs";
import { ago, attr, day, measure, money, num, roleLabel, say, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { authorisedText, linesText } from "./history";
import { usePortal, weekdaysText } from "./portal";
import { CallAgent } from "./call-agent";
import { Button } from "./ui";
import type { CutoffReply, Overview, PortalOrder, PortalRequest, Standing } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";

/**
 * Home: a working kitchen. What needs the buyer now, the next cut-off, what the kitchen has actually ordered (from its
 * recorded history, with the period named), standing orders and their drift, and the deliveries coming.
 */
export function Home() {
  const { overview, ui } = usePortal();
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
        <p className="font-semibold">The kitchen&apos;s page did not load</p>
        <p className="text-ink-soft">{overview.error}</p>
        <Button className="mt-2" onClick={overview.refresh}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="mt-5 space-y-4" aria-label="Loading the kitchen's page">
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
  const waiting = o.orders.filter((x) => x.status === "pending_approval").length;
  const next = nextCutoff(cutoffs, now);
  const days = o.memory.deliveryWeekdays;
  const usual = o.requests.find((r) => r.family === o.standing[0]?.family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  return (
    <section aria-label="Your kitchen" className="on-dark relative overflow-hidden bg-petrol-deep text-paper">
      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <p className="text-[1rem] text-paper/75">{kitchen.agentName} buys for this kitchen within its signed rules.</p>
          <h1 className="display mt-2 text-[2.8rem] text-paper sm:text-[3.8rem]">{kitchen.name}</h1>
          <p className="mt-3 max-w-[56ch] text-[1.1rem] leading-snug text-paper/90">
            {waiting ? (
              <>
                <strong className="text-safety">
                  {waiting} order{waiting === 1 ? " is" : "s are"} waiting for a person.
                </strong>{" "}
              </>
            ) : (
              "Nothing is waiting for a person. "
            )}
            {days?.length ? `Deliveries ${weekdaysText(days)}.` : ""}
          </p>
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <Button kind="go" size="lg" onClick={agent.open}>
              Tell the agent what you need
            </Button>
            {usual && (
              <Button kind="ghost-dark" size="lg" onClick={() => agent.send({ kind: "repeat", request: usual })}>
                Repeat the usual {attr(usual.family ?? "order")}
              </Button>
            )}
          </div>
          <div className="mt-4 [&_button]:border-paper/70 [&_button]:bg-transparent [&_button]:text-paper [&_span]:text-paper/70">
            <CallAgent />
          </div>
        </div>
        <div className="self-end border-l-0 border-paper/20 lg:border-l lg:pl-6">
          {next ? (
            <>
              <p className="text-[0.95rem] text-paper/75">Next order cut-off</p>
              <p className="display mt-1 text-[3.2rem] text-lime tabular">{untilText(next.t, now).replace(/^in /, "")}</p>
              <p className="mt-1 leading-snug text-paper/90">
                {cutoffText(next.result?.offer?.orderBy)} for {attr(next.family)}, delivered {next.result?.offer ? day(next.result.offer.deliveryDate) : "the next day"}.
              </p>
            </>
          ) : cutoffs ? (
            <>
              <p className="text-[0.95rem] text-paper/75">Next order cut-off</p>
              <p className="mt-1 leading-snug text-paper/90">No open cut-off for the usual products right now. The agent checks again when you order.</p>
            </>
          ) : (
            <p className="text-paper/70">Checking the order cut-offs…</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- needs you now ----------

function Attention({ o, cutoffs, now }: { o: Overview; cutoffs?: CutoffReply; now: number }) {
  const { base } = usePortal();
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
      <SectionTitle id="now">Needs you now</SectionTitle>
      {empty && (
        <Empty title="Nothing is waiting for you." glyph={<CheckSquare />}>
          {next ? `Your next cut-off is ${cutoffText(next.result?.offer?.orderBy)}, for ${attr(next.family)}. ` : ""}Sign-offs, cut-offs within a day and standing orders that drift from the usual show up here.
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
                <p className="text-[0.9rem] font-semibold text-petrol">Cut-off {untilText(s.t, now)}</p>
                <p className="mt-1 text-[1.3rem] font-semibold leading-snug">
                  Order {attr(s.family)} by {cutoffText(s.result?.offer?.orderBy)}
                </p>
                <p className="mt-1 leading-snug text-ink-soft">
                  The wholesaler&apos;s cut-off for delivery on {s.result?.offer ? day(s.result.offer.deliveryDate) : "the next day"}, for {shortProduct(s.name)}
                  {s.match === "nearest" ? " (the closest product in today's catalogue to the usual one)" : ""}.
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
                <p className="text-[0.9rem] font-semibold text-lavender-deep">The agent noticed</p>
                <p className="mt-1 text-[1.3rem] font-semibold capitalize leading-snug">{attr(d.family)}: the standing order has drifted</p>
                <p className="mt-1 leading-snug">{d.drift.warning ? d.drift.warning.charAt(0).toUpperCase() + d.drift.warning.slice(1) : ""}</p>
                <p className="mt-1 text-[0.95rem] text-ink-soft">The agent does not renew it unchanged: a repeat is checked against the usual amount first, and anything unusual is asked.</p>
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
  const a = o.authorised;
  return (
    <div className="hazard-frame on-dark">
      <div className="flex flex-wrap items-start gap-4 p-4 text-paper">
        <Target size={48} tone="safety" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="display text-[1.9rem] leading-none text-safety">Stopped at the gate</p>
          <p className="mt-1.5 text-[1.1rem] font-semibold leading-snug">
            {money(o.totalCents)} waiting for {a.by === "waiting" ? `${a.name}, ${roleLabel(a.role)}` : "a sign-off"}
          </p>
          <p className="text-[0.95rem] text-paper/75">
            {linesText(o)}, delivery {day(o.deliveryDate)}. Asked {a.by === "waiting" ? ago(a.requestedAt, now) : ago(o.createdAt, now)}.
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
          Open the order
        </Link>
      </div>
    </div>
  );
}

/** Repeat the family's last order, or change it, from Home: the Order page does the work. */
function RepeatButtons({ family, requests }: { family: string; requests: PortalRequest[] }) {
  const { agent } = usePortal();
  const last = requests.find((r) => r.family === family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  if (!last) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <Button kind="primary" onClick={() => agent.send({ kind: "repeat", request: last })}>
        Repeat the last {attr(family)} order
      </Button>
      <Button
        kind="quiet"
        onClick={() => {
          agent.setFollowUp(last);
          agent.focus();
        }}
      >
        Repeat with a change
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
  const placed = o.orders.filter((x) => x.status === "committed" || x.status === "history");
  const familyOf = new Map(o.requests.flatMap((r) => (r.order && r.family ? [[r.order.orderId, r.family] as const] : [])));
  if (placed.length === 0)
    return (
      <section aria-labelledby="book">
        <SectionTitle id="book">What the kitchen ordered</SectionTitle>
        <Empty title="No orders yet" glyph={<Glyph kind="case" size={44} />}>
          This kitchen has no order history here. The first order, by the agent or from the basket, starts its book: amounts, euros and the usual days.
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
      const f = fam.get(key) ?? { L: 0, kg: 0, cents: 0 };
      const amount = l.quantity * (l.packSize ?? 0);
      if (l.unit === "L") f.L += amount;
      if (l.unit === "kg") f.kg += amount;
      f.cents += (l.unitPriceCents ?? 0) * l.quantity;
      fam.set(key, f);
    }
  }
  const max = Math.max(1, ...[...byWeek.values()].map((w) => w.cents));
  const last = byWeek.get(weeks[5])!;
  const end = new Date(`${o.today}T12:00:00Z`);
  const families = [...fam.entries()].filter(([k, f]) => k !== "other" && (f.L > 0 || f.kg > 0)).sort((a, b) => b[1].cents - a[1].cents);
  const vs = o.week.versusAlternative;
  return (
    <section aria-labelledby="book">
      <SectionTitle id="book" aside={`Last 4 weeks, ${day(since).slice(4)}–${day(end.toISOString().slice(0, 10)).slice(4)}`}>
        What the kitchen ordered
      </SectionTitle>
      <Plate>
        <div className="grid gap-px bg-line sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="bg-paper p-5">
            <p className="display text-[3rem] text-ink tabular">{money(cents)}</p>
            <p className="text-ink-soft">
              in {orders} order{orders === 1 ? "" : "s"}, about {money(Math.round(cents / 4))} a week
            </p>
            <dl className="mt-4 space-y-1.5">
              {families.map(([k, f]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
                  <dt className="capitalize">{attr(k)}</dt>
                  <dd className="font-semibold tabular">{[f.L ? measure(Math.round(f.L), "L") : "", f.kg ? measure(Math.round(f.kg), "kg") : ""].filter(Boolean).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="bg-paper p-5">
            <figcaption className="text-[0.9rem] font-semibold">Euros a week, last six weeks</figcaption>
            <div className="mt-4 flex h-36 items-end gap-[2px]" aria-hidden>
              {weeks.map((w, i) => {
                const v = byWeek.get(w)!;
                const now = i === 5;
                return (
                  <div key={w} className="group relative flex h-full flex-1 flex-col justify-end" title={`Week of ${day(w)}: ${money(v.cents)}, ${v.orders} order${v.orders === 1 ? "" : "s"}`}>
                    {now && v.cents > 0 && <span className="absolute -top-0.5 left-0 right-0 text-center text-[0.78rem] font-semibold tabular">{num(Math.round(v.cents / 100), 0)} €</span>}
                    <div className={`${now ? "border-2 border-petrol bg-petrol-soft" : "bg-petrol group-hover:bg-petrol-deep"}`} style={{ height: `${Math.max(2, (v.cents / max) * (now ? 82 : 100))}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-[2px] text-[0.75rem] text-ink-soft" aria-hidden>
              {weeks.map((w, i) => (
                <span key={w} className="flex-1 text-center">
                  {i === 5 ? "this week" : day(w).slice(4)}
                </span>
              ))}
            </div>
            <table className="sr-only">
              <caption>Euros ordered per week</caption>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w}>
                    <th>Week of {day(w)}</th>
                    <td>{money(byWeek.get(w)!.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[0.85rem] leading-snug text-ink-soft">
              This week so far: {money(last.cents)}. Weeks start on Monday. The bars include the history the kitchen brought with it.
            </p>
          </figure>
        </div>
        <div className="border-t border-line px-5 py-4">
          <p className="text-[0.9rem] font-semibold">The agent, last 7 days</p>
          {o.week.placedAlone + o.week.sentForSignOff + o.week.corrected + o.week.refused === 0 ? (
            <p className="mt-1 leading-snug text-ink-soft">No requests through the agent this week yet. The orders above came from the kitchen&apos;s history; the agent learned its usual amounts and days from them.</p>
          ) : (
            <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 leading-snug">
              <span>
                <strong className="tabular">{o.week.placedAlone}</strong> placed alone
              </span>
              <span>
                <strong className="tabular">{o.week.sentForSignOff}</strong> sent for sign-off{o.week.waiting ? `, ${o.week.waiting} waiting` : ""}
              </span>
              <span>
                <strong className="tabular">{o.week.corrected}</strong> corrected by the mistake check
              </span>
              {o.week.refused > 0 && (
                <span>
                  <strong className="tabular">{o.week.refused}</strong> refused by the gate
                </span>
              )}
            </p>
          )}
          {vs.orders > 0 && (
            <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">
              {money(Math.abs(vs.eurCents))} {vs.eurCents >= 0 ? "less" : "more"}
              {vs.co2Kg !== null ? ` and ${num(Math.abs(vs.co2Kg), 1)} kg CO2e ${vs.co2Kg >= 0 ? "less" : "more"}` : ""} than the cheapest option offered and not chosen, over {vs.orders} order{vs.orders === 1 ? "" : "s"}.
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
  const rows = o.standing;
  return (
    <section aria-labelledby="standing">
      <SectionTitle id="standing" aside={cutoffError ? `Cut-offs not checked: ${cutoffError}` : !cutoffs ? "Checking order cut-offs…" : cutoffs.cached ? "Cut-offs checked earlier, no live call now" : `Cut-offs: ${cutoffs.liveCalls} live call for ${cutoffs.items.length} products`}>
        Standing orders
      </SectionTitle>
      {rows.length === 0 ? (
        <Empty title="No standing orders yet" glyph={<Glyph kind="case" size={44} />} action={<Link href={`${base}/order`} className={buttonClass("primary")}>Place an order</Link>}>
          After three orders of the same kind, the agent keeps them here with their usual days and amounts, and warns when they drift.
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
            <h3 className="display text-[1.9rem] capitalize text-ink">{attr(s.family)}</h3>
            <p className="truncate text-[0.9rem] text-ink-soft">
              {shortProduct(s.product.name)}, {s.orders} orders
            </p>
          </div>
          {drifted ? <Tag tone="agent">Drifted</Tag> : <Tag tone="muted">Steady</Tag>}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-px bg-line">
          <div className="bg-paper py-1.5 pr-2">
            <dt className="text-[0.78rem] text-ink-soft">Usual</dt>
            <dd className="display text-[1.5rem] tabular">{measure(s.usual.amount, s.usual.unit)}</dd>
          </div>
          <div className="bg-paper py-1.5 pl-3 pr-2">
            <dt className="text-[0.78rem] text-ink-soft">Days</dt>
            <dd className="font-semibold leading-tight">{s.weekdays.length ? weekdaysText(s.weekdays) : "No fixed day"}</dd>
          </div>
          <div className="bg-paper py-1.5 pl-3">
            <dt className="text-[0.78rem] text-ink-soft">Next</dt>
            <dd className="font-semibold leading-tight">{s.nextDue ? day(s.nextDue) : "–"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[0.95rem] leading-snug">
          {!item ? (
            <span className="text-ink-soft">Cut-off not checked yet.</span>
          ) : offer?.orderBy ? (
            <>
              Order by <strong>{cutoffText(offer.orderBy)}</strong>
              <span className="text-ink-soft">
                {" "}
                for {day(offer.deliveryDate)}, {t !== undefined ? untilText(t, now) : ""}
                {item.match === "nearest" ? "; closest product in the catalogue" : ""}
              </span>
            </>
          ) : offer ? (
            <span className="text-ink-soft">Delivery {day(offer.deliveryDate)}, no cut-off stated.</span>
          ) : (
            <span className="text-ink-soft">{item.result?.problems.includes("cutoff_passed") ? "The cut-off for the next day has passed." : "No offer right now."}</span>
          )}
        </p>
        {drifted ? (
          <p className="mt-2 bg-lavender px-2.5 py-1.5 text-[0.92rem] leading-snug">
            {s.drift.amountPct !== null && Math.abs(s.drift.amountPct) >= 10 && <>Amount {s.drift.amountPct > 0 ? "+" : "−"}{Math.abs(s.drift.amountPct)} % on the usual. </>}
            {s.drift.pricePct !== null && Math.abs(s.drift.pricePct) >= 10 && <>Price {s.drift.pricePct > 0 ? "+" : "−"}{Math.abs(s.drift.pricePct)} % on the usual.</>}
          </p>
        ) : (
          s.drift.amountPct !== null && <p className="mt-2 text-[0.88rem] text-ink-soft">{s.drift.amountPct === 0 ? "The last orders match the usual amount." : `The last orders are within ${Math.abs(s.drift.amountPct)} % of the usual amount.`}</p>
        )}
        {last && (
          <div className="mt-auto flex flex-wrap items-center gap-4 pt-4">
            <Button kind="primary" onClick={() => agent.send({ kind: "repeat", request: last })}>
              Repeat
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                agent.setFollowUp(last);
                agent.focus();
              }}
            >
              Repeat with a change
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
  const coming = o.orders.filter((x) => (x.status === "committed" || x.status === "pending_approval") && x.deliveryDate >= o.today).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const nextDue = o.standing.map((s) => s.nextDue).filter((d): d is string => !!d).sort()[0];
  return (
    <section aria-labelledby="deliveries">
      <SectionTitle id="deliveries">Deliveries coming</SectionTitle>
      {coming.length === 0 ? (
        <Empty title="Nothing booked yet" glyph={<Glyph kind="case" size={44} />}>
          {nextDue ? `Next usual delivery day: ${day(nextDue)} ` : ""}Orders placed here, by the agent or from the basket, appear with their delivery day.
        </Empty>
      ) : (
        <Plate>
          <ul className="divide-y divide-line">
            {coming.map((x) => (
              <li key={x.orderId}>
                <Link href={`${base}/orders/${x.orderId}`} className="grid items-baseline gap-x-5 px-5 py-3.5 hover:bg-mist sm:grid-cols-[9rem_1fr_auto]">
                  <span className="display text-[1.5rem]">{day(x.deliveryDate)}</span>
                  <span className="min-w-0">
                    {linesText(x, 3)}
                    <span className="block text-[0.9rem] text-ink-soft">{authorisedText(x)}</span>
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
