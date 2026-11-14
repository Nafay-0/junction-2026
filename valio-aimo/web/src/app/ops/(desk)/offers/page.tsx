import type { Metadata } from "next";
import { OffersScreen } from "./offers";

export const metadata: Metadata = { title: "Selling agent" };

export default function OffersPage() {
  return <OffersScreen />;
}
