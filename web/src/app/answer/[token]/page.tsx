import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneShell } from "../../_ui/phone";
import { AnswerScreen } from "./answer-screen";

export const metadata: Metadata = { title: "Dock: your answer" };

/** The buyer's one-time answer page: what Dock asks about their request, answered here instead of through the agent. */
export default function AnswerPage(props: PageProps<"/answer/[token]">) {
  return (
    <PhoneShell context="Your answer" langs={false}>
      <Suspense fallback={<div className="skeleton h-40 !rounded-xl" />}>
        <Answer {...props} />
      </Suspense>
    </PhoneShell>
  );
}

async function Answer({ params }: PageProps<"/answer/[token]">) {
  const { token } = await params;
  return <AnswerScreen token={token} />;
}
