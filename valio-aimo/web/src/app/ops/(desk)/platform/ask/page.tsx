import type { Metadata } from "next";
import { Copilot } from "./copilot";

export const metadata: Metadata = { title: "Ask the platform" };

export default function AskPage() {
  return <Copilot />;
}
