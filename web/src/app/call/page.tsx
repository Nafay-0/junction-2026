import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { CallJoin } from "../_channels/call-join";
import { CallPage } from "../_channels/call-page";
import { SESSION_COOKIE } from "@/server/approver-session";
import { getRuntime } from "@/server/runtime";

export const metadata: Metadata = { title: "Dock: call your agent" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#e4e6e4" };

/**
 * /call: what the call QR code opens on a phone. A visitor who has joined calls their own kitchen's agent;
 * one who has not joins first (one passkey tap), then lands here again in the call.
 * /call?k=kaari or ?k=laakso calls a demo kitchen (the console preview), under the same caps.
 */
export default function Call(props: PageProps<"/call">) {
  return (
    <main className="min-h-dvh bg-concrete">
      <Suspense fallback={<p className="p-8 text-center text-ink-soft">Opening the call…</p>}>
        <Resolve {...props} />
      </Suspense>
    </main>
  );
}

async function Resolve({ searchParams }: PageProps<"/call">) {
  await connection();
  const k = (await searchParams).k;
  if (k === "kaari" || k === "laakso") return <CallPage kitchen={k} visitor={false} />;
  const rt = await getRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const account = await rt.passkeys.sessionApprover(token);
  const sandbox = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  if (!sandbox) return <CallJoin />;
  return <CallPage kitchen={sandbox.sandboxId} visitor />;
}
