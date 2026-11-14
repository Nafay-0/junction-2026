import { redirect } from "next/navigation";
import { ACCOUNT_COOKIE } from "@/server/accounts/http";
import { USERNAME_RE } from "@/server/accounts/names";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { CallJoin } from "../_channels/call-join";
import { LangProvider } from "../_i18n/provider";
import { pick } from "../_i18n/lang";
import { chosenLang, requestLang } from "../_i18n/server";
import { LangText } from "../_ui/phone";
import { SESSION_COOKIE } from "@/server/approver-session";
import { getRuntime } from "@/server/runtime";

export async function generateMetadata(): Promise<Metadata> {
  return { title: pick(await requestLang(), { en: "AimoPilot: call your agent", fi: "AimoPilot: soita agentillesi", sv: "AimoPilot: ring din agent" }) };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f2f7f8" };

/**
 * /call: what the "talk to your agent" QR code opens on a phone. There is one way to talk to the agent by voice: the
 * microphone in the kitchen's own conversation, hands-free. So this page only finds the kitchen and goes there
 * (`?talk=1` shows the microphone first): a visitor who has joined goes to their own kitchen; one who has not joins
 * first (one passkey tap), then lands here again and goes on. /call?k=<kitchen> is an account's kitchen (a stage
 * kitchen's too) on a phone signed in to that account.
 */
export default function Call(props: PageProps<"/call">) {
  return (
    <main className="min-h-dvh bg-mist">
      <Suspense
        fallback={
          // The cookie is request-time: until the page streams in, the browser picks the words from it.
          <LangProvider>
            <p className="p-8 text-center text-ink-soft">
              <LangText t={{ en: "Opening the call…", fi: "Puhelua avataan…", sv: "Samtalet öppnas…" }} />
            </p>
          </LangProvider>
        }
      >
        <Resolve {...props} />
      </Suspense>
    </main>
  );
}

async function Resolve(props: PageProps<"/call">) {
  return (
    <LangProvider initial={await chosenLang()}>
      <Which {...props} />
    </LangProvider>
  );
}

async function Which({ searchParams }: PageProps<"/call">) {
  await connection();
  const k = (await searchParams).k;
  const rt = await getRuntime();
  if (typeof k === "string" && USERNAME_RE.test(k)) {
    // An account's kitchen (the stage kitchens too): this phone must be signed in to that account, which the call
    // QR code does for it (a one-time link, /k/handoff). Anyone else is sent to sign in.
    const signedIn = await rt.accounts.session((await cookies()).get(ACCOUNT_COOKIE)?.value);
    if (signedIn?.account.username !== k) redirect(`/k?as=${encodeURIComponent(k)}`);
    redirect(`/k/${encodeURIComponent(k)}?talk=1`);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const account = await rt.passkeys.sessionApprover(token);
  const sandbox = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  if (!sandbox) return <CallJoin />;
  redirect(`/k/${encodeURIComponent(sandbox.sandboxId)}?talk=1`);
}
