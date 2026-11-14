import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../_ui/kit";
import { ConversationScreen } from "../conversations";

export const metadata: Metadata = { title: "Conversation" };

/** /ops/conversation/{threadId}: one conversation, turn by turn, every model call, tool call and gate decision. */
export default function ConversationPage(props: PageProps<"/ops/conversation/[threadId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/ops/conversation/[threadId]">) {
  const { threadId } = await params;
  return <ConversationScreen threadId={threadId} />;
}
