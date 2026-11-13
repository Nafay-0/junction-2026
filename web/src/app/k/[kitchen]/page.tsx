import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../_ui/brand";
import { Home } from "./home";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: kitchen home` };

/** Home: what needs the buyer now, what the agent did this week, and the standing orders. */
export default function KitchenHome() {
  return <Home />;
}
