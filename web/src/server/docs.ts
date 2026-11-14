import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The developer documents the app serves itself, so a judge or an outside developer reads them without access to the
 * (private) repository: `/docs/<slug>` as a page, `/docs/raw/<slug>.md` as Markdown for agents. The files live in
 * web/docs/ (the build context); the two runtime reports are copies that examples/runtimes/run-all writes there.
 */
export const PUBLIC_DOCS = [
  { slug: "connect-an-agent", file: "connect-an-agent.md", title: "Connect an agent", about: "MCP and REST, the mandate, the tools, consumer assistants, receipts" },
  { slug: "assumptions", file: "assumptions.md", title: "Assumptions and next steps", about: "What is mocked, what production needs, next steps, agentic payments" },
  { slug: "runtimes", file: "runtimes.md", title: "Agent runtimes", about: "Buyers on seven agent frameworks, each a few lines" },
  { slug: "runtime-results", file: "runtime-results.md", title: "Runtime results", about: "The last live run of the seven buyers" },
  { slug: "runtime-gaps", file: "runtime-gaps.md", title: "What the runtimes showed up", about: "Gaps the runtimes found in the gate, and the fixes" },
  { slug: "offers", file: "offers.md", title: "Offers from the wholesaler's agent", about: "The selling agent: what it proposes, its guardrails, the open format" },
] as const;

export type PublicDoc = (typeof PUBLIC_DOCS)[number];

export function publicDoc(slug: string): PublicDoc | undefined {
  return PUBLIC_DOCS.find((d) => d.slug === slug);
}

/** Read a served document. Undefined when the file is not there. */
export function readDoc(doc: PublicDoc): string | undefined {
  try {
    return readFileSync(path.join(process.cwd(), "docs", doc.file), "utf8");
  } catch {
    return undefined;
  }
}

/** Where a link inside a served document goes: another served document, a site path, the web, or nowhere (a repository file). */
export function docHref(href: string): string | undefined {
  if (/^(https?:|mailto:)/.test(href)) return /github\.com\/[^/]+\/junction-2026/i.test(href) ? undefined : href;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/")) return href;
  const [file, hash] = href.split("#");
  const name = file.split("/").pop() ?? "";
  const byFile = PUBLIC_DOCS.find((d) => d.file === name) ?? (name === "RESULTS.md" ? publicDoc("runtime-results") : name === "GAPS.md" ? publicDoc("runtime-gaps") : undefined);
  return byFile ? `/docs/${byFile.slug}${hash ? `#${hash}` : ""}` : undefined;
}
