import type { Metadata } from "next";
import { AuditIndex } from "./audit";

export const metadata: Metadata = { title: "Audit" };

export default function AuditPage() {
  return <AuditIndex />;
}
