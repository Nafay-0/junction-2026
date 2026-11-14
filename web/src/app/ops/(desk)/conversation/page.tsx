import type { Metadata } from "next";
import { Conversations } from "./conversations";

export const metadata: Metadata = { title: "Conversations" };

/** /ops/conversation: every kitchen's conversation with its own agent, newest first. */
export default function ConversationsPage() {
  return <Conversations />;
}
