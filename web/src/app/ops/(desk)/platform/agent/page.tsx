import type { Metadata } from "next";
import { Launcher } from "./launcher";

export const metadata: Metadata = { title: "Send in an Aiven agent" };

export default function AgentPage() {
  return <Launcher />;
}
