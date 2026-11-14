import type { Metadata } from "next";
import Link from "next/link";
import { DEMO_NOTE } from "../_ui/brand";
import { Wordmark } from "../_ui/wordmark";
import { PUBLIC_DOCS } from "@/server/docs";

export const metadata: Metadata = { title: "Documents · AimoPilot" };

/** /docs: the developer documents the app serves, plus the machine-readable entry points. */
export default function DocsIndex() {
  const machine = [
    { href: "/llms.txt", what: "For language models: what this is and how to order" },
    { href: "/.well-known/api-catalog", what: "API catalogue (RFC 9727)" },
    { href: "/api/v1/openapi.json", what: "REST, described in OpenAPI 3.1" },
    { href: "/.well-known/dock.json", what: "AimoPilot's manifest: tools, rules, keys" },
    { href: "/.well-known/jwks.json", what: "The wholesaler's public keys (JWK Set)" },
  ];
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/80">{DEMO_NOTE}</p>
      <header className="on-dark bg-petrol-deep text-paper">
        <div className="mx-auto max-w-[960px] px-4 py-4 sm:px-8">
          <Link href="/try" aria-label="Try it as an outside agent">
            <Wordmark tone="paper" size={26} />
          </Link>
          <h1 className="display mt-6 pb-6 text-[2.2rem] leading-tight">Documents</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[960px] space-y-8 px-4 py-8 sm:px-8">
        <ul className="grid gap-3 sm:grid-cols-2">
          {PUBLIC_DOCS.map((d) => (
            <li key={d.slug} className="rounded-2xl bg-paper p-5 shadow-sm">
              <Link href={`/docs/${d.slug}`} className="text-[1.05rem] font-semibold text-petrol underline underline-offset-2">
                {d.title}
              </Link>
              <p className="mt-1 text-ink-soft">{d.about}</p>
              <a href={`/docs/raw/${d.slug}.md`} className="mt-2 inline-block text-[0.85rem] text-ink-soft underline underline-offset-2">
                Markdown
              </a>
            </li>
          ))}
        </ul>
        <section aria-labelledby="machine" className="rounded-2xl bg-paper p-5 shadow-sm">
          <h2 id="machine" className="font-semibold">
            For agents
          </h2>
          <ul className="mt-2 space-y-1.5">
            {machine.map((m) => (
              <li key={m.href}>
                <a href={m.href} className="font-mono text-[0.9rem] text-petrol underline underline-offset-2">
                  {m.href}
                </a>{" "}
                <span className="text-ink-soft">{m.what}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
