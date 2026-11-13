"use client";

import Link from "next/link";
import type { AuditListRow, AuditRecord } from "@/server/ops/views";
import { ChainCheck } from "../../_ui/chain";
import { fi, money, when } from "../../_ui/format";
import { Details, Empty, KV, LoadError, Loading, PageHead, Panel, Section, useOps } from "../../_ui/kit";
import { VerifyBox } from "./verify-box";

const STATUS: Record<string, string> = { committed: "Committed", pending_approval: "Waiting for sign-off", rejected: "Refused by the gate", declined: "Declined" };

export function AuditIndex() {
  const live = useOps<{ orders: AuditListRow[] }>("/ops-api/audit", { pollMs: 4000 });
  const rows = live.data?.orders;
  return (
    <>
      <PageHead
        title="Audit"
        purpose="The wholesaler's side of the record: for any order, what was asked, what the wholesaler stated, what was committed and who signed. Exportable, and checkable against the published keys. A kitchen's private memory is not part of it."
      />
      <LoadError message={live.error} />
      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_480px]">
        <Section title="Orders">
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty title="No order yet">Orders appear here once an agent places one, whether committed, waiting, refused or declined.</Empty>
          ) : (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[0.86rem]">
                <thead className="border-b border-concrete-deep text-[0.76rem] text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Last change</th>
                    <th className="px-3 py-2 font-semibold">Kitchen</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Signed by</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.orderId} className="border-b border-concrete last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular">
                        <Link href={`/ops/audit/${o.orderId}`} className="font-semibold underline decoration-concrete-deep underline-offset-2 hover:decoration-ink">
                          {when(o.at)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {o.orgName}
                        <span className="block text-[0.78rem] text-ink-soft">{o.agentLabel}</span>
                      </td>
                      <td className="px-3 py-2">{o.status === "rejected" || o.status === "pending_approval" ? <span className="bg-safety px-1 text-safety-ink">{STATUS[o.status]}</span> : STATUS[o.status] ?? o.status}</td>
                      <td className="px-3 py-2">{o.signedBy ?? (o.status === "committed" ? "The mandate alone" : "–")}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(o.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </Section>
        <div className="space-y-4 xl:pt-[2.6rem]">
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
        <Empty title="This order is not on this server">
          {live.error} <Link className="underline" href="/ops/audit">All orders</Link>
        </Empty>
      </div>
    );
  if (!a) return <Loading />;
  const c = a.committed;
  return (
    <>
      <PageHead
        title={`${a.order.orgName}: ${money(a.order.totalCents)}`}
        purpose={`${STATUS[a.order.status] ?? a.order.status}. Placed ${when(a.order.createdAt)}, last change ${when(a.order.updatedAt)}.`}
        right={
          <>
            <Link href={`/ops/trace/${a.order.requestId}`} className="font-semibold text-ink underline underline-offset-2">
              Trace
            </Link>
            <a href={`/ops-api/audit/${orderId}?download=1`} download className="bg-ink px-3 py-1.5 font-semibold text-paper hover:bg-ink/90">
              Export record (JSON)
            </a>
          </>
        }
      />
      <LoadError message={live.error} />
      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div>
          <Section title="What was asked">
            <Panel className="px-4 py-3">
              <p className="font-display text-[1.25rem] font-bold leading-snug">“{fi(a.asked.text)}”</p>
              {a.asked.neededBy && <p className="mt-1 text-[0.88rem] text-ink-soft">Needed by {a.asked.neededBy.split("-").reverse().join(".")}</p>}
            </Panel>
          </Section>

          <Section title="What the wholesaler stated" aside="Live price and availability, and where it comes from">
            {a.claimed.length === 0 ? (
              <Empty title="No live statement on this request" />
            ) : (
              <Panel>
                {a.claimed.map((cl) => (
                  <div key={cl.seq} className="border-b border-concrete px-4 py-2 last:border-0">
                    <p className="text-[0.78rem] text-ink-soft">
                      {when(cl.at)}, ledger entry {cl.seq}
                    </p>
                    <ul className="mt-0.5 text-[0.86rem]">
                      {cl.products.map((p) => (
                        <li key={p.productId} className="flex flex-wrap justify-between gap-x-4 py-0.5">
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-ink-soft">
                            {p.unitPriceCents !== undefined ? `${money(p.unitPriceCents)} per pack` : "no offer"}
                            {p.availablePacks === null ? ", stock not reported" : p.availablePacks !== undefined ? `, ${p.availablePacks} packs` : ""}
                            {p.deliveryDate ? `, delivery ${p.deliveryDate.split("-").reverse().slice(0, 2).join(".")}.` : ""}
                            {p.origin !== undefined ? `, origin ${p.origin ?? "not stated"}` : ""}
                            {p.claimIds?.length ? `, ${p.claimIds.length} signed claims` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Panel>
            )}
            <p className="mt-2 text-[0.86rem]">{a.signedClaims.note}</p>
          </Section>

          <Section title="What was committed">
            <Panel>
              <table className="w-full text-left text-[0.86rem]">
                <thead className="border-b border-concrete-deep text-[0.76rem] text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">Packs</th>
                    <th className="px-3 py-2 text-right font-semibold">Price</th>
                    <th className="px-3 py-2 text-right font-semibold">Line</th>
                    <th className="px-3 py-2 font-semibold">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.productId} className="border-b border-concrete last:border-0">
                      <td className="px-3 py-1.5">
                        {l.name}
                        {l.substituteFor && <span className="block text-[0.78rem] text-ink-soft">substitute for {l.substituteFor}</span>}
                        {l.countryOfOrigin !== undefined && <span className="block text-[0.78rem] text-ink-soft">origin {l.countryOfOrigin ?? "not stated"}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{l.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{money(l.unitPriceCents)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{money(l.lineTotalCents)}</td>
                      <td className="px-3 py-1.5 tabular">{l.deliveryDate.split("-").reverse().slice(0, 2).join(".")}.</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-ink font-semibold">
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular">{money(c.totalCents)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </Panel>
          </Section>

          <Section title="Who signed">
            <Panel className="px-4 py-3 text-[0.9rem]">
              <p>
                Authorised by <b>{c.authorisedBy}</b>.
              </p>
              {c.signOff && (
                <p className="mt-1">
                  {c.signOff.name} ({c.signOff.role}) signed {c.signOff.at ? when(c.signOff.at) : ""} {c.signOff.method === "passkey" ? "with a passkey on their phone" : c.signOff.method ? `by ${c.signOff.method.replaceAll("_", " ")}` : ""}
                  {c.signOff.verified === false ? ", not verified" : c.signOff.verified ? ", verified" : ""}. The proof covers exactly this order (digest {c.signOff.orderDigest.slice(0, 12)}…).
                </p>
              )}
              <p className="mt-1">
                The gate&apos;s decision: {c.decision.rules.filter((r) => r.outcome === "pass").length} of {c.decision.rules.length} checks passed
                {c.decision.rules.some((r) => r.outcome !== "pass") ? "; " + c.decision.rules.filter((r) => r.outcome !== "pass").map((r) => `${r.title.toLowerCase()} ${r.outcome === "fail" ? "refused" : "needed a person"}`).join(", ") : ""}.
              </p>
              {!c.confirmation && <p className="mt-1 text-ink-soft">No signed confirmation: the order was not committed.</p>}
            </Panel>
          </Section>

          <Section title="The record, as the wholesaler reads it" aside={`${a.ledger.withheld} buyer-side step${a.ledger.withheld === 1 ? "" : "s"} kept with the kitchen`}>
            <Panel className="px-4 py-3">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[0.75rem] leading-relaxed">{fi(a.ledger.explanation.join("\n"))}</pre>
              <p className="mt-2 text-[0.82rem] text-ink-soft">Not in this record: the kitchen&apos;s order history, the rules it stated and the patterns Dock learned from it. Those entries appear only by number and hash, so the chain still shows no gap.</p>
            </Panel>
          </Section>
        </div>

        <div className="space-y-4 xl:pt-[2.6rem]">
          {c.confirmation ? <VerifyBox key={c.confirmation} initial={c.confirmation} title="Verify this order's signed confirmation" /> : <VerifyBox />}
          {a.signedClaims.tokens.length > 0 && (
            <Panel className="px-4 py-3">
              <h2 className="font-display text-[1.05rem] font-bold">Signed claims the quote rests on</h2>
              <ul className="mt-1 space-y-1 text-[0.84rem]">
                {a.signedClaims.tokens.map((t) => (
                  <li key={t.claimId}>
                    <b>{t.type}</b> of {t.productId}, valid until {when(t.validUntil)}
                    <Details summary="Token">
                      <KV k="id" v={t.claimId} />
                      <KV k="sha256" v={t.sha256} />
                      <p className="select-all">{t.token}</p>
                    </Details>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[0.8rem] text-ink-soft">Paste any token above into the checker to verify it.</p>
            </Panel>
          )}
          <ChainCheck />
          <Details summary="Ids">
            <KV k="order" v={a.order.orderId} />
            <KV k="request" v={a.order.requestId} />
            <KV k="quote" v={a.order.quoteId} />
            <KV k="org" v={a.order.orgId} />
            <KV k="agent" v={a.order.agentId} />
            <KV k="mandate" v={a.order.mandateId} />
            <KV k="key" v={`${a.keys.kid} at ${a.keys.jwks}`} />
            {c.ledgerHead && <KV k="anchor" v={`${c.ledgerHead.seq} ${c.ledgerHead.hash}`} />}
          </Details>
        </div>
      </div>
    </>
  );
}
