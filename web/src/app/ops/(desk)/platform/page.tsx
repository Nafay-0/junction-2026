import type { Metadata } from "next";
import { Story } from "./story";

export const metadata: Metadata = { title: "Platform" };

export default function PlatformPage() {
  return <Story />;
}
