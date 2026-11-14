import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { DEMO_NOTE } from "../../_ui/brand";
import { Markdown } from "../../_ui/markdown";
import { Wordmark } from "../../_ui/wordmark";
import { PUBLIC_DOCS, docHref, publicDoc, readDoc } from "@/server/docs";

/**
 * /docs/<slug>: a developer document from web/docs/, served by the app so nobody needs the repository to read it.
 * Built once per document at build time. The same text as Markdown: /docs/raw/<slug>.md.
 */
export function generateStaticParams() {
  return PUBLIC_DOCS.map((d) => ({ name: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const doc = publicDoc((await params).name);
  return { title: doc ? `${doc.title} · AimoPilot` : "AimoPilot" };
}

export default async function DocPage({ params }: { params: Promise<{ name: string }> }) {
  const doc = publicDoc((await params).name);
  const source = doc && readDoc(doc);
  if (!doc || source === undefined) notFound();
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">{DEMO_NOTE}</p>
      <header className="on-dark bg-petrol-deep text-paper">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <Link href="/try" aria-label="Try it as an outside agent">
            <Wordmark tone="paper" size={26} />
          </Link>
          <nav aria-label="Documents" className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9rem]">
            <Link href="/docs" className="underline-offset-2 hover:underline">
              All documents
            </Link>
            <a href={`/docs/raw/${doc.slug}.md`} className="underline-offset-2 hover:underline">
              Markdown
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-8 sm:py-10">
        <article className="min-w-0 rounded-2xl bg-paper px-5 py-6 shadow-sm sm:px-10 sm:py-8 [overflow-wrap:anywhere]">
          <p className="flex items-center gap-2 text-[0.8rem] text-ink-soft">
            <FileText aria-hidden size={15} /> web/docs/{doc.file}
          </p>
          <Markdown source={source} link={docHref} />
        </article>
      </main>
    </div>
  );
}
