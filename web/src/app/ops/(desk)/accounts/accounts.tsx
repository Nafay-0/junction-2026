"use client";

import { useState } from "react";
import type { AccountRow } from "@/server/accounts/ops-view";
import { api } from "../../../_client/api";
import { when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";

const KIND: Record<AccountRow["kind"], string> = { own: "Restaurant's own", test: "Shared test account", demo: "Stage kitchen" };

export function AccountsScreen() {
  const live = useOps<{ accounts: AccountRow[]; testAccounts: { shown: boolean; resetMinutes: number } }>("/ops-api/accounts", { pollMs: 10_000 });
  const d = live.data;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  async function reset() {
    setBusy(true);
    const r = await api<{ reset: string[] }>("POST", "/ops-api/accounts/reset", {});
    setBusy(false);
    setNote(r.ok ? `Reset ${r.data.reset.join(", ")} to their seed: rules, mandate and history. Their earlier orders stay in the ledger.` : r.error.message);
    live.refresh?.();
  }
  return (
    <>
      <PageHead
        title="Accounts"
        purpose="Every restaurant or buyer with an account, as a kitchen: its store address, when it signed up and when it last ordered. Accounts hold nothing else about a person: no email address, no name."
      />
      <LoadError message={live.error} />
      <Section
        title="Shared test accounts"
        aside={
          <Button kind="primary" onClick={() => void reset()} disabled={busy}>
            {busy ? "Resetting…" : "Reset test accounts"}
          </Button>
        }
      >
        <p className="max-w-[80ch] text-[0.95rem] leading-snug">
          {d
            ? `Anyone can use them, so they are put back to their seed ${d.testAccounts.resetMinutes ? `every ${d.testAccounts.resetMinutes} minutes` : "only from here (the schedule is off)"}. The sign-in page ${d.testAccounts.shown ? "lists them with their passwords" : "does not list them (DOCK_TEST_ACCOUNTS_SHOWN is off)"}.`
            : "…"}
        </p>
        {note && (
          <p role="status" className="mt-2 border-l-[6px] border-petrol bg-paper px-3 py-2 text-[0.95rem]">
            {note}
          </p>
        )}
      </Section>
      {!d ? (
        <Loading label="Reading the accounts…" />
      ) : d.accounts.length === 0 ? (
        <Empty title="No accounts yet">A restaurant appears here once it opens an account at /k/signup.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-t-[3px] border-petrol bg-paper text-left text-[0.95rem]">
            <thead className="text-ink-soft">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Kitchen</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Signed up</th>
                <th className="px-3 py-2 font-medium">Last ordered</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.accounts.map((a) => (
                <tr key={a.kitchen}>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{a.restaurant}</span> <span className="text-ink-soft">/k/{a.kitchen}</span>
                    {!a.hasKitchen && a.kind !== "demo" && <span className="text-ink-soft">, mandate not signed yet</span>}
                  </td>
                  <td className="px-3 py-2">{KIND[a.kind]}</td>
                  <td className="px-3 py-2">{when(a.signedUpAt)}</td>
                  <td className="px-3 py-2">{a.lastOrderAt ? when(a.lastOrderAt) : "Never"}</td>
                  <td className="px-3 py-2 text-right tabular">{a.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
