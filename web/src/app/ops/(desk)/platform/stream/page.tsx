import type { Metadata } from "next";
import { StreamView } from "./stream";

export const metadata: Metadata = { title: "The stream" };

export default function StreamPage() {
  return <StreamView />;
}
