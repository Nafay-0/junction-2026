import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { CallJoin } from "../_channels/call-join";
import { CallPage } from "../_channels/call-page";
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
 * /call: what the call QR code opens on a phone. A visitor who has joined calls their own kitchen's agent;
 * one who has not joins first (one passkey tap), then lands here again in the call.
 * /call?k=kaari or ?k=laakso calls a demo kitchen (the console preview), under the same caps.
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
  if (k === "kaari" || k === "laakso") return <CallPage kitchen={k} visitor={false} />;
  const rt = await getRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const account = await rt.passkeys.sessionApprover(token);
  const sandbox = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  if (!sandbox) return <CallJoin />;
  return <CallPage kitchen={sandbox.sandboxId} visitor />;
}
