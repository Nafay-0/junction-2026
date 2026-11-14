import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { KitchenWeek } from "../../../_show/kitchen-week";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: a week in this kitchen` };

/** A visitor's kitchen plays its week here; the demo kitchens point to the QR code. */
export default function WeekPage(props: PageProps<"/k/[kitchen]/week">) {
  return (
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse bg-paper/60" />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/k/[kitchen]/week">) {
  const { kitchen } = await params;
  return <KitchenWeek key={kitchen} kitchen={kitchen} visitor={kitchen.startsWith("sbx_")} />;
}
