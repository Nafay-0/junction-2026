import type { Metadata } from "next";
import { pick } from "../_i18n/lang";
import { requestLang } from "../_i18n/server";
import { PhonePage } from "../_ui/phone-page";
import { JoinFlow } from "./join-flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: pick(await requestLang(), { en: "Join AimoPilot as an approver", fi: "Liity AimoPilotiin hyväksyjäksi", sv: "Gå med i AimoPilot som godkännare" }) };
}

/** Opened by scanning the QR code on the big screen. Makes this phone the approver of a fresh demo kitchen. */
export default function JoinPage() {
  return (
    <PhonePage context={{ en: "Join the demo", fi: "Liity demoon", sv: "Gå med i demon" }}>
      <JoinFlow />
    </PhonePage>
  );
}
