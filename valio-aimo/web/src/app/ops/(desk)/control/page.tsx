import type { Metadata } from "next";
import { ControlScreen } from "./control";

export const metadata: Metadata = { title: "Control" };

export default function ControlPage() {
  return <ControlScreen />;
}
