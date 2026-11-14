import { notFound } from "next/navigation";
import { OverviewScreen } from "@/components/admin/overview";
import { currentUser } from "@/lib/auth/server";
import { overview } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

/** The admin's overview. `?days=30` widens it from the last 14 days to the last 30. */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  // The layout has checked already; a page can be asked for on its own, so it checks too.
  const user = await currentUser();
  if (user?.role !== "admin") notFound();
  const { days } = await searchParams;
  return <OverviewScreen data={await overview(Number(Array.isArray(days) ? days[0] : days) === 30 ? 30 : 14)} />;
}
