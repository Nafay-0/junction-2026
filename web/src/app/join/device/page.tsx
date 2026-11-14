import type { Metadata } from "next";
import { Suspense } from "react";
import { LangProvider } from "../../_i18n/provider";
import { chosenLang } from "../../_i18n/server";
import { DeviceFlow } from "./device-flow";

export const metadata: Metadata = { title: "Add a signing device" };

/**
 * Opened on a phone from the QR code an account shows under Agent and rules (Signing devices). The phone makes a
 * passkey for the kitchen's signer, the same enrolment a kitchen's approver makes, and is signed in as that signer.
 */
export default function DevicePage() {
  return (
    <Suspense fallback={<p className="p-5">…</p>}>
      <Loaded />
    </Suspense>
  );
}

async function Loaded() {
  return (
    <LangProvider initial={await chosenLang()}>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8 text-lg">
        <DeviceFlow />
      </main>
    </LangProvider>
  );
}
