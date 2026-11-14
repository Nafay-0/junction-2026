import type { Metadata } from "next";
import { Suspense } from "react";
import { Proposal } from "./proposal";

export const metadata: Metadata = { title: "Conversation proposal, AimoPilot design system" };

/**
 * A static design proposal for the buyer's conversation: three directions on scripted conversations.
 * /design/conversation?d=a|b|c&c=landing|working|milk|lunch|oat|reorder&lang=en|fi&open=1&frame=panel
 */
export default function ConversationPage() {
  return (
    <Suspense fallback={null}>
      <Proposal />
    </Suspense>
  );
}
