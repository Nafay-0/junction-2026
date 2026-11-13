"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, amount, attr, day, eur, humanize, roleLabel, shortProduct } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { authorisedText, linesText } from "./history";
import { usePortal, weekdaysText } from "./portal";
import { CallAgent } from "./call-agent";
import { Button, Paper } from "./ui";
import type { CutoffReply, Overview, PortalOrder, PortalRequest, Standing } from "./types";
import { cutoffMs, cutoffText, untilText } from "./when";

/** Home: what needs the buyer's attention now, what the agent did this week, standing orders and their drift. */
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
      <div role="alert" className="mt-8 border-l-[6px] border-ink bg-paper p-4">
        <p className="font-semibold">The kitchen&apos;s page did not load</p>
        <p className="text-ink-soft">{overview.error}</p>
        <Button className="mt-2" onClick={overview.refresh}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" aria-label="Loading the kitchen's page">
        <div className="h-64 animate-pulse bg-paper/60" />
        <div className="h-64 animate-pulse bg-paper/60" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      <Greeting o={o} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Attention o={o} cutoffs={cutoffs} now={now} />
        <ThisWeek o={o} />
      </div>
      <StandingOrders o={o} cutoffs={cutoffs} cutoffError={cutoffError} now={now} />
      <Deliveries o={o} />
    </div>
  );
}

/** The top of Home: whose shop this is, and the two ways to hand work to the agent. */
function Greeting({ o }: { o: Overview }) {
  const { kitchen, agent } = usePortal();
  const waiting = o.orders.filter((x) => x.status === "pending_approval").length;
  return (
    <section aria-label="Your agent" className="flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-ink pb-4">
      <div>
        <h1 className="font-display text-[2.2rem] font-bold leading-tight tracking-tight">{kitchen.name}</h1>
        <p className="text-[1.05rem] text-ink-soft">
          {kitchen.agentName} buys for this kitchen within its signed rules.{" "}
          {waiting ? `${waiting} order${waiting === 1 ? " is" : "s are"} waiting for a person.` : "Nothing is waiting for a person."}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Button kind="primary" onClick={agent.open}>
          Tell the agent what you need
        </Button>
        <CallAgent />
      </div>
    </section>
  );
}

function SectionTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
      <h2 id={id} className="font-display text-[1.6rem] font-bold leading-tight tracking-tight">
        {children}
      </h2>
      {aside}
    </div>
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
  return (
    <section aria-labelledby="now">
      <SectionTitle id="now">Needs you now</SectionTitle>
      {empty && (
        <Paper>
          <p className="flex items-center gap-3 p-4 text-[1.05rem]">
            <Target size={28} tone="ink" />
            <span>
              <strong>Nothing is waiting for you.</strong> <span className="text-ink-soft">Sign-offs, order cut-offs within a day and standing orders that drifted from the usual show up here.</span>
            </span>
          </p>
        </Paper>
      )}
      <ul className="space-y-3">
        {waiting.map((w) => (
          <li key={w.orderId}>
            <WaitingCard o={w} href={`${base}/orders/${w.orderId}`} now={now} />
          </li>
        ))}
        {soon.map((s) => (
          <li key={s.productId}>
            <Paper>
              <div className="p-4">
                <p className="font-display text-[1.35rem] font-bold leading-tight">
                  Order {attr(s.family)} by {cutoffText(s.result?.offer?.orderBy)} <span className="font-semibold text-ink-soft">({untilText(s.t, now)})</span>
                </p>
                <p className="mt-1 leading-snug text-ink-soft">
                  That is the wholesaler&apos;s cut-off for delivery on {s.result?.offer ? day(s.result.offer.deliveryDate) : "the next day"}, for {shortProduct(s.name)}
                  {s.match === "nearest" ? " (the closest product in today's catalogue to the usual one)" : ""}.
                </p>
                <RepeatButtons family={s.family} requests={o.requests} />
              </div>
            </Paper>
          </li>
        ))}
        {drift.map((d) => (
          <li key={d.family}>
            <Paper>
              <div className="p-4">
                <p className="font-display text-[1.35rem] font-bold leading-tight capitalize">{attr(d.family)}: the standing order has drifted</p>
                <p className="mt-1 leading-snug">{d.drift.warning ? d.drift.warning.charAt(0).toUpperCase() + d.drift.warning.slice(1) : ""}</p>
                <p className="mt-1 text-[0.95rem] text-ink-soft">The agent does not renew it unchanged: a repeat is checked against the usual amount first, and anything unusual is asked.</p>
              </div>
            </Paper>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WaitingCard({ o, href, now }: { o: PortalOrder; href: string; now: number }) {
  const a = o.authorised;
  return (
    <div className="bg-paper">
      <div aria-hidden className="hazard h-3" />
      <div className="flex flex-wrap items-start gap-4 p-4">
        <Target size={44} tone="safety" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[1.45rem] font-bold leading-tight">
            {eur(o.totalCents)} waiting for {a.by === "waiting" ? `${a.name}, ${roleLabel(a.role)}` : "a sign-off"}
          </p>
          <p className="text-[0.95rem] text-ink-soft">
            {linesText(o)}, delivery {day(o.deliveryDate)}. Asked {a.by === "waiting" ? ago(a.requestedAt, now) : ago(o.createdAt, now)}.
          </p>
          {o.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 leading-snug">
              {o.reasons.slice(0, 3).map((r) => (
                <li key={r}>– {humanize(r)}</li>
              ))}
            </ul>
          )}
        </div>
        <Link href={href} className="inline-flex min-h-11 items-center bg-ink px-4 font-semibold text-paper hover:bg-ink-soft">
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
    <div className="mt-3 flex flex-wrap gap-2">
      <Button kind="primary" onClick={() => agent.send({ kind: "repeat", request: last })}>
        Repeat the last {attr(family)} order
      </Button>
      <Button
        kind="secondary"
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

// ---------- this week ----------

function ThisWeek({ o }: { o: Overview }) {
  const w = o.week;
  const vs = w.versusAlternative;
  const signed = (n: number, unit: string, less: string, more: string) => `${unit === "€" ? eur(Math.abs(n)) : `${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg CO2e`} ${n >= 0 ? less : more}`;
  const rows: { n: string; text: React.ReactNode }[] = [
    { n: String(w.placedAlone), text: <>orders the agent placed alone, within the kitchen&apos;s mandate</> },
    { n: String(w.sentForSignOff), text: <>sent to a person for sign-off{w.waiting ? `, ${w.waiting} still waiting` : ""}</> },
    { n: String(w.corrected), text: <>requests corrected before ordering, after the mistake check asked</> },
  ];
  return (
    <section aria-labelledby="week">
      <SectionTitle id="week" aside={<span className="text-[0.92rem] text-ink-soft">last 7 days, this server</span>}>
        What the agent did
      </SectionTitle>
      <Paper>
        <dl className="divide-y divide-ink/10">
          {rows.map((r) => (
            <div key={r.n + String(r.text)} className="grid grid-cols-[4.5rem_1fr] items-baseline gap-3 px-4 py-3">
              <dt className="text-right font-display text-[2.4rem] font-bold leading-none tabular">{r.n}</dt>
              <dd className="leading-snug">{r.text}</dd>
            </div>
          ))}
          <div className="px-4 py-3">
            {vs.orders === 0 ? (
              <p className="leading-snug text-ink-soft">
                <strong className="text-ink">Euros and CO2 against the alternative:</strong> no order this week had a second option to compare with yet.
              </p>
            ) : (
              <>
                <p className="leading-snug">
                  <strong className="font-display text-[1.6rem] tabular">{signed(vs.eurCents, "€", "less", "more")}</strong>
                  {vs.co2Kg !== null && (
                    <>
                      {" "}
                      and <strong className="font-display text-[1.6rem] tabular">{signed(vs.co2Kg, "kg", "less", "more")}</strong>
                    </>
                  )}
                </p>
                <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">
                  Than the cheapest option offered and not chosen, over {vs.orders} order{vs.orders === 1 ? "" : "s"}. CO2 is the product group&apos;s average footprint, not a measurement of the product{vs.co2Kg === null ? "; no CO2 data for these" : ""}.
                </p>
              </>
            )}
          </div>
        </dl>
      </Paper>
    </section>
  );
}

// ---------- standing orders ----------

function StandingOrders({ o, cutoffs, cutoffError, now }: { o: Overview; cutoffs?: CutoffReply; cutoffError?: string; now: number }) {
  const rows = o.standing;
  return (
    <section aria-labelledby="standing">
      <SectionTitle
        id="standing"
        aside={
          <span className="text-[0.92rem] text-ink-soft">
            {cutoffError ? `Cut-offs not checked: ${cutoffError}` : !cutoffs ? "Checking order cut-offs…" : cutoffs.cached ? "Cut-offs checked earlier, no live call now" : `Cut-offs: ${cutoffs.liveCalls} live call for ${cutoffs.items.length} products`}
          </span>
        }
      >
        Standing orders
      </SectionTitle>
      {rows.length === 0 ? (
        <Paper>
          <p className="p-4 leading-snug text-ink-soft">No repeated orders yet. After three orders of the same kind, the agent keeps them here with their usual days and amounts, and warns when they drift.</p>
        </Paper>
      ) : (
        <div className="overflow-x-auto bg-paper">
          <div aria-hidden className="h-[3px] bg-ink" />
          <table className="w-full min-w-[46rem] text-left">
            <thead className="text-[0.85rem] text-ink-soft">
              <tr className="border-b border-ink/15">
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-2 py-2 font-medium">Usual</th>
                <th className="px-2 py-2 font-medium">Days</th>
                <th className="px-2 py-2 font-medium">Next</th>
                <th className="px-2 py-2 font-medium">Order cut-off</th>
                <th className="px-2 py-2 font-medium">Against the usual</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {rows.map((s) => (
                <StandingRow key={s.family} s={s} item={cutoffs?.items.find((i) => i.family === s.family)} requests={o.requests} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StandingRow({ s, item, requests, now }: { s: Standing; item?: CutoffReply["items"][number]; requests: PortalRequest[]; now: number }) {
  const { agent } = usePortal();
  const last = requests.find((r) => r.family === s.family && r.order && (r.order.status === "committed" || r.order.status === "history"));
  const offer = item?.result?.offer;
  const t = cutoffMs(offer?.orderBy);
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-semibold capitalize">{attr(s.family)}</p>
        <p className="text-[0.9rem] text-ink-soft">{shortProduct(s.product.name)}, {s.orders} orders</p>
      </td>
      <td className="px-2 py-3 tabular">about {amount(s.usual.amount, s.usual.unit)}</td>
      <td className="px-2 py-3">{s.weekdays.length ? weekdaysText(s.weekdays) : "no fixed day"}</td>
      <td className="px-2 py-3">{s.nextDue ? day(s.nextDue) : "–"}</td>
      <td className="px-2 py-3">
        {!item ? (
          <span className="text-ink-soft">–</span>
        ) : offer?.orderBy ? (
          <>
            {cutoffText(offer.orderBy)}
            <span className="block text-[0.85rem] text-ink-soft">
              for {day(offer.deliveryDate)}, {t !== undefined ? untilText(t, now) : ""}
              {item.match === "nearest" ? "; closest product in the catalogue" : ""}
            </span>
          </>
        ) : offer ? (
          <span className="text-ink-soft">delivery {day(offer.deliveryDate)}, no cut-off stated</span>
        ) : (
          <span className="text-ink-soft">{item.result?.problems.includes("cutoff_passed") ? "cut-off passed for the next day" : "no offer now"}</span>
        )}
      </td>
      <td className="px-2 py-3">
        {s.drift.warning ? (
          <span className="font-semibold">
            {s.drift.amountPct !== null && Math.abs(s.drift.amountPct) >= 10 && <>amount {s.drift.amountPct > 0 ? "+" : ""}{s.drift.amountPct} %</>}
            {s.drift.pricePct !== null && Math.abs(s.drift.pricePct) >= 10 && <> price {s.drift.pricePct > 0 ? "+" : ""}{s.drift.pricePct} %</>}
          </span>
        ) : (
          <span className="text-ink-soft">steady{s.drift.amountPct !== null ? ` (${s.drift.amountPct > 0 ? "+" : ""}${s.drift.amountPct} %)` : ""}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {last && (
          <div className="flex flex-col items-start gap-1">
            <button type="button" className="min-h-9 font-semibold underline decoration-2 underline-offset-4" onClick={() => agent.send({ kind: "repeat", request: last })}>
              Repeat
            </button>
            <button
              type="button"
              className="min-h-9 font-semibold underline decoration-2 underline-offset-4"
              onClick={() => {
                agent.setFollowUp(last);
                agent.focus();
              }}
            >
              Repeat with a change
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------- deliveries ----------

function Deliveries({ o }: { o: Overview }) {
  const { base } = usePortal();
  const coming = o.orders.filter((x) => (x.status === "committed" || x.status === "pending_approval") && x.deliveryDate >= o.today).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  return (
    <section aria-labelledby="deliveries">
      <SectionTitle id="deliveries">Deliveries coming</SectionTitle>
      <Paper>
        {coming.length === 0 ? (
          <p className="p-4 leading-snug text-ink-soft">Nothing booked yet. Orders placed here, by the agent or from the basket, appear with their delivery day.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {coming.map((x) => (
              <li key={x.orderId}>
                <Link href={`${base}/orders/${x.orderId}`} className="grid gap-x-4 px-4 py-3 hover:bg-concrete/50 sm:grid-cols-[8rem_1fr_auto]">
                  <span className="font-display text-[1.3rem] font-bold">{day(x.deliveryDate)}</span>
                  <span className="min-w-0">
                    {linesText(x, 3)}
                    <span className="block text-[0.9rem] text-ink-soft">{authorisedText(x)}</span>
                  </span>
                  <span className="font-semibold tabular">{eur(x.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Paper>
    </section>
  );
}
