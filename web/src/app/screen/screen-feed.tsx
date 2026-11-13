"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../_client/api";
import { useDockEvents, type LiveEvent } from "../_client/use-dock-events";

type Kitchen = { sandboxId: string; kitchenName: string; city: string; approverName: string; orgId: string };

const LABEL: Record<LiveEvent["type"], string> = {
  approval_requested: "Needs sign-off",
  approval_approved: "Approved",
  approval_declined: "Declined",
  order_committed: "Signed order",
  order_rejected: "Not placed",
};

const COLOR: Record<LiveEvent["type"], string> = {
  approval_requested: "bg-amber-100",
  approval_approved: "bg-green-50",
  approval_declined: "bg-neutral-100",
  order_committed: "bg-green-100",
  order_rejected: "bg-red-50",
};

export function ScreenFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadKitchens = useCallback(async () => {
    const r = await api<{ sandboxes: Kitchen[] }>("GET", "/api/v1/sandboxes");
    if (r.ok) setKitchens(r.data.sandboxes.slice().reverse());
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadKitchens());
  }, [loadKitchens]);

  useDockEvents(
    "/api/v1/events",
    (e) => {
      setEvents((xs) => (xs.some((x) => x.id === e.id) ? xs : [e, ...xs].slice(0, 12)));
      void loadKitchens();
    },
    () => void loadKitchens(),
  );

  async function start(k: Kitchen) {
    setBusy(k.sandboxId);
    await api("POST", `/api/v1/sandboxes/${encodeURIComponent(k.sandboxId)}/demo-order`);
    setBusy(null);
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Live</h2>
        {events.length === 0 && <p className="mt-2 text-xl text-neutral-500">Waiting for the first order…</p>}
        <ul className="mt-3 space-y-2">
          {events.map((e) => (
            <li key={e.id} className={`rounded-xl p-4 text-xl ${COLOR[e.type]}`}>
              <span className="font-semibold">{LABEL[e.type]}</span> · {e.summary}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-xl font-semibold">Kitchens here now ({kitchens.length})</h2>
        <ul className="mt-2 divide-y divide-neutral-200">
          {kitchens.map((k) => (
            <li key={k.sandboxId} className="flex items-center justify-between py-2 text-lg">
              <span>
                {k.kitchenName}, {k.city}: {k.approverName}
              </span>
              <button className="rounded-lg border border-neutral-300 px-3 py-1 text-base disabled:opacity-50" disabled={busy === k.sandboxId} onClick={() => void start(k)}>
                Start the agent
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
