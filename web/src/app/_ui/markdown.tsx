import type { ReactNode } from "react";

/**
 * A small Markdown renderer for the documents the app serves (/docs/<slug>): headings, paragraphs, lists (nested by
 * indentation), tables, fenced code, quotes, and inline code, bold, italic and links. It builds React elements, never
 * HTML strings, so nothing in a document can inject markup. `link` decides where each link goes (undefined: plain text).
 */

type LinkFn = (href: string) => string | undefined;

export const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

/** Inline Markdown to React: `code`, **bold**, *italic*, [text](href), <https://autolink>. */
export function inline(text: string, link: LinkFn, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?<![\p{L}\p{N}*])\*(?!\s)([^*]+?)\*(?![\p{L}\p{N}*])|\\([\\`*_[\]()#|<>-])/gu;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-mist px-1 py-0.5 font-mono text-[0.88em]">{m[2].trim() || m[2]}</code>);
    else if (m[3] !== undefined) out.push(<strong key={k} className="font-semibold">{inline(m[3], link, k)}</strong>);
    else if (m[4] !== undefined) {
      const href = link(m[5]);
      const label = inline(m[4], link, k);
      out.push(
        href ? (
          <a key={k} href={href} className="font-medium text-petrol underline underline-offset-2" {...(/^https?:/.test(href) ? { rel: "noreferrer" } : {})}>
            {label}
          </a>
        ) : (
          <span key={k}>{label}</span>
        ),
      );
    } else if (m[6]) {
      const href = link(m[6]);
      out.push(href ? <a key={k} href={href} rel="noreferrer" className="font-medium text-petrol underline underline-offset-2">{m[6]}</a> : m[6]);
    } else if (m[7] !== undefined) out.push(<em key={k}>{inline(m[7], link, k)}</em>);
    else if (m[8]) out.push(m[8]);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

const indentOf = (line: string) => line.match(/^ */)![0].length;
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

type Item = { text: string; children: string[] };

function list(lines: string[], start: number, link: LinkFn, key: string): { node: ReactNode; next: number } {
  const base = indentOf(lines[start]);
  const ordered = /^\s*\d+\./.test(lines[start]);
  const items: Item[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const nextLine = lines[i + 1];
      if (nextLine && (LIST.test(nextLine) || indentOf(nextLine) > base) && indentOf(nextLine) >= base) {
        i++;
        continue;
      }
      break;
    }
    const m = LIST.exec(line);
    if (m && indentOf(line) === base) items.push({ text: m[3], children: [] });
    else if (indentOf(line) > base && items.length) items.at(-1)!.children.push(line);
    else break;
    i++;
  }
  const Tag = ordered ? "ol" : "ul";
  const node = (
    <Tag key={key} className={`${ordered ? "list-decimal" : "list-disc"} my-3 space-y-1.5 pl-6 marker:text-ink-soft`}>
      {items.map((it, n) => {
        const childStart = it.children.findIndex((c) => LIST.test(c));
        const lead = childStart === -1 ? it.children : it.children.slice(0, childStart);
        return (
          <li key={n} className="leading-relaxed">
            {inline([it.text, ...lead.map((l) => l.trim())].join(" "), link, `${key}-${n}`)}
            {childStart >= 0 ? blocks(it.children.slice(childStart).map((c) => c.slice(Math.min(indentOf(c), base + 2))), link, `${key}-${n}c`) : null}
          </li>
        );
      })}
    </Tag>
  );
  return { node, next: i };
}

/** Block-level Markdown to React. */
export function blocks(lines: string[], link: LinkFn, key = "b"): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `${key}-${n++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^(\s*)```(\w*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++].slice(fence[1].length));
      i++;
      out.push(
        <pre key={k} className="my-4 overflow-x-auto rounded-xl bg-petrol-deep p-4 text-[0.82rem] leading-relaxed text-paper">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (/^ {4,}\S/.test(line) && !LIST.test(line)) {
      const code: string[] = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || (!lines[i].trim() && /^ {4,}/.test(lines[i + 1] ?? "")))) code.push(lines[i++].slice(4));
      out.push(
        <pre key={k} className="my-4 overflow-x-auto rounded-xl bg-petrol-deep p-4 text-[0.82rem] leading-relaxed text-paper">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const id = slugOf(h[2]);
      const cls = level === 1 ? "display mt-2 text-[2rem] leading-tight sm:text-[2.4rem]" : level === 2 ? "display mt-10 text-[1.5rem] leading-tight" : level === 3 ? "mt-8 text-[1.15rem] font-semibold" : "mt-6 font-semibold";
      const Tag = (["h1", "h2", "h3", "h4"] as const)[level - 1];
      out.push(
        <Tag key={k} id={id} className={`${cls} scroll-mt-6`}>
          {inline(h[2], link, k)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={k} className="my-4 overflow-x-auto rounded-xl border border-ink/10 bg-paper">
          <table className="w-full border-collapse text-left text-[0.88rem]">
            <thead className="bg-mist">
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="border-b border-ink/10 px-3 py-2 align-bottom font-semibold">
                    {inline(c, link, `${k}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-ink/5 last:border-0">
                  {head.map((_, j) => (
                    <td key={j} className="px-3 py-2 align-top leading-relaxed [&_code]:whitespace-nowrap">
                      {inline(r[j] ?? "", link, `${k}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      const { node, next } = list(lines, i, link, k);
      out.push(node);
      i = next;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(
        <blockquote key={k} className="my-4 border-l-4 border-petrol/40 pl-4 text-ink-soft">
          {blocks(q, link, k)}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|>\s?|\s*\|)/.test(lines[i]) && !LIST.test(lines[i])) para.push(lines[i++].trim());
    out.push(
      <p key={k} className="my-3 leading-relaxed">
        {inline(para.join(" "), link, k)}
      </p>,
    );
  }
  return out;
}

export function Markdown({ source, link }: { source: string; link: LinkFn }) {
  return <>{blocks(source.replace(/\r\n/g, "\n").split("\n"), link)}</>;
}
