import type { Metadata } from "next";
import { Suspense } from "react";
import { ApprovalScreen } from "./approval-screen";

export const metadata: Metadata = { title: "Dock: sign-off" };

/**
 * The sign-off screen behind an approval link or QR code. Approvers with a passkey approve with it (the challenge
 * is bound to this exact order); the legacy demo org still uses the one-time `?token=` from its approval link.
 */
export default function ApprovePage(props: PageProps<"/approve/[approvalId]">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-6 text-lg">
      <Suspense fallback={<p className="mt-20 text-center text-neutral-600">Loading…</p>}>
        <Approval {...props} />
      </Suspense>
    </main>
  );
}

async function Approval({ params, searchParams }: PageProps<"/approve/[approvalId]">) {
  const { approvalId } = await params;
  const sp = await searchParams;
  return <ApprovalScreen approvalId={approvalId} token={typeof sp.token === "string" ? sp.token : undefined} />;
}
