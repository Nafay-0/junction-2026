import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../_ui/kit";
import { AuditOrder } from "../audit";

export const metadata: Metadata = { title: "Audit record" };

export default function AuditOrderPage(props: PageProps<"/ops/audit/[orderId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/ops/audit/[orderId]">) {
  const { orderId } = await params;
  return <AuditOrder orderId={orderId} />;
}
