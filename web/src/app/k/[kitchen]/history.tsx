"use client";

import Link from "next/link";
import { useState } from "react";
import { clock, day, eur, helsinkiToday, roleLabel, shortProduct } from "../../_ui/plain";
import { usePortal } from "./portal";
import type { PortalOrder, PortalRequest } from "./types";

/** Who let an order through, in a few words. */
export function authorisedText(o: PortalOrder): string {
  const a = o.authorised;
  if (a.by === "agent") return "Placed by the agent alone, within the mandate";
  if (a.by === "person") return `Signed off by ${a.name} (${roleLabel(a.role)})${a.method === "passkey" ? " with a passkey" : a.method === "link_token" ? " with a one-time link" : a.method === "demo_tap" ? " with a demo tap, not verified" : ""}`;
  if (a.by === "waiting") return `Waiting for ${a.name} (${roleLabel(a.role)})`;
  if (a.by === "before_dock") return "From the kitchen's order history";
  return o.status === "declined" ? "Declined, nothing ordered" : "Refused by the gate, nothing ordered";
}

/** The request's words as the buyer would recognise them; a basket shows as a basket. */
export function askedText(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.startsWith("Basket from the catalogue:") ? `Basket, ordered by hand: ${text.slice(26).trim()}` : text;
}

export function linesText(o: PortalOrder, max = 2): string {
  const shown = o.lines.slice(0, max).map((l) => `${l.quantity} × ${shortProduct(l.name)}`);
  return shown.join(" + ") + (o.lines.length > max ? ` + ${o.lines.length - max} more` : "");
}

export function whenText(iso: string): string {
  return `${day(helsinkiToday(new Date(iso)))} ${clock(iso)}`;
}

/**
 * "Your earlier requests": what was asked in the buyer's words, what was ordered, when and who signed,
 * each with Repeat (one click, no model) and Repeat with a change (a short follow-up against it).
 */
export function History({ requests, loading, error, onRepeat, onChange }: { requests: PortalRequest[]; loading: boolean; error?: string; onRepeat: (r: PortalRequest) => void; onChange: (r: PortalRequest) => void }) {
  const { base } = usePortal();
  const [all, setAll] = useState(false);
  const shown = requests.filter((r) => r.kind !== "basket" || r.order).slice(0, all ? 12 : 5);
  return (
    <section aria-labelledby="earlier" className="bg-paper">
      <div aria-hidden className="h-[3px] bg-ink" />
      <div className="p-4">
        <h2 id="earlier" className="font-display text-[1.3rem] font-bold leading-tight">
          Earlier requests
        </h2>
        <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-soft">Repeat one as it was, or change one part of it: “same again but 200 litres”.</p>
        {loading && <div className="mt-3 h-40 animate-pulse bg-concrete" aria-label="Loading earlier requests" />}
        {error && !requests.length && <p className="mt-2 text-ink-soft">Could not load the earlier requests: {error}</p>}
        {!loading && !error && shown.length === 0 && <p className="mt-2 text-[0.98rem] leading-snug text-ink-soft">None yet. Every request you send stays here with what it became.</p>}
        <ol className="mt-2 divide-y divide-ink/10">
          {shown.map((r) => (
            <li key={r.key} className="py-2.5">
              <p className="text-[0.82rem] text-ink-soft tabular">{whenText(r.at)}</p>
              <p className="mt-0.5 leading-snug">{r.text ? <span className="font-semibold">{r.kind === "basket" ? "Basket, ordered by hand" : `“${r.text.length > 90 ? `${r.text.slice(0, 87)}…` : r.text}”`}</span> : <span className="font-semibold">{r.order ? linesText(r.order) : "Order"}</span>}</p>
              {r.order ? (
                <p className="mt-0.5 text-[0.92rem] leading-snug text-ink-soft">
                  {r.text && <>{linesText(r.order)}, </>}
                  {r.order.status !== "rejected" && r.order.status !== "declined" && <span className="tabular">{eur(r.order.totalCents)}, </span>}
                  delivery {day(r.order.deliveryDate)} {authorisedText(r.order)}.
                </p>
              ) : (
                <p className="mt-0.5 text-[0.92rem] text-ink-soft">{r.state === "cancelled" ? "Cancelled." : r.state === "no_options" ? "Nothing fitted; not ordered." : "Not ordered."}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                <button type="button" className="min-h-9 font-semibold underline decoration-2 underline-offset-4" onClick={() => onRepeat(r)}>
                  Repeat
                </button>
                <button type="button" className="min-h-9 font-semibold underline decoration-2 underline-offset-4" onClick={() => onChange(r)}>
                  Repeat with a change
                </button>
                {r.order && r.order.status !== "history" && (
                  <Link href={`${base}/orders/${r.order.orderId}`} className="min-h-9 py-1.5 text-ink-soft underline decoration-1 underline-offset-4">
                    Details
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        {requests.length > 5 && (
          <button type="button" className="mt-1 min-h-9 text-[0.95rem] font-semibold underline decoration-2 underline-offset-4" onClick={() => setAll((x) => !x)}>
            {all ? "Show fewer" : `Show more (${Math.min(requests.length, 12)})`}
          </button>
        )}
      </div>
    </section>
  );
}
