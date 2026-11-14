import type { Metadata } from "next";
import { Suspense } from "react";
import { Catalogue } from "../catalogue";
import { requestLang } from "../../../_i18n/server";
import { LAYOUT_TEXT } from "../layout.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: LAYOUT_TEXT[await requestLang()].title.catalogue };
}

export default function CataloguePage() {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Catalogue />
    </Suspense>
  );
}
