import type { Metadata } from "next";
import { SafeguardsView } from "./safeguards";

export const metadata: Metadata = { title: "Safeguards" };

export default function SafeguardsPage() {
  return <SafeguardsView />;
}
