import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Building2, FileText, MonitorPlay, Smartphone, SquareTerminal } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { LangProvider } from "../_i18n/provider";
import { DEFAULT_LANG } from "../_i18n/lang";
import { chosenLang, requestLang } from "../_i18n/server";
import { DEMO_NOTES } from "../_ui/brand";
import { Card, IconDisc } from "../_ui/kit";
import { Wordmark } from "../_ui/wordmark";
import { LINK_GO, LINK_SECONDARY } from "../k/_account/links";
import { EntryLangSwitch } from "../k/entry-lang";
import { CopyCode } from "./copy-code";
import { TRY_TEXT } from "./try.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: TRY_TEXT[await requestLang()].title };
}

const REPO = "https://github.com/Nafay-0/junction-2026/blob/main/web/docs";

/**
 * /try: an outside agent orders, shown to someone who has never heard of MCP. Two paths (an address pasted into a
 * consumer assistant, or one command that runs a stock MCP client), where the result shows up, and the open documents.
 * Public; no account. Words in try.text.ts.
 */
export default function TryPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-petrol-deep" />}>
      <Try />
    </Suspense>
  );
}

async function Try() {
  const chosen = await chosenLang(); // the language cookie: request-time, so inside Suspense
  const lang = chosen ?? DEFAULT_LANG;
  const tx = TRY_TEXT[lang];
  const docs: { href: string; label: string; what: string; external?: boolean }[] = [
    { href: "/llms.txt", label: "/llms.txt", what: tx.docs.llms },
    { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", what: tx.docs.catalog },
    { href: "/api/v1/openapi.json", label: "/api/v1/openapi.json", what: tx.docs.openapi },
    { href: "/.well-known/dock.json", label: "/.well-known/dock.json", what: tx.docs.manifest },
    { href: `${REPO}/connect-an-agent.md`, label: "connect-an-agent.md", what: tx.docs.guide, external: true },
    { href: `${REPO}/assumptions.md`, label: "assumptions.md", what: tx.docs.assumptions, external: true },
  ];
  return (
    <LangProvider initial={chosen}>
      <div className="min-h-dvh bg-mist text-ink">
        <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">{DEMO_NOTES[lang]}</p>
        <header className="on-dark bg-petrol-deep text-paper">
          <div className="mx-auto max-w-[1080px] px-4 sm:px-8">
            <div className="flex items-center justify-between gap-3 py-3.5 sm:py-5">
              <Link href="/k" aria-label={tx.back}>
                <Wordmark tone="paper" size={28} />
              </Link>
              <span className="rounded-full bg-petrol-deep/70">
                <EntryLangSwitch rendered={lang} />
              </span>
            </div>
            <div className="max-w-[44rem] pb-12 pt-6 sm:pb-16 sm:pt-10">
              <h1 className="display break-words text-[2.3rem] leading-[1] hyphens-manual sm:text-[3.2rem]">{tx.heading}</h1>
              <p className="mt-4 max-w-[62ch] text-[1.02rem] leading-relaxed text-paper/85 sm:text-[1.08rem]">{tx.lead}</p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1080px] space-y-12 px-4 py-10 sm:px-8 sm:py-12">
          <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card as="section" pad className="space-y-4">
              <Heading icon={<Smartphone size={21} />} id="path-a">
                {tx.pathA}
              </Heading>
              <p className="text-ink-soft">{tx.pathAIntro}</p>
              <ol className="space-y-3">
                <Step n={1}>
                  {tx.a1}{" "}
                  <Link href="/join" className="font-semibold text-petrol underline underline-offset-2">
                    {tx.a1Link}
                  </Link>
                </Step>
                <Step n={2}>{tx.a2}</Step>
                <Step n={3}>{tx.a3}</Step>
                <Step n={4}>
                  {tx.a4}
                  <div className="mt-2">
                    <CopyCode text={tx.prompt} label={tx.a4} mono={false} />
                  </div>
                </Step>
                <Step n={5}>{tx.a5}</Step>
              </ol>
              <Link href="/join" className={`${LINK_GO} w-full sm:w-auto`}>
                {tx.a1Link}
                <ArrowRight aria-hidden size={18} />
              </Link>
            </Card>

            <Card as="section" pad className="space-y-4">
              <Heading icon={<SquareTerminal size={21} />} id="path-b">
                {tx.pathB}
              </Heading>
              <p className="text-ink-soft">{tx.pathBIntro}</p>
              <CopyCode text="cd web && pnpm build && pnpm demo:mcp" label={tx.pathB} />
              <p className="leading-relaxed">{tx.pathBAbout}</p>
              <p className="text-ink-soft">{tx.pathBUrl}</p>
              <CopyCode text="pnpm demo:mcp --url https://<address>" label={tx.pathBUrl} />
            </Card>
          </div>

          <section aria-labelledby="see" className="space-y-4">
            <h2 id="see" className="display text-[1.5rem] sm:text-[1.625rem]">
              {tx.seeTitle}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Where href="/" icon={<MonitorPlay size={20} />} title={tx.wall} about={tx.wallAbout} />
              <Where href="/ops" icon={<Building2 size={20} />} title={tx.ops} about={tx.opsAbout} />
            </div>
          </section>

          <section aria-labelledby="docs" className="space-y-4">
            <h2 id="docs" className="display text-[1.5rem] sm:text-[1.625rem]">
              {tx.docsTitle}
            </h2>
            <p className="-mt-2 max-w-[68ch] text-ink-soft">{tx.docsIntro}</p>
            <Card as="div">
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.href}>
                    <a href={d.href} {...(d.external ? { target: "_blank", rel: "noreferrer" } : {})} className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-mist">
                      <FileText aria-hidden size={18} className="shrink-0 text-petrol" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-[0.88rem] font-semibold text-petrol">{d.label}</span>
                        <span className="block text-[0.92rem] leading-snug text-ink-soft">{d.what}</span>
                      </span>
                      <ArrowUpRight aria-hidden size={17} className="shrink-0 text-ink-faint" />
                    </a>
                  </li>
                ))}
                <li className="flex min-h-14 items-center gap-3 px-5 py-3">
                  <FileText aria-hidden size={18} className="shrink-0 text-petrol" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all font-mono text-[0.88rem] font-semibold">/api/mcp</span>
                    <span className="block text-[0.92rem] leading-snug text-ink-soft">{tx.docs.mcp}</span>
                  </span>
                </li>
              </ul>
            </Card>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <Link href="/k" className={LINK_SECONDARY}>
              {tx.back}
            </Link>
            <p className="max-w-[60ch] text-[0.82rem] leading-snug text-ink-soft">{DEMO_NOTES[lang]}</p>
          </div>
        </main>
      </div>
    </LangProvider>
  );
}

function Heading({ icon, id, children }: { icon: ReactNode; id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3">
      <IconDisc size={40}>{icon}</IconDisc>
      <span className="display text-[1.35rem] leading-tight sm:text-[1.45rem]">{children}</span>
    </h2>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 leading-relaxed">
      <span aria-hidden className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-petrol-soft text-[0.85rem] font-semibold text-petrol tabular">
        {n}
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Where({ href, icon, title, about }: { href: string; icon: ReactNode; title: string; about: string }) {
  return (
    <Link href={href} className="lift flex items-start gap-4 rounded-xl border border-line bg-paper p-5">
      <IconDisc size={40}>{icon}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="display flex items-center gap-1.5 text-[1.2rem] leading-tight">
          {title}
          <ArrowRight aria-hidden size={17} className="text-petrol" />
        </span>
        <span className="mt-1 block leading-relaxed text-ink-soft">{about}</span>
      </span>
    </Link>
  );
}
