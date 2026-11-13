import type { Metadata } from "next";
import { PhoneShell } from "../_ui/phone";
import { JoinFlow } from "./join-flow";

export const metadata: Metadata = { title: "Join Dock as an approver" };

/** Opened by scanning the QR code on the big screen. Makes this phone the approver of a fresh demo kitchen. */
export default function JoinPage() {
  return (
    <PhoneShell context="Join the demo">
      <JoinFlow />
    </PhoneShell>
  );
}
