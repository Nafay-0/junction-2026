import type { Metadata } from "next";
import { MailScreen } from "./mail";

export const metadata: Metadata = { title: "Mail" };

export default function MailPage() {
  return <MailScreen />;
}
