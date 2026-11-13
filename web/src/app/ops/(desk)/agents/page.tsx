import type { Metadata } from "next";
import { AgentsScreen } from "./agents";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsScreen />;
}
