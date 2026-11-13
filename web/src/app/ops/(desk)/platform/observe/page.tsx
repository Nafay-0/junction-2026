import type { Metadata } from "next";
import { Observe } from "./observe";

export const metadata: Metadata = { title: "Observe" };

export default function ObservePage() {
  const project = process.env.AIVEN_PROJECT?.trim();
  return <Observe grafanaUrl={project ? `https://dock-grafana-${project}.e.aivencloud.com/d/dock-overview` : undefined} />;
}
