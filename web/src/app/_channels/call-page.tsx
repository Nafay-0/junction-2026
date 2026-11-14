"use client";

import type { PublicOrder } from "@/core/orders";
import { useText } from "../_i18n/provider";
import { CallScreen } from "./call-screen";
import { DOORS_TEXT } from "./doors.text";

/** The call screen on the visitor's own phone: an order that needs their sign-off hands over to /approve here. */
export function CallPage({ kitchen, visitor }: { kitchen: string; visitor: boolean }) {
  const tx = useText(DOORS_TEXT);
  return (
    <CallScreen
      kitchen={kitchen}
      langSwitch
      signOffHref={visitor ? (o: PublicOrder) => (o.approval ? `/approve/${encodeURIComponent(o.approval.approvalId)}` : undefined) : undefined}
      renderSignOff={visitor ? undefined : () => <p className="text-[1rem] text-ink-soft">{tx.onApproverPhone}</p>}
    />
  );
}
