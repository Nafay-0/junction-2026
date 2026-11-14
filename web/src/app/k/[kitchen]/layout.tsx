import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_COOKIE } from "@/server/approver-session";
import { getRuntime } from "@/server/runtime";
import { Suspense } from "react";
import { DEMO_NOTES } from "../../_ui/brand";
import { Wordmark } from "../../_ui/wordmark";
import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { Portal } from "./portal";
import { LangProvider } from "../../_i18n/provider";
import { DEFAULT_LANG, type Lang } from "../../_i18n/lang";
import { chosenLang, requestLang } from "../../_i18n/server";
import { LAYOUT_TEXT } from "./layout.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: LAYOUT_TEXT[await requestLang()].title.shop };
}

/**
 * The kitchen portal for one kitchen: /k/kaari (returning kitchen with memory), /k/laakso (the partner's example
 * org), /k/sbx_... (a visitor's own kitchen). The kitchen's mandate stays on the server; pages call /ui-api.
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
  const [k, kitchens] = await Promise.all([resolveKitchen(kitchen), listConsoleKitchens(viewer?.orgId)]);
  if (!k) return <Closed kitchens={kitchens} lang={lang ?? DEFAULT_LANG} />;
  return (
    <LangProvider initial={lang}>
      <Portal key={k.info.slug} kitchen={k.info} kitchens={kitchens}>
        {children}
      </Portal>
    </LangProvider>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh bg-concrete">
      <p className="h-6 bg-ink" />
      <div className="h-[118px] border-b-[3px] border-ink bg-paper" />
      <div className="h-[104px] border-b border-line" />
    </div>
  );
}

function Closed({ kitchens, lang }: { kitchens: { slug: string; name: string }[]; lang: Lang }) {
  const tx = LAYOUT_TEXT[lang];
  return (
    <main className="min-h-dvh bg-concrete px-4 py-10 text-ink sm:px-10">
      <p>
        <Wordmark size={34} />
      </p>
      <h1 className="display mt-8 break-words text-[3rem] text-ink">{tx.closedTitle}</h1>
      <p className="mt-2 max-w-prose text-[1.1rem] text-ink-soft">{tx.closedBody}</p>
      <ul className="mt-4 space-y-2">
        {kitchens.map((k) => (
          <li key={k.slug}>
            <Link className="text-[1.1rem] font-semibold text-petrol underline decoration-2 underline-offset-4" href={`/k/${k.slug}`}>
              {k.name}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-[0.9rem] text-ink-soft">{DEMO_NOTES[lang]}</p>
    </main>
  );
}
