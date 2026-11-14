import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLang } from "../../_i18n/lang";
import { LangProvider } from "../../_i18n/provider";
import { DoorShell } from "../../k/_account/shell";
import { buttonClass, Card } from "../../_ui/kit";
import { MAIL_PAGES_TEXT } from "../mail-pages.text";

export const metadata: Metadata = { title: "AimoPilot: no more emails", robots: { index: false } };

/** /mail/stopped: where the stop link in an order email lands, after it stopped the mails (ui-api/mail/stop). */
export default function StoppedPage(props: PageProps<"/mail/stopped">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-mist" />}>
      <Loaded searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Loaded({ searchParams }: { searchParams: PageProps<"/mail/stopped">["searchParams"] }) {
  await connection();
  const q = await searchParams;
  const lang = isLang(q.lang) ? q.lang : "en";
  const tx = MAIL_PAGES_TEXT[lang];
  const ok = q.ok === "1";
  return (
    <LangProvider initial={lang}>
      <DoorShell lang={lang}>
        <h1 className="display text-[2.1rem] leading-[1.05] sm:text-[2.6rem]">{tx.stoppedTitle}</h1>
        <Card pad>
          <p role="status" className="max-w-[60ch] text-[1.02rem] leading-relaxed">
            {ok ? tx.stopped : tx.stopBad}
          </p>
          <Link href="/k" className={`${buttonClass("secondary")} mt-5`}>
            {tx.back}
          </Link>
        </Card>
      </DoorShell>
    </LangProvider>
  );
}
