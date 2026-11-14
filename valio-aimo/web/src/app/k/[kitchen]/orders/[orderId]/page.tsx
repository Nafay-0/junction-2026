import type { Metadata } from "next";
import { pick } from "../../../../_i18n/lang";
import { requestLang } from "../../../../_i18n/server";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../../_ui/brand";
import { OrderDetail } from "../../order-detail";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "order", fi: "tilaus", sv: "beställning" })}` };
}

export default function Order({ params }: PageProps<"/k/[kitchen]/orders/[orderId]">) {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: { params: PageProps<"/k/[kitchen]/orders/[orderId]">["params"] }) {
  const { orderId } = await params;
  return <OrderDetail orderId={orderId} />;
}
