import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { Catalogue } from "../catalogue";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: catalogue` };

export default function CataloguePage() {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Catalogue />
    </Suspense>
  );
}
