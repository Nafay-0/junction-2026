import type { Metadata } from "next";
import { CustomersScreen } from "./customers";

export const metadata: Metadata = { title: "Customers" };

/** /ops/customers: what the wholesaler knows about each kitchen (shared memory only). Opens the first kitchen. */
export default function CustomersPage() {
  return <CustomersScreen />;
}
