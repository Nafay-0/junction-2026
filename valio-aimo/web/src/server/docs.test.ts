import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/app/_ui/markdown";
import { GET as rawDoc } from "@/app/docs/raw/[file]/route";
import { apiCatalog, llmsTxt, manifest } from "./discovery";
import { PUBLIC_DOCS, docHref, docPath, readDoc } from "./docs";
import { buildOpenApi } from "./openapi";
import { WORKS_WITH } from "./works-with";

/** The repository is private: a link into it is a 404 for a judge or an outside developer. */
const PRIVATE_REPO = /github\.com\/[^/\s"')]+\/junction-2026/i;

function files(dir: string, keep: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p, keep) : keep(p) ? [p] : [];
  });
}

describe("no page links into the private repository", () => {
  it("in the app's pages, server code, served documents and public files", () => {
    const web = process.cwd();
    const shipped = [
      ...files(path.join(web, "src", "app"), (f) => /\.(tsx?|json|txt|md)$/.test(f) && !/\.test\.ts$/.test(f)),
      ...files(path.join(web, "src", "server"), (f) => /\.(tsx?|json)$/.test(f) && !/\.test\.ts$/.test(f)),
      ...PUBLIC_DOCS.map((d) => docPath(d)),
      ...files(path.join(web, "public"), (f) => /\.(html|txt|json|md|svg)$/.test(f)),
    ];
    const offenders = shipped.filter((f) => PRIVATE_REPO.test(readFileSync(f, "utf8"))).map((f) => path.relative(web, f));
    expect(offenders).toEqual([]);
  });

  it("in the discovery documents, the OpenAPI document and the runtimes list", () => {
    const origin = "https://dock.test";
    for (const doc of [llmsTxt(origin), JSON.stringify(apiCatalog(origin)), JSON.stringify(manifest(origin)), JSON.stringify(buildOpenApi(origin)), JSON.stringify(WORKS_WITH)]) {
      expect(doc).not.toMatch(PRIVATE_REPO);
    }
  });
});

describe("the served documents", () => {
  it("are all there, render, and link only to served pages or the open web", () => {
    for (const d of PUBLIC_DOCS) {
      const source = readDoc(d);
      expect(source, d.file).toBeTruthy();
      const html = renderToStaticMarkup(createElement(Markdown, { source: source!, link: docHref }));
      expect(html).toContain("<h1");
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) expect(href, `${d.slug}: ${href}`).toMatch(/^(\/|#|https?:\/\/)/);
      expect(html).not.toMatch(PRIVATE_REPO);
      expect(html).not.toMatch(/<script/i);
    }
  });

  it("rewrite links between documents, and drop links to repository files", () => {
    expect(docHref("assumptions.md")).toBe("/docs/assumptions");
    expect(docHref("connect-an-agent.md#tools")).toBe("/docs/connect-an-agent#tools");
    expect(docHref("../../examples/runtimes/RESULTS.md")).toBe("/docs/runtime-results");
    expect(docHref("../../examples/runtimes/")).toBeUndefined();
    expect(docHref("https://github.com/Nafay-0/junction-2026/blob/main/README.md")).toBeUndefined();
    expect(docHref("https://modelcontextprotocol.io/specification")).toBe("https://modelcontextprotocol.io/specification");
  });

  it("are served as Markdown for agents", async () => {
    const res = await rawDoc(new Request("https://dock.test/docs/raw/connect-an-agent.md"), { params: Promise.resolve({ file: "connect-an-agent.md" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(await res.text()).toMatch(/^# Connect an agent/);
    expect((await rawDoc(new Request("https://dock.test/docs/raw/x.md"), { params: Promise.resolve({ file: "../../.env.local" }) })).status).toBe(404);
  });

  it("render tables, code, lists and inline marks without markup from the text", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { source: "# T\n\n| a | b |\n|---|---|\n| `x` | **y** |\n\n```bash\necho <b>hi</b>\n```\n\n- one\n  - two\n\n<script>alert(1)</script> [l](assumptions.md)", link: docHref }));
    expect(html).toContain("<table");
    expect(html).toContain("<code");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="/docs/assumptions"');
    expect((html.match(/<ul/g) ?? []).length).toBe(2);
  });
});
