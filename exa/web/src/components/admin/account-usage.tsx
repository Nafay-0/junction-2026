"use client";

import * as React from "react";
import { ChartNoAxesColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, errorOf } from "@/lib/auth/fetch";
import type { Account, AccountUsage } from "@/lib/db/admin";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "./admin-shell";
import { count, usd } from "./format";
import { LimitUse } from "./permissions";
import { Rows, SpendSplit, modeRowsOf, modelRowsOf, totalSpend } from "./usage-parts";

type Loaded = { key: string; data?: AccountUsage; error?: string };

/**
 * What one account used: its cost by kind, by mode and by model, and its requests, for the last
 * 14 or 30 days. Only the admin opens this, so the models' names are shown as they are.
 */
export function UsageDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  // The dialog fades out after `account` is gone: keep showing who it was about until then.
  const [shown, setShown] = React.useState<Account | null>(null);
  if (account && account !== shown) setShown(account);
  const [days, setDays] = React.useState<14 | 30>(14);
  const [loaded, setLoaded] = React.useState<Loaded>({ key: "" });

  const id = account?.id;
  const key = id ? `${id}:${days}` : "";
  React.useEffect(() => {
    if (!id) return;
    let gone = false;
    void (async () => {
      let next: Loaded;
      try {
        const response = await api(`/api/admin/users/${id}/usage?days=${days}`);
        next = response.ok ? { key: `${id}:${days}`, data: (await response.json()) as AccountUsage } : { key: `${id}:${days}`, error: await errorOf(response) };
      } catch {
        next = { key: `${id}:${days}`, error: "The server could not be reached." };
      }
      if (!gone) setLoaded(next);
    })();
    return () => {
      gone = true;
    };
  }, [id, days]);

  const current = loaded.key === key ? loaded : undefined;
  const data = current?.data;
  const spent = data ? totalSpend(data.period) : 0;
  const everything = data ? totalSpend(data.allTime) : 0;

  return (
    <Dialog open={account !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.3rem] leading-tight">What {shown?.name ?? "this account"} used</DialogTitle>
          <DialogDescription className="break-all">{shown?.email}</DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Period" className="flex w-fit items-center gap-1 rounded-full border border-border bg-background p-1 text-[0.78rem]">
          {([14, 30] as const).map((span) => (
            <button
              key={span}
              type="button"
              aria-pressed={days === span}
              onClick={() => setDays(span)}
              className={cn("h-7 rounded-full px-3 font-medium transition-colors", days === span ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Last {span} days
            </button>
          ))}
        </div>

        {current?.error ? (
          <p role="alert" className="text-[0.86rem] leading-snug text-destructive">
            {current.error}
          </p>
        ) : !data ? (
          <div aria-busy className="flex flex-col gap-3">
            <div className="shimmer h-20 rounded-xl" />
            <div className="shimmer h-28 rounded-xl" />
            <div className="shimmer h-24 rounded-xl" />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2.5">
              <Figure label="Cost" value={usd(spent)} accent />
              <Figure label="Requests" value={count(data.period.requests)} />
              <Figure label="Tokens" value={count(data.period.tokens)} />
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-[0.8rem]">
              <span className="text-muted-foreground">Since the account was made{data.usageCapUsd === null ? ", with no limit" : ""}</span>
              <LimitUse account={{ costUsd: everything, usageCapUsd: data.usageCapUsd }} />
            </div>

            {data.period.requests === 0 ? (
              <Empty icon={<ChartNoAxesColumn />} title={`Nothing used in the last ${data.days} days`}>
                The split by kind of cost, by mode and by model appears here once the account asks for something.
              </Empty>
            ) : (
              <>
                <Section title="Where the money went" note={`${count(data.period.exaCalls)} Exa calls${data.period.decisionCalls > 0 ? `, ${count(data.period.decisionCalls)} requests to the decision model` : ""}.`}>
                  <SpendSplit spend={data.period} />
                </Section>
                <Section title="By mode" note="What the account picked.">
                  <Rows head={["Mode", "Requests", "Tokens", "Cost"]} rows={modeRowsOf(data.byMode, spent)} />
                </Section>
                <Section title="By model" note="The model that did the work.">
                  <Rows head={["Model", "Requests", "Tokens", "Cost"]} rows={modelRowsOf(data.byModel, spent)} />
                </Section>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card px-3 py-2.5", accent ? "border-brand/30" : "border-border")}>
      <dt className="text-[0.68rem] tracking-wider text-subtle uppercase">{label}</dt>
      <dd className={cn("nums mt-1 truncate text-[1.15rem] leading-none font-semibold tracking-tight", accent && "text-brand")}>{value}</dd>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[0.9rem] font-medium tracking-tight">{title}</h3>
        {note ? <p className="text-[0.74rem] text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
