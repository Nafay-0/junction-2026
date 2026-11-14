"use client";

import Link from "next/link";
import { useState } from "react";
import { dayL, roleLabelL } from "../../_i18n/format";
import type { Lang } from "../../_i18n/lang";
import { useFormat, useText } from "../../_i18n/provider";
import { clock, helsinkiToday, money, shortProduct } from "../../_ui/plain";
import { Repeat } from "lucide-react";
import { Button, Card, Skeleton } from "../../_ui/kit";
import { HISTORY_TEXT } from "./history.text";
import { usePortal } from "./portal";
import type { PortalOrder, PortalRequest } from "./types";
import { useProductName } from "./names";

/** Who let an order through, in a few words. */
export function authorisedText(o: PortalOrder, lang: Lang = "en"): string {
  const tx = HISTORY_TEXT[lang];
  const a = o.authorised;
  if (a.by === "agent") return tx.byAgent;
  if (a.by === "person") return `${tx.signedBy(a.name, roleLabelL(a.role, lang))}${(a.method && tx.method[a.method]) ?? ""}`;
  if (a.by === "waiting") return tx.waitingFor(a.name, roleLabelL(a.role, lang));
  if (a.by === "before_dock") return tx.fromHistory;
  return o.status === "declined" ? tx.declined : tx.refused;
}

/** The request's words as the buyer would recognise them; a basket shows as a basket. */
export function askedText(text: string | null | undefined, lang: Lang = "en"): string | null {
  if (!text) return null;
  return text.startsWith("Basket from the catalogue:") ? HISTORY_TEXT[lang].basketAsked(text.slice(26).trim()) : text;
}

export function linesText(o: PortalOrder, max = 2, lang: Lang = "en", pn: (id: string, en: string) => string = (_i, en) => en): string {
  const shown = o.lines.slice(0, max).map((l) => `${l.quantity} × ${shortProduct(pn(l.productId, l.name))}`);
  return shown.join(" + ") + (o.lines.length > max ? HISTORY_TEXT[lang].more(o.lines.length - max) : "");
}

export function whenText(iso: string, lang: Lang = "en"): string {
  return HISTORY_TEXT[lang].at(dayL(helsinkiToday(new Date(iso)), lang), clock(iso));
}

/**
 * "Your earlier requests": what was asked in the buyer's words, what was ordered, when and who signed,
 * each with Repeat (one click, no model) and Repeat with a change (a short follow-up against it).
 */
export function History({ requests, loading, error, onRepeat, onChange }: { requests: PortalRequest[]; loading: boolean; error?: string; onRepeat: (r: PortalRequest) => void; onChange: (r: PortalRequest) => void }) {
  const { base } = usePortal();
  const tx = useText(HISTORY_TEXT);
  const pn = useProductName();
  const { lang } = useFormat();
  const [all, setAll] = useState(false);
  const shown = requests.filter((r) => r.kind !== "basket" || r.order).slice(0, all ? 12 : 5);
  return (
    <section aria-labelledby="earlier">
      <Card pad>
        <h2 id="earlier" className="display text-[1.3rem]">
          {tx.title}
        </h2>
        <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">{tx.intro}</p>
        {loading && (
          <div className="mt-4 space-y-3" role="status" aria-label={tx.loading}>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
        {error && !requests.length && <p className="mt-3 text-[0.95rem] text-bad">{tx.loadFailed(error)}</p>}
        {!loading && !error && shown.length === 0 && <p className="mt-3 text-[0.95rem] leading-snug text-ink-soft">{tx.none}</p>}
        <ol className="mt-3 divide-y divide-line">
          {shown.map((r) => (
            <li key={r.key} className="py-3">
              <p className="text-[0.8rem] text-ink-soft tabular">{whenText(r.at, lang)}</p>
              <p className="mt-0.5 font-semibold leading-snug">{r.text ? (r.kind === "basket" ? tx.basket : `“${r.text.length > 90 ? `${r.text.slice(0, 87)}…` : r.text}”`) : r.order ? linesText(r.order, 2, lang, pn) : tx.order}</p>
              {r.order ? (
                <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">
                  {r.text && <>{linesText(r.order, 2, lang, pn)}, </>}
                  {r.order.status !== "rejected" && r.order.status !== "declined" && <span className="tabular">{money(r.order.totalCents)}, </span>}
                  {tx.delivery(dayL(r.order.deliveryDate, lang), authorisedText(r.order, lang))}
                </p>
              ) : (
                <p className="mt-0.5 text-[0.9rem] text-ink-soft">{r.state === "cancelled" ? tx.cancelled : r.state === "no_options" ? tx.noOptions : tx.notOrdered}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Button kind="secondary" size="sm" onClick={() => onRepeat(r)}>
                  <Repeat aria-hidden size={14} />
                  {tx.repeat}
                </Button>
                <Button kind="quiet" className="!min-h-9 text-[0.9rem] pointer-coarse:!min-h-11" onClick={() => onChange(r)}>
                  {tx.repeatChange}
                </Button>
                {r.order && r.order.status !== "history" && (
                  <Link href={`${base}/orders/${r.order.orderId}`} className="inline-flex min-h-9 items-center text-[0.9rem] text-ink-soft underline decoration-1 underline-offset-4 hover:text-petrol">
                    {tx.details}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        {requests.length > 5 && (
          <Button kind="quiet" className="mt-1 text-[0.92rem]" onClick={() => setAll((x) => !x)}>
            {all ? tx.fewer : tx.more12(Math.min(requests.length, 12))}
          </Button>
        )}
      </Card>
    </section>
  );
}
