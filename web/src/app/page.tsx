import { connection } from "next/server";
import { Suspense } from "react";
import { decidingRule } from "@/core/policy";
import { formatEur } from "@/core/util";
import { getRuntime } from "@/server/runtime";

// Functional status page over the in-memory store. Visual design comes later.
export default function Home() {
  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dock</h1>
      <p>Open gateway for AI purchasing agents. Orders, gate decisions and reasons from this server&apos;s in-memory store.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Status />
      </Suspense>
    </main>
  );
}

async function Status() {
  await connection(); // request-time data: never prerender
  const { dock } = await getRuntime();
  const orders = (await dock.listOrders()).reverse();
  const pending = await dock.listPendingApprovals();
  const stats = dock.stats();
  const chain = dock.ledger.verify();

  return (
    <>
      <section>
        <h2 className="text-xl font-semibold">Partner API use</h2>
        <p>
          Live price/availability calls: <strong>{stats.liveCalls}</strong> (covering {stats.productsPriced} product prices).
          Master-data searches (local): {stats.searches}.
        </p>
        <p>
          Ledger: {dock.ledger.entries().length} entries, chain {chain.ok ? "verified" : `BROKEN: ${chain.message}`}.{" "}
          <a className="underline" href="/api/v1/ledger">Read it</a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Waiting for sign-off ({pending.length})</h2>
        <ul className="list-disc pl-6">
          {pending.map((p) => (
            <li key={p.approvalId}>
              {p.orderId}: {formatEur(p.totalCents)} for {p.orgName}, waiting for {p.approver.name} ({p.approver.role})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Orders ({orders.length})</h2>
        {orders.length === 0 && (
          <p>
            No orders yet. Run <code>pnpm demo --url http://localhost:3000</code> against this server.
          </p>
        )}
        <table className="border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="border p-2">Order</th>
              <th className="border p-2">Status</th>
              <th className="border p-2">Decision</th>
              <th className="border p-2">Total</th>
              <th className="border p-2">Lines</th>
              <th className="border p-2">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.orderId} className="align-top">
                <td className="border p-2">
                  {o.orderId}
                  <br />
                  {o.createdAt.slice(11, 19)} UTC
                </td>
                <td className="border p-2">{o.status}</td>
                <td className="border p-2">
                  {o.decision.outcome}
                  {o.decision.outcome === "reject" && <> (rule: {decidingRule(o.decision)?.rule})</>}
                  {o.approval && (
                    <>
                      <br />
                      sign-off: {o.approval.approver.name}, {o.approval.status}
                    </>
                  )}
                </td>
                <td className="border p-2">{formatEur(o.totalCents)}</td>
                <td className="border p-2">
                  {o.lines.map((l) => (
                    <div key={l.productId}>
                      {l.quantity} x {l.productId}
                      {l.substituteFor && <> (for {l.substituteFor.productId})</>}
                    </div>
                  ))}
                </td>
                <td className="border p-2">
                  <ul className="list-disc pl-4">
                    {o.decision.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
