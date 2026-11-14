"use client";

import { useEffect, useState } from "react";
import { api } from "../_client/api";
import { Button } from "../_ui/kit";
import type { WeekRun } from "@/server/show/types";
import { useLiveWeek } from "./use-week";
import { WeekBoard } from "./week-board";

/**
 * The kitchen's own week, inside its store: the same board as the big screen, for the visitor at their own phone
 * or laptop. The sign-off still arrives on the phone that joined, as for any order.
 */
export function KitchenWeek({ kitchen, visitor }: { kitchen: string; visitor: boolean }) {
  const [runId, setRunId] = useState<string>();
  const [initial, setInitial] = useState<WeekRun>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { run } = useLiveWeek(runId, initial, (id, after) => `/ui-api/show/kitchen/${encodeURIComponent(kitchen)}/week?run=${id}&after=${after}`);

  useEffect(() => {
    if (!visitor) return;
    const t = setTimeout(async () => {
      const r = await api<{ run: WeekRun | null }>("GET", `/ui-api/show/kitchen/${encodeURIComponent(kitchen)}/week`);
      if (r.ok && r.data.run) {
        setInitial(r.data.run);
        setRunId(r.data.run.runId);
      } else if (!r.ok) setError(r.error.message);
    }, 0);
    return () => clearTimeout(t);
  }, [kitchen, visitor]);

  async function play() {
    setBusy(true);
    setError(undefined);
    const r = await api<{ run: WeekRun }>("POST", `/ui-api/show/kitchen/${encodeURIComponent(kitchen)}/week`);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setInitial(r.data.run);
    setRunId(r.data.run.runId);
  }

  const shown = run ?? initial;
  const playing = shown && !["finished", "cancelled", "failed"].includes(shown.state);
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[2.6rem] text-ink sm:text-[3rem]">A week in this kitchen</h1>
          <p className="max-w-[64ch] text-[1.02rem] leading-snug text-ink-soft">
            The kitchen&apos;s agent works through a week in about a minute: the standing order, a slip in the amount, a sold-out product, a last-minute booking that needs your sign-off, a standing order that crept up, and a swap the gate refuses. Every step is a real order through the gate.
          </p>
        </div>
        {visitor && (
          <Button kind="go" size="lg" busy={busy} disabled={!!playing} onClick={() => void play()}>
            {shown ? "Play the week again" : "Play the week"}
          </Button>
        )}
      </div>
      {!visitor && <p className="mt-4 bg-paper p-4 text-[1.05rem]">The week plays in a visitor&apos;s own kitchen. Scan the QR code at the table to get one; your phone signs what the agent may not.</p>}
      {error && (
        <p role="alert" className="mt-4 bg-paper p-4 font-semibold text-ink">
          {error}
        </p>
      )}
      {shown && (
        <div className="mt-5 h-[min(78vh,820px)] min-h-[560px]">
          <WeekBoard run={shown} compact />
        </div>
      )}
    </div>
  );
}
