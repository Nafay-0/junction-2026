import type { Metadata } from "next";
import { LiveView } from "./live";

export const metadata: Metadata = { title: "Live" };

/** /ops: the agents at the door now, through which door, and every request as a session. */
export default function OpsLive() {
  return <LiveView />;
}
