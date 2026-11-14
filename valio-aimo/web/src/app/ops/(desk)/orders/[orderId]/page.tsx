import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../_ui/kit";
import { OrderScreen } from "./order";

export const metadata: Metadata = { title: "Order" };

/** /ops/orders/<id>: one order's whole timeline. */
export default function OrderPage(props: PageProps<"/ops/orders/[orderId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/ops/orders/[orderId]">) {
  const { orderId } = await params;
  return <OrderScreen orderId={orderId} />;
}
