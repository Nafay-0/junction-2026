import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneShell } from "../../_ui/phone";
import { PresenterFlow } from "./presenter-flow";

export const metadata: Metadata = { title: "Sign for a demo kitchen" };

/**
 * Opened from the QR code a demo kitchen's console shows while an order waits. A presenter who knows the operations
 * passcode makes a passkey on their own phone and becomes that kitchen's (fictional) approver. English only: it is the
 * presenters' tool, so the language switch is left out.
 */
export default function PresenterPage() {
  return (
    <PhoneShell context="Presenter" langs={false}>
      <Suspense fallback={<div className="skeleton h-40 !rounded-xl" />}>
        <PresenterFlow />
      </Suspense>
    </PhoneShell>
  );
}
