import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { peekConfirm } from "@/server/notify/service";
import { getRuntime } from "@/server/runtime";
import { LangProvider } from "../../_i18n/provider";
import { DEFAULT_LANG } from "../../_i18n/lang";
import { placeNameL } from "../../_i18n/kitchen-words";
import { chosenLang } from "../../_i18n/server";
import { DoorShell } from "../../k/_account/shell";
import { Card, ErrorPlate } from "../../_ui/kit";
import { MAIL_PAGES_TEXT } from "../mail-pages.text";
import { ConfirmButton } from "./confirm-button";

export const metadata: Metadata = { title: "AimoPilot: confirm your address", robots: { index: false } };

/**
 * /mail/confirm?t=…: where the confirmation email's link lands. It shows what the link is for and confirms only when
 * the person presses the button (a mail scanner that opens links confirms nothing). The address is shown masked.
 */
export default function ConfirmPage(props: PageProps<"/mail/confirm">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-mist" />}>
      <Loaded searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Loaded({ searchParams }: { searchParams: PageProps<"/mail/confirm">["searchParams"] }) {
  await connection();
  const t = (await searchParams).t;
  const token = typeof t === "string" ? t : undefined;
  const [rt, chosen] = await Promise.all([getRuntime(), chosenLang()]);
  const peek = await peekConfirm(rt, token);
  const lang = peek.ok ? peek.lang : (chosen ?? DEFAULT_LANG);
  const tx = MAIL_PAGES_TEXT[lang];
  return (
    <LangProvider initial={lang}>
      <DoorShell lang={lang}>
        <h1 className="display text-[2.1rem] leading-[1.05] sm:text-[2.6rem]">{tx.confirmTitle}</h1>
        {peek.ok ? (
          <Card pad>
            <p className="max-w-[60ch] text-[1.02rem] leading-relaxed">{tx.confirmBody(placeNameL(peek.kitchenName, lang), peek.masked)}</p>
            <div className="mt-5">{peek.confirmed ? <p role="status">{tx.already(peek.masked)}</p> : <ConfirmButton token={token!} masked={peek.masked} />}</div>
          </Card>
        ) : (
          <ErrorPlate title={tx.badTitle} message={tx.bad} />
        )}
      </DoorShell>
    </LangProvider>
  );
}
