import type { Metadata } from "next";
import { pick } from "../_i18n/lang";
import { requestLang } from "../_i18n/server";
import { PhonePage } from "../_ui/phone-page";
import { ApproverHome } from "./approver-home";

export async function generateMetadata(): Promise<Metadata> {
  return { title: pick(await requestLang(), { en: "AimoPilot: your approvals", fi: "AimoPilot: hyväksyntäsi", sv: "AimoPilot: dina godkännanden" }) };
}

/** The approver's home screen on their phone: who they are, and it waits for sign-off requests. */
export default function ApproverPage() {
  return (
    <PhonePage context={{ en: "Your sign-offs", fi: "Hyväksyntäsi", sv: "Dina godkännanden" }}>
      <ApproverHome />
    </PhonePage>
  );
}
