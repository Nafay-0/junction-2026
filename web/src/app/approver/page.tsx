import type { Metadata } from "next";
import { ApproverHome } from "./approver-home";

export const metadata: Metadata = { title: "Dock: your approvals" };

/** The approver's home screen on their phone: who they are, and it waits for sign-off requests. */
export default function ApproverPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8 text-lg">
      <ApproverHome />
    </main>
  );
}
