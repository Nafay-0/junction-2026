import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { OrdersList } from "../orders";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: orders` };

export default function Orders() {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <OrdersList />
    </Suspense>
  );
}
