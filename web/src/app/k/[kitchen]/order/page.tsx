import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { Console } from "../console";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: order` };

/** Order: the agent's staged work on one request, with the kitchen's earlier requests beside it. */
export default function OrderPage() {
  return <Console />;
}
