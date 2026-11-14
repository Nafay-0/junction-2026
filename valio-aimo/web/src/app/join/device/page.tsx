import type { Metadata } from "next";
import { Suspense } from "react";
import { PhonePage } from "../../_ui/phone-page";
import { DeviceFlow } from "./device-flow";

export const metadata: Metadata = { title: "Add a signing device" };

/**
 * Opened on a phone from the QR code an account shows under Agent and rules (Signing devices). The phone makes a
 * passkey for the kitchen's signer, the same enrolment a kitchen's approver makes, and is signed in as that signer.
 */
export default function DevicePage() {
  return (
    <PhonePage context={{ en: "Signing device", fi: "Laite", sv: "Enhet" }}>
      <Suspense fallback={<div className="skeleton h-40 !rounded-xl" />}>
        <DeviceFlow />
      </Suspense>
    </PhonePage>
  );
}
