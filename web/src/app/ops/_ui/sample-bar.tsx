"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../../_client/api";
import { SamplePill } from "../../_ui/sample";
import { Button, Panel, useOps } from "./kit";
import { SAMPLE_BAR_TEXT } from "./sample.text";

type Status = { setting: string; running: boolean; hidden: boolean; sets: number; current?: { set: string; firstAt: string; lastAt: string }; ids: Record<string, string>; played?: { ms: number } | null };

const COOKIE = "aimopilot-sample";
const t = SAMPLE_BAR_TEXT.en;

function setHidden(hide: boolean) {
  document.cookie = hide ? `${COOKIE}=hidden; path=/; max-age=31536000; samesite=lax` : `${COOKIE}=; path=/; max-age=0; samesite=lax`;
  location.reload();
}

/** One line at the top of every operations page while sample activity is in the store, with the switch to hide it. */
export function SampleBar() {
  const live = useOps<Status>("/ops-api/sample", { pollMs: 20_000 });
  const [busy, setBusy] = useState<string>();
  const d = live.data;
  if (!d || (!d.sets && !d.running)) return null;
  const refresh = async () => {
    setBusy(t.refreshing);
    const r = await api<Status>("POST", "/ops-api/sample", { action: "refresh" });
    setBusy(r.ok && r.data.played ? t.refreshed(r.data.played.ms) : r.ok ? undefined : r.error.message);
    live.refresh();
  };
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-strong bg-paper/70 px-3 py-2 text-[0.88rem] text-ink-soft">
      <SamplePill className="ml-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">{d.hidden ? t.hidden : t.showing}</span> {!d.hidden && <span className="hidden md:inline">{t.showingMore}</span>}
        {busy && <span className="block">{busy}</span>}
      </span>
      <Button onClick={() => setHidden(!d.hidden)}>{d.hidden ? t.show : t.hide}</Button>
      {!d.hidden && (
        <Button onClick={() => void refresh()} disabled={!!busy && busy === t.refreshing}>
          {t.refresh}
        </Button>
      )}
    </div>
  );
}

/** "Start here" on the operations portal's first page: five sample items, each opened straight away. */
export function StartHere() {
  const live = useOps<Status>("/ops-api/sample", { pollMs: 30_000 });
  const d = live.data;
  if (!d?.current || d.hidden) return null;
  const ids = d.ids;
  const waiting = ids.waiting2 ?? ids.waiting1 ?? ids.waiting0 ?? ids.lumoWaiting;
  const items: [string, string | undefined][] = [
    ["timeline", ids.approved ? `/ops/orders/${ids.approved}` : undefined],
    ["waiting", waiting ? `/ops/orders/${waiting}` : undefined],
    ["refusal", ids.partnerRefused ? `/ops/orders/${ids.partnerRefused}` : ids.nutritionRefused ? `/ops/orders/${ids.nutritionRefused}` : undefined],
    ["failing", "/ops/agents#scorecard"],
    ["cannotCome", "/ops/watch"],
  ];
  return (
    <Panel className="mb-6 p-4 sm:p-5">
      <h2 className="display text-[1.2rem] text-ink">{t.startTitle}</h2>
      <p className="mt-1 text-[0.9rem] text-ink-soft">{t.startLead}</p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {items.map(([key, href], i) =>
          href ? (
            <li key={key}>
              <Link href={href} className="block h-full rounded-lg border border-line bg-mist/40 px-3 py-2 hover:border-petrol">
                <span className="font-semibold text-petrol">
                  {i + 1}. {t.start[key][0]}
                </span>
                <span className="mt-0.5 block text-[0.84rem] leading-snug text-ink-soft">{t.start[key][1]}</span>
              </Link>
            </li>
          ) : null,
        )}
      </ol>
    </Panel>
  );
}
