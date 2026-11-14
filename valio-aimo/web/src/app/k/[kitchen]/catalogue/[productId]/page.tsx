import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductPage } from "../../product";
import { requestLang } from "../../../../_i18n/server";
import { LAYOUT_TEXT } from "../../layout.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: LAYOUT_TEXT[await requestLang()].title.product };
}

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
