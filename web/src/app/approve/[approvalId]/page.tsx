import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DockError } from "@/core/orders";
import { formatEur } from "@/core/util";
import { getRuntime } from "@/server/runtime";

/**
 * The page behind the approval link. Functional placeholder: whoever holds the one-time token can decide.
 * PASSKEY SEAM: the phone approval flow replaces the token with a WebAuthn assertion (see src/core/approval.ts).
 */
export default function ApprovePage(props: PageProps<"/approve/[approvalId]">) {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Sign-off request</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Approval {...props} />
      </Suspense>
    </main>
  );
}

async function decide(formData: FormData) {
  "use server";
  const approvalId = String(formData.get("approvalId"));
  const token = String(formData.get("token"));
  const decision = formData.get("decision") === "approve" ? "approve" : "decline";
  const { dock } = await getRuntime();
  try {
    await dock.decideApproval(approvalId, { decision, proof: { kind: "link_token", token } });
  } catch (err) {
    if (err instanceof DockError) redirect(`/approve/${approvalId}?error=${err.code}`);
    throw err;
  }
  redirect("/");
}

async function Approval({ params, searchParams }: PageProps<"/approve/[approvalId]">) {
  const { approvalId } = await params;
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const { dock } = await getRuntime();
  const p = (await dock.listPendingApprovals()).find((a) => a.approvalId === approvalId);
  if (!p) {
    return (
      <p>
        This sign-off is no longer pending{error ? ` (${error})` : ""}. <Link className="underline" href="/">Back to orders</Link>.
      </p>
    );
  }
  return (
    <>
      {error && <p className="text-red-700">Refused: {error}</p>}
      <p>
        {p.agentId} of {p.orgName} asks {p.approver.name} ({p.approver.role}) to sign off <strong>{formatEur(p.totalCents)}</strong>.
      </p>
      <ul className="list-disc pl-6">
        {p.lines.map((l) => (
          <li key={l.productId}>
            {l.quantity} x {l.name} ({l.productId}){l.substituteFor && <> as a substitute for {l.substituteFor}</>}
          </li>
        ))}
      </ul>
      <p>Why it needs you:</p>
      <ul className="list-disc pl-6">
        {p.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <form action={decide} className="space-x-4">
        <input type="hidden" name="approvalId" value={approvalId} />
        <input type="hidden" name="token" value={token} />
        <button className="border px-4 py-2" name="decision" value="approve">
          Approve
        </button>
        <button className="border px-4 py-2" name="decision" value="decline">
          Decline
        </button>
      </form>
    </>
  );
}
