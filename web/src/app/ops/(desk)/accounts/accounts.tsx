"use client";

import { useState } from "react";
import type { AccountRow } from "@/server/accounts/ops-view";
import { api } from "../../../_client/api";
import { when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { Avatar, Badge } from "../../../_ui/kit";
import { ACCOUNTS_TEXT } from "./accounts.text";

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
        title={ACCOUNTS_TEXT.en.title}
        purpose={ACCOUNTS_TEXT.en.purpose}
        about="Every restaurant or buyer with an account, as a kitchen: its store address, when it signed up and when it last ordered. Accounts hold nothing else about a person: no email address, no name."
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
        <p className="max-w-[80ch] rounded-xl border border-line bg-paper p-5 text-[0.95rem] leading-relaxed">
          {d
            ? `Anyone can use them, so they are put back to their seed ${d.testAccounts.resetMinutes ? `every ${d.testAccounts.resetMinutes} minutes` : "only from here (the schedule is off)"}. The sign-in page ${d.testAccounts.shown ? "lists them with their passwords" : "does not list them (DOCK_TEST_ACCOUNTS_SHOWN is off)"}.`
            : "…"}
        </p>
        {note && (
          <p role="status" className="mt-3 rounded-lg bg-good-soft px-4 py-3 text-[0.95rem]">
            {note}
          </p>
        )}
      </Section>
      {!d ? (
        <Loading label="Reading the accounts…" />
      ) : d.accounts.length === 0 ? (
        <Empty title={ACCOUNTS_TEXT.en.emptyTitle}>{ACCOUNTS_TEXT.en.empty}</Empty>
      ) : (
        <Section title="Kitchens with an account" aside={`${d.accounts.length}`}>
          <Table label="Accounts">
            <thead>
              <tr>
                <th>Kitchen</th>
                <th>Kind</th>
                <th>Signed up</th>
                <th>Last ordered</th>
                <th className="text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {d.accounts.map((a) => (
                <tr key={a.kitchen}>
                  <td>
                    <span className="flex items-center gap-3">
                      <Avatar name={a.restaurant} size={32} />
                      <span className="min-w-0">
                        <span className="block font-semibold">{a.restaurant}</span>
                        <span className="block text-[0.84rem] text-ink-soft">
                          /k/{a.kitchen}
                          {!a.hasKitchen && a.kind !== "demo" && ", mandate not signed yet"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Badge tone={a.kind === "own" ? "info" : a.kind === "test" ? "agent" : "neutral"}>{KIND[a.kind]}</Badge>
                  </td>
                  <td className="whitespace-nowrap tabular">{when(a.signedUpAt)}</td>
                  <td className="whitespace-nowrap tabular">{a.lastOrderAt ? when(a.lastOrderAt) : <span className="text-ink-soft">Never</span>}</td>
                  <td className="text-right font-semibold tabular">{a.orders}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </>
  );
}
