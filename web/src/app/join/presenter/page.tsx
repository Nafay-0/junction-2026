import type { Metadata } from "next";
import { Suspense } from "react";
import { PresenterFlow } from "./presenter-flow";

export const metadata: Metadata = { title: "Sign for a demo kitchen" };

/**
 * Opened from the QR code a demo kitchen's console shows while an order waits. A presenter who knows the operations
 * passcode makes a passkey on their own phone and becomes that kitchen's (fictional) approver.
 */
export default function PresenterPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8 text-lg">
      <Suspense fallback={<p>Loading…</p>}>
        <PresenterFlow />
      </Suspense>
    </main>
  );
}
