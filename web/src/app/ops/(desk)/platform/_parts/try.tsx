"use client";

import type { TryDoorId, TryRoom, TryStatus } from "@/server/ops/try-caps";
import { useOps } from "../../../_ui/kit";

/**
 * The actions a visitor may try on the Platform pages without the passcode (server/ops/try-caps.ts): what this address
 * has left, read from the server. Staff are not counted.
 */
export function useTry(door: TryDoorId): { staff: boolean; room?: TryRoom; refresh: () => void } {
  const live = useOps<TryStatus>("/ops-api/platform/try", { pollMs: 20_000 });
  return { staff: live.data?.staff ?? false, room: live.data?.doors[door], refresh: live.refresh };
}

/** True when this visitor cannot press now; the reason is TryNote's bold line, shown next to the button. */
export const tryBlocked = (t: { staff: boolean; room?: TryRoom }) => !t.staff && Boolean(t.room?.blocked);

/** One plain line on what pressing costs or touches, and for a visitor what is left from this address. */
export function TryNote({ t, free, className = "" }: { t: { staff: boolean; room?: TryRoom }; free?: string; className?: string }) {
  const r = t.room;
  if (!r) return null;
  if (free)
    return (
      <p className={`text-[0.84rem] leading-snug text-ink-soft ${className}`}>
        {free}
      </p>
    );
  return (
    <p className={`text-[0.84rem] leading-snug text-ink-soft ${className}`}>
      {r.costs}
      {!t.staff && (
        <>
          {" "}
          {r.blocked ? (
            <b className="block pt-0.5 font-semibold text-ink" role="status">
              {r.blocked}
            </b>
          ) : (
            <span className="block pt-0.5">
              From this address: <b className="text-ink">{r.left}</b> of {r.perAddress} {r.perAddress === 1 ? r.one : r.many} {r.windowWords} left
              {r.dayLeft !== null && r.perDay !== null ? `; ${r.dayLeft} of ${r.perDay} left today for all visitors` : ""}.
            </span>
          )}
        </>
      )}
    </p>
  );
}
