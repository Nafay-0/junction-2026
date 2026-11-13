"use client";

import type { PublicOrder } from "@/core/orders";
import { CallScreen } from "./call-screen";

/** The call screen on the visitor's own phone: an order that needs their sign-off hands over to /approve here. */
export function CallPage({ kitchen, visitor }: { kitchen: string; visitor: boolean }) {
  return (
    <CallScreen
      kitchen={kitchen}
      signOffHref={visitor ? (o: PublicOrder) => (o.approval ? `/approve/${encodeURIComponent(o.approval.approvalId)}` : undefined) : undefined}
      renderSignOff={visitor ? undefined : () => <p className="text-[1rem] text-ink-soft">The sign-off request is on the approver&apos;s phone.</p>}
    />
  );
}
