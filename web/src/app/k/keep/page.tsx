import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { SESSION_COOKIE } from "@/server/approver-session";
import { getRuntime } from "@/server/runtime";
import { LangProvider } from "../../_i18n/provider";
import { DEFAULT_LANG } from "../../_i18n/lang";
import { chosenLang, requestLang } from "../../_i18n/server";
import { DOOR_TEXT } from "../door.text";
import { DoorShell } from "../_account/shell";
import { KeepForm } from "./keep-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: DOOR_TEXT[await requestLang()].keepTitle };
}

/** /k/keep: a visitor from the QR code keeps their kitchen as an account, before its 90 minutes end. */
export default function Keep() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-mist" />}>
      <Loaded />
    </Suspense>
  );
}

async function Loaded() {
  await connection();
  const [jar, rt, chosen] = await Promise.all([cookies(), getRuntime(), chosenLang()]);
  const lang = chosen ?? DEFAULT_LANG;
  const tx = DOOR_TEXT[lang];
  const approver = await rt.passkeys.sessionApprover(jar.get(SESSION_COOKIE)?.value);
  const mine = approver ? await rt.sandboxes.forApprover(approver.approverId) : undefined;
  return (
    <LangProvider initial={chosen}>
      <DoorShell lang={lang}>
        <h1 className="display text-[2.4rem]">{tx.keepTitle}</h1>
        {mine ? (
          <section className="space-y-4 bg-paper p-5">
            <p className="max-w-[65ch] leading-snug">{tx.keepBody(`${mine.kitchenName}, ${mine.city}`)}</p>
            <KeepForm />
          </section>
        ) : (
          <p className="bg-paper p-5">{tx.keepNone}</p>
        )}
      </DoorShell>
    </LangProvider>
  );
}
