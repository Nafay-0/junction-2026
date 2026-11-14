import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEMO_NOTES } from "../_ui/brand";
import { Wordmark } from "../_ui/wordmark";
import { moneyShort } from "../_ui/plain";
import { ArrowRight, BedDouble, ChevronRight, Coffee, QrCode, School, Store, UserRoundPlus } from "lucide-react";
import { Art } from "../_ui/art";
import { Avatar, IconDisc } from "../_ui/kit";
import { LINK_GO, LINK_SECONDARY } from "./_account/links";
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
import { PORTAL_TEXT } from "./[kitchen]/portal.text";
import { DOOR_TEXT } from "./door.text";
import { SignInForm, SignOutButton, TestSignIn } from "./_account/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: DOOR_TEXT[await requestLang()].title };
}

/**
 * The door to the shop (/k): sign in, open an account, use a shared test account, or scan to try without one. No
 * kitchen is open to strangers, the stage kitchens included: they are accounts like any other. The first page a
 * visitor sees after the wall: a petrol hero with the generated still life, the sign-in card lifted over its edge.
 */
export default function KitchenEntry({ searchParams }: PageProps<"/k">) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <Suspense fallback={<div className="h-[26rem] bg-petrol-deep" />}>
        <Entry searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** A small mark per test kitchen, by what it is (decoration only; the name says it). */
const TEST_ICON: Record<string, typeof Store> = { "hotel-lumo": BedDouble, "koulu-metsola": School, "kahvila-sointu": Coffee };

async function Entry({ searchParams }: { searchParams: PageProps<"/k">["searchParams"] }) {
  const chosen = await chosenLang();
  const lang = chosen ?? DEFAULT_LANG;
  const tx = DOOR_TEXT[lang];
  return (
    <LangProvider initial={chosen}>
      <p className="on-dark relative z-10 bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">
        <span className="sm:hidden">{PORTAL_TEXT[lang].demoShort}</span>
        <span className="hidden sm:inline">{DEMO_NOTES[lang]}</span>
      </p>
      <header className="on-dark relative overflow-hidden bg-petrol-deep text-paper">
        {/* The generated still life (DESIGN.md §6, `hero`): a band behind the top on a phone, the right side on a desk. */}
        <div className="absolute inset-x-0 top-0 h-60 sm:h-80 lg:inset-y-0 lg:left-auto lg:h-auto lg:w-[60%]">
          <Art k="hero" cover priority sizes="(min-width: 1024px) 60vw, 100vw" position="72% 62%" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-petrol-deep from-5% via-petrol-deep/30 to-transparent lg:bg-gradient-to-r lg:from-petrol-deep lg:from-0% lg:via-petrol-deep/45 lg:via-35% lg:to-transparent" />
        </div>
        <div className="relative mx-auto max-w-[1180px] px-4 sm:px-8">
          <div className="flex items-center justify-between gap-3 py-3.5 sm:py-5">
            <Wordmark tone="paper" size={30} />
            <span className="rounded-full bg-petrol-deep/70 backdrop-blur-md">
              <EntryLangSwitch rendered={lang} />
            </span>
          </div>
          <div className="max-w-[36rem] pb-20 pt-28 sm:pt-48 lg:pb-40 lg:pt-16">
            <h1 className="display break-words text-[2.6rem] leading-[0.98] hyphens-manual sm:text-[3.7rem] lg:text-[4.3rem]">{tx.heading}</h1>
            <p className="mt-4 max-w-[54ch] text-[1.02rem] leading-relaxed text-paper/85 sm:text-[1.08rem]">{tx.intro}</p>
          </div>
        </div>
      </header>
      <main className="relative mx-auto -mt-12 max-w-[1180px] space-y-14 px-4 pb-16 sm:px-8 lg:-mt-28 lg:space-y-16">
        <Suspense fallback={<div className="skeleton h-80 max-w-[34rem] !rounded-[28px]" />}>
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
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:gap-10">
        <section aria-labelledby="signin" className="rounded-2xl bg-paper p-5 shadow-lg sm:p-8">
          <h2 id="signin" className="display text-[1.75rem] leading-tight">
            {tx.signInTitle}
          </h2>
          {me ? (
            <div className="mt-4 space-y-5">
              <p className="flex items-center gap-3 leading-snug">
                <Avatar name={me.restaurant} size={44} />
                <span className="min-w-0">{tx.signedInAs(me.username, me.restaurant)}</span>
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Link href={me.kitchen ? `/k/${me.kitchen}` : "/k/signup?step=rules"} className={`${LINK_GO} min-h-13 text-[1.05rem]`}>
                  {me.kitchen ? tx.openShop : tx.finishSignUp}
                  <ArrowRight aria-hidden size={18} />
                </Link>
                <SignOutButton kind="secondary" />
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <SignInForm prefill={prefill} />
            </div>
          )}
        </section>
        <section aria-labelledby="new" className="flex items-start gap-4 rounded-xl border border-line bg-paper/70 p-5 sm:p-6 lg:mt-36">
          <IconDisc>
            <UserRoundPlus size={21} />
          </IconDisc>
          <div className="min-w-0">
            <h2 id="new" className="display text-[1.35rem] leading-tight">
              {tx.newTitle}
            </h2>
            <p className="mt-1.5 max-w-[56ch] leading-relaxed text-ink-soft">{tx.newBody}</p>
            <Link href="/k/signup" className={`${LINK_SECONDARY} mt-4`}>
              {tx.newButton}
            </Link>
          </div>
        </section>
      </div>

      {mine && (
        <Link href={`/k/${mine.sandboxId}`} className="lift flex items-center gap-4 rounded-xl border border-line bg-paper p-5">
          <Avatar name={mine.kitchenName} size={48} />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9rem] text-ink-soft">{etx.yourKitchen}</span>
            <span className="display mt-0.5 block text-[1.4rem] leading-tight">
              {mine.kitchenName}, {mine.city}
            </span>
            <span className="mt-1 block text-[0.92rem] leading-snug text-ink-soft">{etx.youAre(mine.approverName, moneyShort(mine.perOrderLimitCents))}</span>
          </span>
          <ChevronRight aria-hidden size={22} className="shrink-0 text-petrol" />
        </Link>
      )}

      {shown && (
        <section aria-labelledby="test">
          <h2 id="test" className="display text-[1.6rem] leading-tight sm:text-[1.8rem]">
            {tx.testTitle}
          </h2>
          <p className="mt-2 max-w-[68ch] leading-relaxed text-ink-soft">{tx.testIntro(testResetMinutes() || 60)}</p>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {TEST_ACCOUNTS.map((t) => {
              const Icon = TEST_ICON[t.username] ?? Store;
              return (
                <li key={t.username} className="flex flex-col rounded-xl border border-line bg-paper p-5">
                  <div className="flex items-center gap-3">
                    <IconDisc size={40}>
                      <Icon size={19} />
                    </IconDisc>
                    <h3 className="display min-w-0 text-[1.25rem] leading-tight">{t.restaurant}</h3>
                  </div>
                  <p className="mt-3 flex-1 text-[0.95rem] leading-relaxed text-ink-soft">{tx.testAbout[t.username]}</p>
                  <dl className="mt-4 divide-y divide-line rounded-lg bg-surface px-3.5 text-[0.9rem]">
                    <div className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="shrink-0 text-ink-soft">{tx.username}</dt>
                      <dd className="min-w-0 select-all break-all text-right font-semibold">{t.username}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="shrink-0 text-ink-soft">{tx.password}</dt>
                      <dd className="min-w-0 select-all break-all text-right font-semibold">{t.password}</dd>
                    </div>
                  </dl>
                  <div className="mt-4">
                    <TestSignIn username={t.username} password={t.password} name={t.restaurant} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="scan" className="grid items-center gap-6 rounded-2xl bg-surface p-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:p-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="hidden aspect-square w-full rounded-lg bg-paper p-2.5 shadow-xs sm:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: join.qrSvg }} />
        <div className="min-w-0">
          <IconDisc className="mb-3 sm:hidden">
            <QrCode size={21} />
          </IconDisc>
          <h2 id="scan" className="display text-[1.6rem] leading-tight sm:text-[1.8rem]">
            {tx.scanTitle}
          </h2>
          <p className="mt-2 max-w-[56ch] leading-relaxed text-ink-soft">{tx.scanBody}</p>
          <Link href="/join" className={`${LINK_SECONDARY} mt-4`}>
            {tx.scanOpen}
          </Link>
          <p className="mt-4">
            <Link href="/try" className="inline-flex items-center gap-1.5 font-semibold text-petrol underline underline-offset-2">
              {tx.tryOutside}
              <ArrowRight aria-hidden size={16} />
            </Link>
          </p>
        </div>
      </section>

    </>
  );
}
