import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_COOKIE } from "@/server/approver-session";
import { getRuntime } from "@/server/runtime";
import { Suspense, type ReactNode } from "react";
import { ChevronRight, DoorClosed, Lock } from "lucide-react";
import { Avatar, IconDisc, ListRow } from "../../_ui/kit";
import { DEMO_NOTES } from "../../_ui/brand";
import { Wordmark } from "../../_ui/wordmark";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { Portal } from "./portal";
import { LangProvider } from "../../_i18n/provider";
import { DEFAULT_LANG, type Lang } from "../../_i18n/lang";
import { chosenLang, requestLang } from "../../_i18n/server";
import { LAYOUT_TEXT } from "./layout.text";
import { PORTAL_TEXT } from "./portal.text";
import { ACCOUNT_TEXT } from "./account.text";
import { ACCOUNT_COOKIE } from "@/server/accounts/http";
import { currentOps } from "@/server/ops/access";
import { LINK_GO, LINK_PRIMARY } from "../_account/links";

export async function generateMetadata(): Promise<Metadata> {
  return { title: LAYOUT_TEXT[await requestLang()].title.shop };
}

/**
 * The kitchen portal for one kitchen: /k/kaari (returning kitchen with memory), /k/laakso (the partner's example
 * org), /k/sbx_... (a visitor's own kitchen), /k/<username> (a restaurant's account, shown only to that account). The kitchen's mandate stays on the server; pages call /ui-api.
 */
export default function KitchenLayout(props: LayoutProps<"/k/[kitchen]">) {
  return (
    <Suspense fallback={<Shell />}>
      <Loaded {...props} />
    </Suspense>
  );
}

async function Loaded({ params, children }: LayoutProps<"/k/[kitchen]">) {
  const { kitchen } = await params;
  await connection(); // request-time: kitchens come and go
  const [jar, rt, lang] = await Promise.all([cookies(), getRuntime(), chosenLang()]);
  const viewer = await rt.passkeys.sessionApprover(jar.get(SESSION_COOKIE)?.value); // lists only this phone's own visitor kitchen
  const signedIn = await rt.accounts.session(jar.get(ACCOUNT_COOKIE)?.value);
  const me = signedIn ? rt.accounts.view(signedIn.account) : undefined;
  const [k, kitchens] = await Promise.all([resolveKitchen(kitchen), listConsoleKitchens(viewer?.orgId, me)]);
  if (!k) return <Closed kitchens={kitchens} lang={lang ?? DEFAULT_LANG} />;
  // An account's kitchen, and each stage kitchen, is private to its account: nothing of it (not even its mandate)
  // reaches another browser. The operations desk reads kitchens through its own portal.
  const owner = k.info.kind === "account" ? k.info.account?.username : k.info.kind === "demo" ? k.info.slug : undefined;
  const ops = currentOps(new Request("http://dock.local/", { headers: { cookie: jar.toString() } }));
  if (owner && me?.username !== owner && !ops) {
    return (
      <LangProvider initial={lang}>
        <Private lang={lang ?? DEFAULT_LANG} slug={k.info.slug} me={me && { username: me.username, kitchen: me.kitchen }} />
      </LangProvider>
    );
  }
  const account = me && { username: me.username, restaurant: me.restaurant, kitchen: me.kitchen, shared: me.shared, kind: me.kind, demo: me.demo, ...(me.start ? { start: me.start } : {}), ...(me.free ? { free: me.free } : {}) };
  return (
    <LangProvider initial={lang}>
      <Portal key={k.info.slug} kitchen={k.info} kitchens={kitchens} account={account}>
        {children}
      </Portal>
    </LangProvider>
  );
}

/** The page a kitchen shows when it cannot be opened here: the mark, an icon, the title, what to do. */
function Notice({ lang, icon, title, children }: { lang: Lang; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">
        <span className="sm:hidden">{PORTAL_TEXT[lang].demoShort}</span>
        <span className="hidden sm:inline">{DEMO_NOTES[lang]}</span>
      </p>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1320px] items-center px-4 py-2.5 sm:px-6 xl:px-8">
          <Link href="/k" aria-label="AimoPilot" className="flex min-h-11 items-center rounded-md">
            <Wordmark size={28} />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[36rem] px-4 pb-16 pt-12 sm:pt-20">
        <IconDisc size={56}>{icon}</IconDisc>
        <h1 className="display mt-5 break-words text-[2.1rem] leading-[1.05] text-ink hyphens-manual sm:text-[2.5rem]">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function Private({ lang, slug, me }: { lang: Lang; slug: string; me?: { username: string; kitchen?: string } }) {
  const tx = ACCOUNT_TEXT[lang];
  return (
    <Notice lang={lang} icon={<Lock size={24} />} title={tx.privateTitle}>
      <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-soft">{tx.privateBody}</p>
      {me && <p className="mt-3 rounded-lg bg-surface px-4 py-3 leading-snug">{tx.privateOther(me.username)}</p>}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {me?.kitchen && (
          <Link className={LINK_PRIMARY} href={`/k/${me.kitchen}`}>
            {tx.toMine}
          </Link>
        )}
        {!me && (
          <Link className={`${LINK_GO} min-h-13 text-[1.05rem]`} href={`/k?as=${encodeURIComponent(slug)}`}>
            {tx.toSignIn}
          </Link>
        )}
      </div>
    </Notice>
  );
}

/** While the kitchen loads: the store's own frame (demo strip, account line, header) and the shape of Home's hero. */
function Shell() {
  return (
    <div className="min-h-dvh bg-mist" aria-busy>
      <p className="h-7 bg-petrol-deep" />
      <div className="h-10 border-b border-line bg-paper" />
      <div className="h-[60px] border-b border-line bg-paper lg:h-[121px]" />
      <div className="mx-auto max-w-[1320px] space-y-6 px-4 pt-6 sm:px-6 xl:px-8">
        <div className="skeleton h-72 !rounded-[28px]" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-56 !rounded-[20px]" />
          <div className="skeleton h-56 !rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}

function Closed({ kitchens, lang }: { kitchens: { slug: string; name: string }[]; lang: Lang }) {
  const tx = LAYOUT_TEXT[lang];
  return (
    <Notice lang={lang} icon={<DoorClosed size={24} />} title={tx.closedTitle}>
      <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-soft">{tx.closedBody}</p>
      {kitchens.length > 0 && (
        <ul className="mt-7 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {kitchens.map((k) => (
            <li key={k.slug}>
              <ListRow href={`/k/${k.slug}`} leading={<Avatar name={k.name} />} title={k.name} trailing={<ChevronRight aria-hidden size={18} className="text-ink-faint" />} />
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
