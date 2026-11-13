import type { Metadata } from "next";
import { Observe } from "./observe";

export const metadata: Metadata = { title: "Observe" };

export default function ObservePage() {
  return <Observe />;
}
