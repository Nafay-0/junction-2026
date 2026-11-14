import { redirect } from "next/navigation";

/**
 * The Order page is gone: ordering is the agent's (docs/agent-thread.md "The home"). An old link or bookmark opens the
 * kitchen's store with the agent open on its thread.
 */
export default async function OrderPage({ params }: { params: Promise<{ kitchen: string }> }) {
  const { kitchen } = await params;
  redirect(`/k/${encodeURIComponent(kitchen)}?agent=open`);
}
