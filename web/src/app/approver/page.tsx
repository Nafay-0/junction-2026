import type { Metadata } from "next";
import { PhoneShell } from "../_ui/phone";
import { ApproverHome } from "./approver-home";

export const metadata: Metadata = { title: "AimoPilot: your approvals" };

/** The approver's home screen on their phone: who they are, and it waits for sign-off requests. */
export default function ApproverPage() {
  return (
    <PhoneShell context="Your sign-offs">
      <ApproverHome />
    </PhoneShell>
  );
}
