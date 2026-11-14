import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Butler } from "@/components/butler/butler";
import { SessionProvider } from "@/lib/auth/client";
import { currentUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: APP_NAME };

/**
 * A chat at its own address: /chat/<id>. It is the same app as the front door shows; the shell
 * reads the id from the address and opens that chat (components/butler/butler.tsx), and keeps the
 * address in step as the user moves between chats. This is what a notification's email links to.
 * Signed out, it leads to the sign-in page and back here.
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The same shape the server accepts for a chat's id anywhere else.
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/chat/${id}`)}`);
  return (
    <SessionProvider user={user}>
      <Butler />
    </SessionProvider>
  );
}
