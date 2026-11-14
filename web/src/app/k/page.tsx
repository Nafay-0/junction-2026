import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEMO_NOTES } from "../_ui/brand";
import { Wordmark } from "../_ui/wordmark";
import { moneyShort } from "../_ui/plain";
import { Plate } from "../_ui/kit";
import { LINK_GO, LINK_PRIMARY } from "./_account/links";
import { SESSION_COOKIE } from "@/server/approver-session";
import { ACCOUNT_COOKIE } from "@/server/accounts/http";
import { testAccountsShown, testResetMinutes } from "@/server/accounts/schedule";
import { TEST_ACCOUNTS } from "@/server/accounts/test-accounts";
import { joinLink } from "@/server/approval-links";
import { getRuntime } from "@/server/runtime";
import { LangProvider } from "../_i18n/provider";
import { DEFAULT_LANG, type Lang } from "../_i18n/lang";
import { chosenLang, requestLang } from "../_i18n/server";
import { EntryLangSwitch } from "./entry-lang";
import { ENTRY_TEXT } from "./entry.text";
import { DOOR_TEXT } from "./door.text";
import { SignInForm, SignOutButton, TestSignIn } from "./_account/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: DOOR_TEXT[await requestLang()].title };
}

/**
 * The door to the shop (/k): sign in, open an account, use a shared test account, or scan to try without one. No
 * kitchen is open to strangers, the stage kitchens included: they are accounts like any other.
 */
export default function KitchenEntry({ searchParams }: PageProps<"/k">) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <Suspense fallback={<p className="h-6 bg-petrol-deep" />}>
        <Entry searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Entry({ searchParams }: { searchParams: PageProps<"/k">["searchParams"] }) {
  const chosen = await chosenLang();
  const lang = chosen ?? DEFAULT_LANG;
  const tx = DOOR_TEXT[lang];
  return (
    <LangProvider initial={chosen}>
      <p className="bg-petrol-deep px-4 py-1 text-center text-[0.8rem] text-paper/85">{DEMO_NOTES[lang]}</p>
      <header className="on-dark bg-petrol-deep text-paper">
        <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <Wordmark tone="paper" size={36} />
            </p>
            <EntryLangSwitch rendered={lang} />
          </div>
          <h1 className="display mt-6 break-words text-[2.6rem] sm:text-[3.4rem]">{tx.heading}</h1>
          <p className="mt-2 max-w-[65ch] text-[1.05rem] leading-snug text-paper/90">{tx.intro}</p>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-8 sm:px-8">
        <Suspense fallback={<div className="h-64 animate-pulse bg-concrete-deep/60" />}>
          <Door lang={lang} searchParams={searchParams} />
        </Suspense>
      </main>
    </LangProvider>
  );
}

async function Door({ lang, searchParams }: { lang: Lang; searchParams: PageProps<"/k">["searchParams"] }) {
  const tx = DOOR_TEXT[lang];
  const etx = ENTRY_TEXT[lang];
  await connection();
  const [jar, rt, hdrs] = await Promise.all([cookies(), getRuntime(), headers()]);
  const signedIn = await rt.accounts.session(jar.get(ACCOUNT_COOKIE)?.value);
  const me = signedIn ? rt.accounts.view(signedIn.account) : undefined;
  const approver = await rt.passkeys.sessionApprover(jar.get(SESSION_COOKIE)?.value);
  const mine = approver ? await rt.sandboxes.forApprover(approver.approverId) : undefined;
  const join = await joinLink(hdrs);
  const shown = testAccountsShown();
  const as = (await searchParams).as; // "Sign in to this account" from a private kitchen's page
  const prefill = typeof as === "string" && /^[a-z0-9][a-z0-9_-]{2,31}$/.test(as) ? as : undefined;
  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Plate as="section" className="p-0">
          <div className="space-y-3 p-5">
            <h2 className="display text-[1.8rem]">{tx.signInTitle}</h2>
            {me ? (
              <>
                <p className="leading-snug">{tx.signedInAs(me.username, me.restaurant)}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={me.kitchen ? `/k/${me.kitchen}` : "/k/signup?step=rules"} className={LINK_GO}>
                    {me.kitchen ? tx.openShop : tx.finishSignUp}
                  </Link>
                  <SignOutButton kind="secondary" />
                </div>
              </>
            ) : (
              <SignInForm prefill={prefill} />
            )}
          </div>
        </Plate>
        <section aria-labelledby="new" className="space-y-3 bg-paper p-5">
          <h2 id="new" className="display text-[1.8rem]">
            {tx.newTitle}
          </h2>
          <p className="max-w-[60ch] leading-snug">{tx.newBody}</p>
          <Link href="/k/signup" className={LINK_PRIMARY}>
            {tx.newButton}
          </Link>
        </section>
      </div>

      {mine && (
        <Link href={`/k/${mine.sandboxId}`} className="block bg-paper p-5 hover:outline-[3px] hover:outline-petrol">
          <p className="text-ink-soft">{etx.yourKitchen}</p>
          <p className="display text-[1.6rem]">
            {mine.kitchenName}, {mine.city}
          </p>
          <p className="text-ink-soft">{etx.youAre(mine.approverName, moneyShort(mine.perOrderLimitCents))}</p>
        </Link>
      )}

      {shown && (
        <section aria-labelledby="test" className="space-y-3">
          <h2 id="test" className="display text-[1.8rem]">
            {tx.testTitle}
          </h2>
          <p className="max-w-[72ch] leading-snug text-ink-soft">{tx.testIntro(testResetMinutes() || 60)}</p>
          <ul className="grid gap-4 md:grid-cols-3">
            {TEST_ACCOUNTS.map((t) => (
              <li key={t.username} className="flex flex-col gap-2 bg-paper p-5">
                <h3 className="display text-[1.4rem]">{t.restaurant}</h3>
                <p className="flex-1 leading-snug">{tx.testAbout[t.username]}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[0.92rem]">
                  <dt className="text-ink-soft">{tx.username}</dt>
                  <dd className="break-all font-semibold">{t.username}</dd>
                  <dt className="text-ink-soft">{tx.password}</dt>
                  <dd className="break-all font-semibold">{t.password}</dd>
                </dl>
                <TestSignIn username={t.username} password={t.password} name={t.restaurant} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="scan" className="grid items-center gap-5 bg-paper p-5 sm:grid-cols-[12rem_1fr]">
        <div className="aspect-square w-full max-w-[12rem] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: join.qrSvg }} />
        <div className="space-y-2">
          <h2 id="scan" className="display text-[1.8rem]">
            {tx.scanTitle}
          </h2>
          <p className="max-w-[60ch] leading-snug">{tx.scanBody}</p>
          <Link href="/join" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
            {tx.scanOpen}
          </Link>
        </div>
      </section>

    </>
  );
}
