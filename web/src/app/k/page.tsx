import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEMO_NOTE, PRODUCT_NAME } from "../_ui/brand";
import { Wordmark } from "../_ui/wordmark";
import { moneyShort } from "../_ui/plain";
import { Glyph } from "../_ui/glyphs";
import { SESSION_COOKIE } from "@/server/approver-session";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { getRuntime } from "@/server/runtime";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: enter a kitchen's shop` };

/** Demo entry: open a kitchen's shop with one click. No passwords: these are demo kitchens on synthetic data. */
export default function KitchenEntry() {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="bg-petrol-deep px-4 py-1 text-center text-[0.8rem] text-paper/85">{DEMO_NOTE}</p>
      <header className="on-dark relative overflow-hidden bg-petrol text-paper">
        <Glyph kind="case" size={320} strokeWidth={0.9} className="pointer-events-none absolute -right-10 -top-16 text-paper/10" />
        <div className="relative mx-auto max-w-[1100px] px-4 pb-12 pt-6 sm:px-8">
          <p>
            <Wordmark tone="paper" size={36} />
          </p>
          <h1 className="display mt-10 text-[3rem] sm:text-[4.2rem]">Enter a kitchen&apos;s shop</h1>
          <p className="mt-3 max-w-[60ch] text-[1.15rem] leading-snug text-paper/90">A wholesale shop for professional kitchens, with each kitchen&apos;s own purchasing agent working inside it: its own signed rules, its own memory, and a person who signs off when an order goes beyond them. Pick one; no password, it is a demo.</p>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pb-14 sm:px-8">
        <Suspense fallback={<div className="mt-8 h-64 animate-pulse bg-concrete-deep/60" />}>
          <Kitchens />
        </Suspense>
      </main>
    </div>
  );
}

const ABOUT: Record<string, string> = {
  kaari: "A restaurant that has ordered here for six weeks: milk twice a week, cream on Thursdays. The agent knows its usual amounts and the head chef's rule.",
  laakso: "The partner's own example: a caterer with no history yet. Try “1,000 litres of lactose-free milk by Monday”.",
};

async function Kitchens() {
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
              <p className="text-ink-soft">Your kitchen, from the QR code on this phone</p>
              <p className="display text-[1.9rem]">
                {mine.kitchenName}, {mine.city}
              </p>
              <p className="text-ink-soft">You are {mine.approverName}: orders over {moneyShort(mine.perOrderLimitCents)} come to you to sign.</p>
            </div>
            <span className="bg-lime px-4 py-3 font-semibold text-ink">Open my shop</span>
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
                  <p className="mt-1 leading-snug">{ABOUT[k.slug] ?? "A demo kitchen."}</p>
                  {m && (
                    <p className="mt-3 text-[0.95rem] text-ink-soft">
                      Agent alone up to {moneyShort(m.perOrderLimitCents)} per order; {m.approvers[0]?.name} signs above that.
                    </p>
                  )}
                  <span className="mt-4 self-start bg-petrol px-4 py-2.5 font-semibold text-paper">Enter the shop</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {visitors.length > 0 && (
        <section className="mt-10">
          <h2 className="display text-[1.5rem]">Visitors&apos; kitchens here now</h2>
          <p className="text-ink-soft">Made by scanning the QR code on the wall; each closes after 90 minutes.</p>
          <ul className="mt-2 divide-y divide-line bg-paper">
            {visitors.map((k) => (
              <li key={k.slug}>
                <Link href={`/k/${k.slug}`} className="flex min-h-12 items-center justify-between px-4 py-2 hover:bg-concrete/50">
                  <span className="font-semibold">{k.name}</span>
                  <span className="text-ink-soft">{k.approverName} signs off</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-10 text-[0.95rem] text-ink-soft">
        Joined from the QR code on the big screen? Open{" "}
        <Link href="/k/mine" className="font-semibold text-petrol underline decoration-2 underline-offset-4">
          your own kitchen
        </Link>{" "}
        on the same phone.
      </p>
    </>
  );
}
