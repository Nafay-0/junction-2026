import type { Metadata } from "next";
import { JoinFlow } from "./join-flow";

export const metadata: Metadata = { title: "Join Dock as an approver" };

/** Opened by scanning the QR code on the big screen. Makes this phone the approver of a fresh demo kitchen. */
export default function JoinPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8 text-lg">
      <JoinFlow />
    </main>
  );
}
