import type { Metadata } from "next";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { OrdersList } from "../orders";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "orders", fi: "tilaukset", sv: "beställningar" })}` };
}

export default function Orders() {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <OrdersList />
    </Suspense>
  );
}
