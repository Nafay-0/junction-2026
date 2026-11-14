import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneShell } from "../../_ui/phone";
import { ApprovalScreen } from "./approval-screen";

export const metadata: Metadata = { title: "AimoPilot: sign-off" };

/**
 * The sign-off screen behind an approval link or QR code. Approvers with a passkey approve with it (the challenge
 * is bound to this exact order); the legacy demo org still uses the one-time `?token=` from its approval link.
 */
export default function ApprovePage(props: PageProps<"/approve/[approvalId]">) {
  return (
    <PhoneShell tone="gate" context="Sign-off">
      <Suspense fallback={<p className="mt-20 text-center text-ink-soft">Opening the request…</p>}>
        <Approval {...props} />
      </Suspense>
    </PhoneShell>
  );
}

async function Approval({ params, searchParams }: PageProps<"/approve/[approvalId]">) {
  const { approvalId } = await params;
  const sp = await searchParams;
  return <ApprovalScreen approvalId={approvalId} token={typeof sp.token === "string" ? sp.token : undefined} />;
}
