import { Suspense } from "react";
import { JobsScreen } from "@/components/jobs/jobs-screen";

export const dynamic = "force-dynamic";

/** `/jobs`, `/jobs?job=<id>` for one job, `/jobs?job=<id>&run=<id>` for one of its runs. */
export default function JobsPage() {
  // The screen reads the address, which a page may only do inside a boundary.
  return (
    <Suspense fallback={null}>
      <JobsScreen />
    </Suspense>
  );
}
