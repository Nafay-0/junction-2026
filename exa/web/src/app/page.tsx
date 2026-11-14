import { redirect } from "next/navigation";
import { Butler } from "@/components/butler/butler";
import { SessionProvider } from "@/lib/auth/client";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** The app itself: only for a signed-in account, which every part of the interface can then read. */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <SessionProvider user={user}>
      <Butler />
    </SessionProvider>
  );
}
