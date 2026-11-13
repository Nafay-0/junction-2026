import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../../_ui/brand";
import { ProductPage } from "../../product";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: product` };

export default function Product({ params }: PageProps<"/k/[kitchen]/catalogue/[productId]">) {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: { params: PageProps<"/k/[kitchen]/catalogue/[productId]">["params"] }) {
  const { productId } = await params;
  return <ProductPage id={decodeURIComponent(productId)} />;
}
