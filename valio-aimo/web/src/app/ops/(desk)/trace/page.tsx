import type { Metadata } from "next";
import { Latest } from "./latest";

export const metadata: Metadata = { title: "Trace" };

/** /ops/trace: opens the most recent request. */
export default function TraceIndex() {
  return <Latest />;
}
