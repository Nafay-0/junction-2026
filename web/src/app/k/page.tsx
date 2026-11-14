import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEMO_NOTES } from "../_ui/brand";
import { Wordmark } from "../_ui/wordmark";
import { moneyShort } from "../_ui/plain";
import { Glyph } from "../_ui/glyphs";
import { SESSION_COOKIE } from "@/server/approver-session";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { getRuntime } from "@/server/runtime";
import { LangProvider } from "../_i18n/provider";
import { DEFAULT_LANG, type Lang } from "../_i18n/lang";
import { chosenLang, requestLang } from "../_i18n/server";
import { EntryLangSwitch } from "./entry-lang";
import { ENTRY_TEXT } from "./entry.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: ENTRY_TEXT[await requestLang()].title };
}

/** Demo entry: open a kitchen's shop with one click. No passwords: these are demo kitchens on synthetic data. */
export default function KitchenEntry() {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <Suspense fallback={<EntryFallback />}>
        <Entry />
      </Suspense>
    </div>
  );
}

/** The words are written on the server in the buyer's language (the cookie), so the page waits for the request. */
async function Entry() {
  const chosen = await chosenLang();
  const lang = chosen ?? DEFAULT_LANG;
  const tx = ENTRY_TEXT[lang];
  return (
    <LangProvider initial={chosen}>
      <p className="bg-petrol-deep px-4 py-1 text-center text-[0.8rem] text-paper/85">{DEMO_NOTES[lang]}</p>
      <header className="on-dark relative overflow-hidden bg-petrol text-paper">
        <Glyph kind="case" size={320} strokeWidth={0.9} className="pointer-events-none absolute -right-10 -top-16 text-paper/10" />
        <div className="relative mx-auto max-w-[1100px] px-4 pb-12 pt-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <Wordmark tone="paper" size={36} />
            </p>
            <EntryLangSwitch rendered={lang} />
          </div>
          <h1 className="display mt-10 break-words text-[3rem] sm:text-[4.2rem]">{tx.heading}</h1>
          <p className="mt-3 max-w-[60ch] text-[1.15rem] leading-snug text-paper/90">{tx.intro}</p>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pb-14 sm:px-8">
        <Suspense fallback={<div className="mt-8 h-64 animate-pulse bg-concrete-deep/60" />}>
          <Kitchens lang={lang} />
        </Suspense>
      </main>
    </LangProvider>
  );
}

function EntryFallback() {
  return (
    <>
      <p className="h-6 bg-petrol-deep" />
      <div className="h-[22rem] bg-petrol" />
    </>
  );
}

async function Kitchens({ lang }: { lang: Lang }) {
  const tx = ENTRY_TEXT[lang];
  await connection();
  const [all, jar, rt] = await Promise.all([listConsoleKitchens(), cookies(), getRuntime()]);
  const account = await rt.passkeys.sessionApprover(jar.get(SESSION_COOKIE)?.value);
  const mine = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  const demos = all.filter((k) => k.kind === "demo");
  const visitors = all.filter((k) => k.kind === "visitor" && k.slug !== mine?.sandboxId);
  const info = await Promise.all(demos.map((k) => resolveKitchen(k.slug)));
  return (
    <>
      {mine && (
        <Link href={`/k/${mine.sandboxId}`} className="mt-8 block bg-paper hover:outline-[3px] hover:outline-petrol">
          <div aria-hidden className="h-2 bg-lime" />
          <div className="flex flex-wrap items-center gap-4 p-5">
            <Glyph kind="carton" size={48} className="text-petrol" />
            <div className="min-w-0 flex-1">
              <p className="text-ink-soft">{tx.yourKitchen}</p>
              <p className="display text-[1.9rem]">
                {mine.kitchenName}, {mine.city}
              </p>
              <p className="text-ink-soft">{tx.youAre(mine.approverName, moneyShort(mine.perOrderLimitCents))}</p>
            </div>
            <span className="bg-lime px-4 py-3 font-semibold text-ink">{tx.openMine}</span>
          </div>
        </Link>
      )}
      <ul className="-mt-6 grid gap-4 md:grid-cols-2">
        {demos.map((k, i) => {
          const m = info[i]?.info.mandate;
          return (
            <li key={k.slug}>
              <Link href={`/k/${k.slug}`} className="flex h-full flex-col bg-paper hover:outline-[3px] hover:outline-petrol">
                <div aria-hidden className="h-1.5 bg-petrol-deep" />
                <div className="flex flex-1 flex-col p-6">
                  <p className="display text-[2.2rem]">{k.name}</p>
                  <p className="mt-1 leading-snug">{tx.about[k.slug] ?? tx.aDemoKitchen}</p>
                  {m && (
                    <p className="mt-3 text-[0.95rem] text-ink-soft">
                      {tx.agentAlone(moneyShort(m.perOrderLimitCents), m.approvers[0]?.name)}
                    </p>
                  )}
                  <span className="mt-4 self-start bg-petrol px-4 py-2.5 font-semibold text-paper">{tx.enter}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {visitors.length > 0 && (
        <section className="mt-10">
          <h2 className="display text-[1.5rem]">{tx.visitors}</h2>
          <p className="text-ink-soft">{tx.visitorsNote}</p>
          <ul className="mt-2 divide-y divide-line bg-paper">
            {visitors.map((k) => (
              <li key={k.slug}>
                <Link href={`/k/${k.slug}`} className="flex min-h-12 items-center justify-between px-4 py-2 hover:bg-concrete/50">
                  <span className="font-semibold">{k.name}</span>
                  <span className="text-ink-soft">{tx.signsOff(k.approverName)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-10 text-[0.95rem] text-ink-soft">
        {tx.joinedA}
        <Link href="/k/mine" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
          {tx.joinedLink}
        </Link>
        {tx.joinedB}
      </p>
    </>
  );
}
