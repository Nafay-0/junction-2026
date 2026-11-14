import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../_ui/kit";
import { streamConfigured } from "@/server/aiven/showcase/stream";
import { TraceScreen } from "./trace";

export const metadata: Metadata = { title: "Trace" };

/** /ops/trace/{requestId}: one request as a replayable path through the gate. */
export default function TracePage(props: PageProps<"/ops/trace/[requestId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/ops/trace/[requestId]">) {
  const { requestId } = await params;
  // The replay from Kafka only where Kafka is configured: elsewhere the panel would offer a button that cannot work.
  return <TraceScreen requestId={requestId} stream={streamConfigured()} />;
}
