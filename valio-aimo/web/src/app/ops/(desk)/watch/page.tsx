import type { Metadata } from "next";
import { WatchScreen } from "./watch";

export const metadata: Metadata = { title: "Kitchen watch" };

export default function WatchPage() {
  return <WatchScreen />;
}
