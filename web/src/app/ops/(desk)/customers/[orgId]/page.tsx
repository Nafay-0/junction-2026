import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../_ui/kit";
import { CustomersScreen } from "../customers";

export const metadata: Metadata = { title: "Customer" };

export default function CustomerPage(props: PageProps<"/ops/customers/[orgId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params }: PageProps<"/ops/customers/[orgId]">) {
  const { orgId } = await params;
  return <CustomersScreen orgId={orgId} />;
}
