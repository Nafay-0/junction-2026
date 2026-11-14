import type { Metadata } from "next";
import { RadarScreen } from "./radar";

export const metadata: Metadata = { title: "Recall radar" };

export default function RadarPage() {
  return <RadarScreen />;
}
