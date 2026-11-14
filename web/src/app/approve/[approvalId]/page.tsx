import type { Metadata } from "next";
import { Suspense } from "react";
import { pick } from "../../_i18n/lang";
import { requestLang } from "../../_i18n/server";
import { LangText } from "../../_ui/phone";
import { PhonePage } from "../../_ui/phone-page";
import { ApprovalScreen } from "./approval-screen";
import { APPROVAL_TEXT } from "./approval-screen.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: pick(await requestLang(), { en: "AimoPilot: sign-off", fi: "AimoPilot: hyväksyntä", sv: "AimoPilot: godkännande" }) };
}

const context = { en: APPROVAL_TEXT.en.context, fi: APPROVAL_TEXT.fi.context, sv: APPROVAL_TEXT.sv.context };
const opening = { en: APPROVAL_TEXT.en.opening, fi: APPROVAL_TEXT.fi.opening, sv: APPROVAL_TEXT.sv.opening };

/**
 * The sign-off screen behind an approval link or QR code. Approvers with a passkey approve with it (the challenge
 * is bound to this exact order); the legacy demo org still uses the one-time `?token=` from its approval link.
 */
export default function ApprovePage(props: PageProps<"/approve/[approvalId]">) {
  return (
    <PhonePage tone="gate" context={context}>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4" role="status">
            <div className="hazard-frame h-60 opacity-90" />
            <div className="skeleton mt-2 h-32 !rounded-xl" />
            <span className="sr-only">
              <LangText t={opening} />
            </span>
          </div>
        }
      >
        <Approval {...props} />
      </Suspense>
    </PhonePage>
  );
}

async function Approval({ params, searchParams }: PageProps<"/approve/[approvalId]">) {
  const { approvalId } = await params;
  const sp = await searchParams;
  return <ApprovalScreen approvalId={approvalId} token={typeof sp.token === "string" ? sp.token : undefined} />;
}
