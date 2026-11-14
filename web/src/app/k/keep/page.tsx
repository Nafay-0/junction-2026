import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { QrCode } from "lucide-react";
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
        <div>
          <h1 className="display text-[2.1rem] leading-[1.05] sm:text-[2.6rem]">{tx.keepTitle}</h1>
          {mine && <p className="mt-2.5 max-w-[60ch] text-[1.02rem] leading-relaxed text-ink-soft">{tx.keepBody(`${mine.kitchenName}, ${mine.city}`)}</p>}
        </div>
        {mine ? (
          <section className="rounded-xl border border-line bg-paper p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
              <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-petrol-soft text-[0.95rem] font-semibold text-petrol-deep">
                {mine.kitchenName.slice(0, 1).toUpperCase()}
              </span>
              <p className="min-w-0 font-semibold leading-snug">
                {mine.kitchenName}
                <span className="block text-[0.88rem] font-normal text-ink-soft">{mine.city}</span>
              </p>
            </div>
            <KeepForm />
          </section>
        ) : (
          <div className="flex items-start gap-4 rounded-xl border border-dashed border-line-strong bg-paper/60 p-5 sm:p-6">
            <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink-soft">
              <QrCode size={21} />
            </span>
            <p className="max-w-[60ch] pt-2 leading-relaxed">{tx.keepNone}</p>
          </div>
        )}
      </DoorShell>
    </LangProvider>
  );
}
