import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../_ui/kit";
import { OrdersScreen } from "./orders";

export const metadata: Metadata = { title: "Orders" };

/** /ops/orders: every order from every source, newest first, with how it was decided and where it stands. */
export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrdersScreen />
    </Suspense>
  );
}
