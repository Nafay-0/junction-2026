"use client";

import { useState } from "react";
import type { MailView } from "@/server/notify/service";
import { api } from "../../../_client/api";
import { Badge } from "../../../_ui/kit";
import { num, when } from "../../_ui/format";
import { Button, Empty, LoadError, Loading, Num, PageHead, Panel, Section, useNow, useOps } from "../../_ui/kit";
import { Table } from "../../_ui/parts";
import { MAIL_TEXT } from "./mail.text";

type Mail = MailView["mails"][number];

const KIND: Record<string, string> = { confirm: "Address confirmation", receipt: "Receipt", sign_off: "Waiting for sign-off", changed: "Something changed" };
const CHANGE: Record<string, string> = { cannot_come: "cannot come", substituted: "substitute ordered", renewal_held: "renewal held", refused: "refused", declined: "declined", expired: "expired", withdrawn: "taken back" };
const OUTCOME: Record<string, { label: string; tone: "good" | "info" | "neutral" | "refused" | "bad" }> = {
  sent: { label: "Sent", tone: "good" },
  sending: { label: "Sending", tone: "info" },
  skipped: { label: "Not sent", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
};
const STATE: Record<string, string> = { pending: "waiting for confirmation", confirmed: "confirmed", stopped: "stopped by the kitchen", bounced: "bounced" };

export function MailScreen() {
  const live = useOps<MailView>("/ops-api/mail", { pollMs: 4000 });
  const now = useNow();
  const v = live.data;
  return (
    <>
      <PageHead
        title={MAIL_TEXT.en.title}
        purpose={MAIL_TEXT.en.purpose}
        right={v ? <span>{v.configured ? `${v.transport}, from ${v.from}` : "No mail service configured"}</span> : undefined}
      />
      <LoadError message={live.error} />
      {!v || !now ? <Loading label="Reading the mail log…" /> : <Body v={v} now={now} />}
    </>
  );
}

function Body({ v, now }: { v: MailView; now: number }) {
  const [preview, setPreview] = useState<{ mailId: string; subject: string; html: string } | undefined>();
  const [error, setError] = useState<string>();
  const open = async (m: Mail) => {
    setError(undefined);
    const r = await api<{ subject: string; html: string }>("GET", `/ops-api/mail?preview=${encodeURIComponent(m.mailId)}`);
    if (!r.ok) return setError(r.error.message);
    setPreview({ mailId: m.mailId, ...r.data });
  };
  return (
    <>
      <Panel className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 xl:divide-x xl:divide-line">
        <Num n={num(v.stats.sent)} label="sent" />
        <Num n={num(v.stats.skipped)} label="not sent" sub="no confirmation, stopped, a cap, no service" />
        <Num n={num(v.stats.failed)} label="failed" sub="the order is never affected" safety={v.stats.failed > 0} />
        <Num n={num(v.stats.bounced)} label="bounced or spam" />
        <Num n={`${num(v.caps.leftToday)} / ${num(v.caps.daily)}`} label="left in 24 hours" sub="the service's daily cap" />
        <Num n={num(v.caps.perKitchenHour)} label="per kitchen an hour" sub="the kitchen cap" />
      </Panel>
      {v.testSenderOnly && v.configured && (
        <p className="mt-3 text-[0.9rem] text-ink-soft">
          Sending from Resend&apos;s shared test sender ({v.from}): Resend delivers only to the Resend account&apos;s own address. Sending to kitchens needs a domain verified in Resend and DOCK_MAIL_FROM on it.
        </p>
      )}
      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <Section title="What was emailed, to whom, and what happened" aside={v.mails.length ? `${v.mails.length}` : undefined}>
            {v.mails.length === 0 ? (
              <Empty title={MAIL_TEXT.en.emptyTitle}>{MAIL_TEXT.en.empty}</Empty>
            ) : (
              <Table label="Mails">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kitchen</th>
                    <th>Event</th>
                    <th>Outcome</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {v.mails.map((m) => (
                    <tr key={m.mailId} aria-selected={preview?.mailId === m.mailId}>
                      <td className="tabular whitespace-nowrap">{when(m.at, new Date(now))}</td>
                      <td>
                        <span className="font-semibold">{m.kitchenName}</span>
                        <span className="block text-[0.85rem] text-ink-soft">{m.maskedTo}</span>
                      </td>
                      <td>
                        {KIND[m.kind] ?? m.kind}
                        {m.change ? `: ${CHANGE[m.change] ?? m.change}` : ""}
                        {m.orderId && <span className="block text-[0.85rem] text-ink-soft tabular">{m.orderId}</span>}
                        <span className="block text-[0.85rem] text-ink-soft">{m.subject}</span>
                      </td>
                      <td>
                        <Badge tone={OUTCOME[m.outcome]?.tone ?? "neutral"}>{OUTCOME[m.outcome]?.label ?? m.outcome}</Badge>
                        {m.delivery && m.delivery !== "sent" && <span className="block text-[0.85rem] text-ink-soft">{m.delivery}</span>}
                        {m.reason && <span className="block text-[0.85rem] text-ink-soft">{m.reason}</span>}
                        {m.providerId && <span className="block text-[0.8rem] text-ink-faint tabular">id {m.providerId}</span>}
                      </td>
                      <td>
                        <Button onClick={() => void open(m)}>Preview</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
          <Section title="Kitchens with an address" aside={v.kitchens.length ? `${v.kitchens.length}` : undefined}>
            {v.kitchens.length === 0 ? (
              <Empty title="No kitchen has given an address">Mail is off for a kitchen until it gives an address and confirms it. {num(v.noAddressEvents)} order events so far for kitchens without one: nothing was sent for them.</Empty>
            ) : (
              <Table label="Kitchens">
                <thead>
                  <tr>
                    <th>Kitchen</th>
                    <th>Address</th>
                    <th>Language</th>
                    <th>This hour</th>
                  </tr>
                </thead>
                <tbody>
                  {v.kitchens.map((k) => (
                    <tr key={k.orgId}>
                      <td className="font-semibold">{k.kitchenName}</td>
                      <td>
                        {k.masked}
                        <span className="block text-[0.85rem] text-ink-soft">{STATE[k.state] ?? k.state}</span>
                      </td>
                      <td className="uppercase">{k.lang}</td>
                      <td className="tabular">
                        {num(k.sentThisHour)} sent, {num(k.leftThisHour)} left
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </div>
        <Section title={preview ? preview.subject : "Preview"}>
          {error && <p className="text-[0.9rem] text-bad">{error}</p>}
          {preview ? (
            <iframe title={`Preview: ${preview.subject}`} sandbox="" srcDoc={preview.html} className="h-[900px] w-full rounded-lg border border-line bg-paper" />
          ) : (
            <Empty title="Choose a mail">The mail as the kitchen got it, rendered again from what it said, with the address masked and its links inert.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
