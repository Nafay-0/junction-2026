import type { Metadata } from "next";
import { PhoneShell } from "../../_ui/phone";
import { AnswerScreen } from "./answer-screen";

export const metadata: Metadata = { title: "Dock: your answer" };

/** The buyer's one-time answer page: what Dock asks about their request, answered here instead of through the agent. */
export default async function AnswerPage({ params }: PageProps<"/answer/[token]">) {
  const { token } = await params;
  return (
    <PhoneShell context="Your answer">
      <AnswerScreen token={token} />
    </PhoneShell>
  );
}
