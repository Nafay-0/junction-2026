"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuditListRow, AuditRecord } from "@/server/ops/views";
import { ChevronRight, Download, FileCheck2, Lock, Quote, ReceiptText, Route, UserCheck } from "lucide-react";
import { Avatar, Badge, buttonClass } from "../../../_ui/kit";
import { ChainCheck } from "../../_ui/chain";
import { country, fi, money, stamp, when } from "../../_ui/format";
import { Details, Empty, KV, LoadError, Loading, Outcome, PageHead, Section, useOps } from "../../_ui/kit";
import { FilterBar, useUrlState } from "../../_ui/filters";
import { CheckGrid, Stamp, Table } from "../../_ui/parts";
import { VerifyBox } from "./verify-box";
import { AUDIT_TEXT } from "./audit.text";

const STATUS: Record<string, { label: string; kind: string }> = {
  committed: { label: "Signed order", kind: "committed" },
  pending_approval: { label: "Waiting for sign-off", kind: "waiting" },
  rejected: { label: "Refused by the gate", kind: "refused" },
  declined: { label: "Declined", kind: "declined" },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s.replaceAll("_", " "), kind: "open" };

export function AuditIndex() {
  const live = useOps<{ orders: AuditListRow[] }>("/ops-api/audit", { pollMs: 4000 });
  const rows = live.data?.orders;
  const router = useRouter();
  const [q, setQ] = useUrlState("q", "");
  const [show, setShow] = useUrlState("show", "all");
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((o) => (show === "all" || o.status === show) && (!needle || `${o.orgName} ${o.agentLabel} ${o.signedBy ?? ""} ${o.orderId} ${statusOf(o.status).label}`.toLowerCase().includes(needle)));
  const count = (s: string) => (rows ?? []).filter((o) => o.status === s).length;
  return (
    <>
      <PageHead
        title={AUDIT_TEXT.en.title}
        purpose={AUDIT_TEXT.en.purpose}
        about="Who approved an order, for exactly what, and the proof: for any order, what was asked, what the wholesaler stated, what was committed and who signed, checkable against the published keys. A kitchen's private memory is not part of it."
      />
      <LoadError message={live.error} />
      <div className="grid grid-cols-1 gap-x-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="Orders" className="mt-2">
          {!rows ? (
            <Loading label="Reading the orders…" />
          ) : rows.length === 0 ? (
            <Empty title={AUDIT_TEXT.en.emptyTitle}>{AUDIT_TEXT.en.empty}</Empty>
          ) : (
            <>
              <FilterBar
                q={q}
                setQ={setQ}
                placeholder="Kitchen, agent, who signed, order id"
                options={[
                  { id: "all", label: "All", count: rows.length },
                  { id: "committed", label: "Signed", count: count("committed") },
                  { id: "pending_approval", label: "Waiting", count: count("pending_approval") },
                  { id: "rejected", label: "Refused", count: count("rejected") },
                  { id: "declined", label: "Declined", count: count("declined") },
                ]}
                value={show}
                setValue={setShow}
                result={`${shown.length} of ${rows.length}`}
              />
              {shown.length === 0 ? (
                <Empty title="Nothing matches">Clear the search or choose All.</Empty>
              ) : (
                <Table label="Orders">
                  <thead>
                    <tr>
                      <th>Last change</th>
                      <th>Kitchen and agent</th>
                      <th>Outcome</th>
                      <th>Authorised by</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => {
                      const st = statusOf(o.status);
                      return (
                        <tr key={o.orderId} onClick={() => router.push(`/ops/audit/${o.orderId}`)} className="cursor-pointer hover:bg-mist">
                          <td className="whitespace-nowrap tabular">
                            <Link href={`/ops/audit/${o.orderId}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                              {when(o.at)}
                            </Link>
                          </td>
                          <td className="min-w-[11rem]">
                            <p className="font-semibold">{o.orgName}</p>
                            <p className="text-[0.85rem] text-ink-soft">{o.agentLabel}</p>
                          </td>
                          <td className="min-w-[10rem]">
                            <Outcome kind={st.kind} label={st.label} />
                          </td>
                          <td>{o.signedBy ? <span className="inline-flex items-center gap-2 font-semibold"><Avatar name={o.signedBy} size={26} />{o.signedBy}</span> : o.status === "committed" ? <span className="text-ink-soft">The mandate alone</span> : <span className="text-ink-soft">No one yet</span>}</td>
                          <td className="whitespace-nowrap text-right font-semibold tabular">{money(o.totalCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </Section>
        <div className="space-y-4 xl:pt-[3.6rem]">
          <VerifyBox />
          <ChainCheck />
        </div>
      </div>
    </>
  );
}

export function AuditOrder({ orderId }: { orderId: string }) {
  const live = useOps<AuditRecord>(`/ops-api/audit/${orderId}`, { pollMs: 4000 });
  const a = live.data;
  if (!a && live.error)
    return (
      <div className="mt-4">
        <Empty
          title="This order is not on this server"
          action={
            <Link className={buttonClass("secondary", "sm")} href="/ops/audit">
              All orders
            </Link>
          }
        >
          {live.error}
        </Empty>
      </div>
    );
  if (!a) return <Loading label="Reading the order's record…" />;
  const c = a.committed;
  const st = statusOf(a.order.status);
  const names = new Map<string, string>();
  for (const cl of a.claimed) for (const p of cl.products) names.set(p.productId, p.name);
  for (const l of c.lines) names.set(l.productId, l.name);
  const hits = c.decision.rules.filter((r) => r.outcome !== "pass");
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-[0.9rem] text-ink-soft">
        <Link href="/ops/audit" className="font-medium text-petrol hover:underline">
          Audit
        </Link>
        <ChevronRight aria-hidden size={15} className="text-ink-faint" />
        <span>One order</span>
      </nav>
      <PageHead
        title={`${a.order.orgName}, ${money(a.order.totalCents)}`}
        purpose={`Placed ${stamp(a.order.createdAt)}, last change ${stamp(a.order.updatedAt)}, by ${a.order.agentId === "operations" ? "operations" : "its purchasing agent"}.`}
        right={
          <>
            <Link href={`/ops/trace/${a.order.requestId}`} className={buttonClass("secondary", "sm")}>
              <Route aria-hidden size={16} />
              Replay the request
            </Link>
            <a href={`/ops-api/audit/${orderId}?download=1`} download className={buttonClass("primary", "sm")}>
              <Download aria-hidden size={16} />
              Export the record (JSON)
            </a>
          </>
        }
      />
      <LoadError message={live.error} />

      {/* The ten-second answer: who, for exactly what, and the proof. */}
      <section aria-label="Who approved what" className="grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <div className="px-5 py-5 sm:px-6">
          <p className="flex items-center gap-2 text-[0.85rem] font-medium text-ink-soft">
            <UserCheck aria-hidden size={16} className="text-petrol" />
            Who authorised it
          </p>
          <p className="display mt-2 text-[1.6rem] leading-tight">{c.signOff ? c.signOff.name : c.authorisedBy === "the mandate alone" ? "The mandate alone" : c.authorisedBy}</p>
          {c.signOff ? (
            <p className="mt-1 text-[0.95rem] leading-snug">
              {c.signOff.role}, {c.signOff.method === "passkey" ? "with the passkey on their phone" : c.signOff.method === "link_token" ? "through the one-time link sent only to them" : c.signOff.method ? c.signOff.method.replaceAll("_", " ") : "method not recorded"}
              {c.signOff.at ? `, ${stamp(c.signOff.at)}` : ""}.{" "}
              {c.signOff.verified ? <Badge tone="good">Verified by AimoPilot</Badge> : c.signOff.verified === false ? <Badge tone="bad">Not verified</Badge> : null}
            </p>
          ) : (
            <p className="mt-1 text-[0.95rem] leading-snug text-ink-soft">{a.order.status === "committed" ? "Inside what the kitchen's signed mandate lets the agent buy alone; no person was needed." : "Nobody has authorised it."}</p>
          )}
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="flex items-center gap-2 text-[0.85rem] font-medium text-ink-soft">
            <ReceiptText aria-hidden size={16} className="text-petrol" />
            For exactly what
          </p>
          <p className="display mt-2 text-[1.6rem] leading-tight tabular">{money(c.totalCents)}</p>
          <p className="mt-1 text-[0.95rem] leading-snug">
            {c.lines.length} line{c.lines.length === 1 ? "" : "s"}: {c.lines.map((l) => `${l.quantity} × ${l.name}`).join("; ")}.
          </p>
          {c.signOff && <p className="mt-1 text-[0.85rem] text-ink-soft">The sign-off covers this order&apos;s digest: a changed line, price or total would not match.</p>}
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="flex items-center gap-2 text-[0.85rem] font-medium text-ink-soft">
            <FileCheck2 aria-hidden size={16} className="text-petrol" />
            Outcome and proof
          </p>
          <div className="mt-2.5">
            <Stamp kind={st.kind} label={st.label} />
          </div>
          <p className="mt-2 text-[0.95rem] leading-snug">
            {c.confirmation ? "The wholesaler signed the confirmation. Check it below against the published keys, in this browser." : "No signed confirmation: the order was not committed."}
          </p>
        </div>
      </section>

      <div className="mt-2 grid grid-cols-1 gap-x-8 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div>
          <Section title="What was asked">
            <div className="rounded-xl border border-line bg-paper p-5">
              <blockquote className="flex max-w-[64ch] gap-3 rounded-lg bg-surface px-4 py-3.5">
                <Quote aria-hidden size={18} className="mt-1 shrink-0 text-petrol" fill="currentColor" strokeWidth={0} />
                <p className="text-[1.15rem] font-medium leading-snug">“{fi(a.asked.text)}”</p>
              </blockquote>
              {a.asked.neededBy && <p className="mt-2.5 text-[0.92rem] text-ink-soft">Needed by {fi(a.asked.neededBy)}</p>}
            </div>
          </Section>

          <Section title="What the wholesaler stated" aside="Live price and availability at the time, each statement signed">
            {a.claimed.length === 0 ? (
              <Empty title="No live statement on this request">The price came from an earlier check, or the order was refused before any lookup.</Empty>
            ) : (
              <div className="space-y-3">
                {a.claimed.map((cl) => (
                  <Table key={cl.seq} label={`Live check at ${stamp(cl.at)}`}>
                    <thead>
                      <tr>
                        <th>Checked {stamp(cl.at)}</th>
                        <th className="text-right">Price per pack</th>
                        <th>Stock</th>
                        <th>Delivery</th>
                        <th>Origin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cl.products.map((p) => (
                        <tr key={p.productId}>
                          <td className="font-semibold">
                            {p.name}
                            {p.claimIds?.length ? <span className="block text-[0.82rem] font-normal text-ink-soft">{p.claimIds.length} signed claims</span> : null}
                          </td>
                          <td className="whitespace-nowrap text-right tabular">{p.unitPriceCents !== undefined ? money(p.unitPriceCents) : <span className="text-ink-soft">No offer</span>}</td>
                          <td>{p.availablePacks === null ? <span className="text-ink-soft">Not reported</span> : p.availablePacks !== undefined ? `${p.availablePacks} packs` : "–"}</td>
                          <td className="whitespace-nowrap">{p.deliveryDate ? fi(p.deliveryDate) : "–"}</td>
                          <td>{p.origin !== undefined ? country(p.origin) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ))}
              </div>
            )}
            <p className="mt-2 text-[0.9rem] text-ink-soft">{a.signedClaims.note}</p>
          </Section>

          <Section title="What was committed">
            <Table label="Committed lines">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Packs</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Line</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.productId}>
                    <td>
                      <span className="font-semibold">{l.name}</span>
                      {l.substituteFor && <span className="block text-[0.85rem] text-ink-soft">A substitute, in place of {names.get(l.substituteFor) ?? "the product asked for"}</span>}
                      {l.countryOfOrigin !== undefined && <span className="block text-[0.85rem] text-ink-soft">Origin {country(l.countryOfOrigin)}</span>}
                    </td>
                    <td className="text-right tabular">{l.quantity}</td>
                    <td className="whitespace-nowrap text-right tabular">{money(l.unitPriceCents)}</td>
                    <td className="whitespace-nowrap text-right tabular">{money(l.lineTotalCents)}</td>
                    <td className="whitespace-nowrap">{fi(l.deliveryDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface font-semibold">
                  <td className="px-4 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="display whitespace-nowrap px-4 py-3 text-right text-[1.3rem] tabular">{money(c.totalCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </Table>
          </Section>

          <Section title="The gate's decision" aside={`${c.decision.rules.length - hits.length} of ${c.decision.rules.length} checks passed`}>
            <div className="rounded-xl border border-line bg-paper p-5">
              <CheckGrid checks={c.decision.rules} showPassReasons={false} />
            </div>
          </Section>

          <Section title="The record, as the wholesaler reads it" aside={`${a.ledger.withheld} buyer-side step${a.ledger.withheld === 1 ? "" : "s"} kept with the kitchen`}>
            <div className="rounded-xl border border-line bg-paper p-5">
              <ol className="space-y-2 text-[0.95rem] leading-snug">
                {a.ledger.explanation.map((line, i) => (
                  <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
                    <span className="flex size-6 items-center justify-center rounded-full bg-petrol-soft text-[0.75rem] font-semibold text-petrol tabular">{i + 1}</span>
                    <span className="pt-0.5">{fi(line)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex gap-2 rounded-lg bg-lavender px-4 py-3 text-[0.88rem] text-lavender-deep">
                <Lock aria-hidden size={15} className="mt-0.5 shrink-0" />
                Not in this record: the kitchen&apos;s order history, the rules it stated and the patterns AimoPilot learned from it. Those entries appear only by number and hash, so the chain still shows no gap.
              </p>
            </div>
          </Section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-[4.5rem] xl:mt-10 xl:max-h-[calc(100dvh-5.5rem)] xl:self-start xl:overflow-y-auto">
          {c.confirmation ? <VerifyBox key={c.confirmation} initial={c.confirmation} title="Verify this order's signed confirmation" /> : <VerifyBox />}
          {a.signedClaims.tokens.length > 0 && (
            <div className="rounded-xl border border-line bg-paper p-5">
              <h2 className="display text-[1.2rem]">Signed claims the quote rests on</h2>
              <ul className="mt-2 divide-y divide-line text-[0.9rem]">
                {a.signedClaims.tokens.map((t) => (
                  <li key={t.claimId} className="py-2">
                    <b className="capitalize">{t.type}</b> of {names.get(t.productId) ?? "a product"}, valid until {stamp(t.validUntil)}
                    <Details summary="Token" className="mt-0.5">
                      <KV k="id" v={t.claimId} />
                      <KV k="product" v={t.productId} />
                      <KV k="sha256" v={t.sha256} />
                      <p className="select-all">{t.token}</p>
                    </Details>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.85rem] text-ink-soft">Paste any token into the checker above to verify it.</p>
            </div>
          )}
          <ChainCheck />
          <Details summary="Ids, keys and the ledger anchor" className="px-1">
            <KV k="order" v={a.order.orderId} />
            <KV k="request" v={a.order.requestId} />
            <KV k="quote" v={a.order.quoteId} />
            <KV k="org" v={a.order.orgId} />
            <KV k="agent" v={a.order.agentId} />
            <KV k="mandate" v={a.order.mandateId} />
            <KV k="key" v={`${a.keys.kid} at ${a.keys.jwks}`} />
            {c.signOff && <KV k="order digest" v={c.signOff.orderDigest} />}
            {c.ledgerHead && <KV k="anchor" v={`${c.ledgerHead.seq} ${c.ledgerHead.hash}`} />}
          </Details>
        </div>
      </div>
    </>
  );
}
