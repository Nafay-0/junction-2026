import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { exaContents, exaSearch, type ExaResult } from "@/lib/exa/client";
import { domainOf, toSource, type ImageItem, type ImagesData, type ReadPagesData, type SearchResultItem, type WebSearchData } from "@/lib/widgets/types";
import { clip, errorMessage, type ToolContext } from "./context";

const RECENCY_DAYS = { day: 1, week: 7, month: 31, year: 366 } as const;

export function toSearchItem(r: ExaResult): SearchResultItem {
  return {
    ...toSource({ url: r.url, title: r.title, publishedDate: r.publishedDate, snippet: clip(r.highlights?.[0], 280) || undefined }),
    image: r.image ?? undefined,
    highlights: (r.highlights ?? []).map((h) => clip(h, 900)),
  };
}

export function webSearchTool(ctx: ToolContext) {
  // How many results a search brings back grows with the depth the user asked for (mode and effort).
  const { searchResults, maxSearchResults } = ctx.depth;
  return tool({
    description:
      "Search the live web with Exa and get the most relevant pages with quoted passages. Use it for anything that may have changed, anything local or specific, and to find sources for claims. " +
      "Write the query as a description of the pages you want (subject, kind of source, time period), not as keywords. Run several searches in parallel when the question has several parts.",
    inputSchema: z.object({
      query: z.string().describe("A natural-language description of the pages to find."),
      objective: z
        .string()
        .optional()
        .describe("Goal for this search: which documents should rank first, which should be excluded, and what facts or figures to pull from them."),
      numResults: z.number().int().min(1).max(maxSearchResults).optional().describe(`How many results. Default ${searchResults}, at most ${maxSearchResults}.`),
      category: z.enum(["news", "company", "people", "publication", "personal site", "financial report"]).optional(),
      includeDomains: z.array(z.string()).max(20).optional().describe("Only search these sites, for example official ones."),
      recency: z.enum(["day", "week", "month", "year"]).optional().describe("Only pages published within this window."),
    }),
    execute: async (input, { abortSignal }): Promise<WebSearchData> => {
      try {
        const startPublishedDate = input.recency
          ? new Date(Date.now() - RECENCY_DAYS[input.recency] * 86_400_000).toISOString()
          : undefined;
        const res = await exaSearch(
          {
            query: input.query,
            objective: input.objective,
            numResults: input.numResults ?? searchResults,
            category: input.category,
            includeDomains: input.includeDomains?.length ? input.includeDomains : undefined,
            // Date filters are rejected for the company and people indexes.
            startPublishedDate: input.category === "company" || input.category === "people" ? undefined : startPublishedDate,
            userLocation: ctx.country,
            contents: { highlights: true },
          },
          { meter: ctx.meter, signal: abortSignal },
        );
        const results = res.results.map(toSearchItem);
        return { kind: "search", query: input.query, results, sources: results, exaCostUsd: res.costDollars?.total };
      } catch (err) {
        return { kind: "search", query: input.query, results: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.error) return { type: "text", value: `Search failed: ${output.error}` };
      if (output.results.length === 0) return { type: "text", value: "No results. Try a broader or differently worded query." };
      const lines = output.results.map((r, i) => {
        const date = r.publishedDate ? `, ${r.publishedDate.slice(0, 10)}` : "";
        // A long list keeps the first ten as they always were and gives the rest one shorter quote each.
        const quotes = r.highlights.slice(0, i < 10 ? 2 : 1).map((h) => `> ${clip(h, i < 10 ? 700 : 400)}`).join("\n");
        return `[${i + 1}] ${r.title ?? r.domain}\n${r.url} (${r.domain}${date})\n${quotes}`;
      });
      return { type: "text", value: lines.join("\n\n") };
    },
  });
}

export function readPagesTool(ctx: ToolContext) {
  const most = ctx.depth.readPages;
  return tool({
    description:
      `Read the full text of up to ${most} web pages you already have URLs for. Use it when the quoted passages from a search are not enough: exact rules, prices, tables, deadlines, the steps of a process.`,
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1).max(most),
      fresh: z.boolean().optional().describe("Set true to fetch the page live instead of using a recent copy. Use only when a stale page would be wrong (prices, availability)."),
    }),
    execute: async ({ urls, fresh }, { abortSignal }): Promise<ReadPagesData> => {
      try {
        const res = await exaContents(
          { urls, text: { maxCharacters: 7000 }, maxAgeHours: fresh ? 0 : undefined },
          { meter: ctx.meter, signal: abortSignal },
        );
        const pages = res.results.map((r) => {
          const text = r.text ?? "";
          return {
            ...toSource({ url: r.url, title: r.title, publishedDate: r.publishedDate }),
            characters: text.length,
            excerpt: clip(text.replace(/^#.*\n/, ""), 240),
            text,
          };
        });
        const failed = (res.statuses ?? []).filter((s) => s.status !== "success").map((s) => domainOf(s.id));
        return {
          kind: "pages",
          pages,
          sources: pages.map(({ url, title, domain, favicon, publishedDate }) => ({ url, title, domain, favicon, publishedDate })),
          exaCostUsd: res.costDollars?.total,
          error: pages.length === 0 ? `Could not read ${failed.join(", ") || "those pages"}.` : undefined,
        };
      } catch (err) {
        return { kind: "pages", pages: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.pages.length === 0) return { type: "text", value: output.error ?? "Could not read the pages." };
      return {
        type: "text",
        value: output.pages.map((p) => `# ${p.title ?? p.domain}\n${p.url}\n\n${p.text}`).join("\n\n---\n\n"),
      };
    },
  });
}

const BAD_IMAGE = /(\.svg|\.gif|sprite|logo|icon|avatar|favicon|placeholder|pixel|tracking|1x1|badge|banner-ad|\/ads?\/)/i;

export function searchImagesTool(ctx: ToolContext) {
  return tool({
    description:
      "Find images on the web and show them as a gallery. Use it when the user asks to see something (a place, a product, a style, a person's work), or when pictures would help them choose.",
    inputSchema: z.object({
      query: z.string().describe("What the images should show, described in natural language."),
      includeDomains: z.array(z.string()).max(10).optional(),
    }),
    execute: async ({ query, includeDomains }, { abortSignal }): Promise<ImagesData> => {
      try {
        const res = await exaSearch(
          {
            query: `${query} (photos, images)`,
            numResults: 10,
            includeDomains: includeDomains?.length ? includeDomains : undefined,
            contents: { highlights: { maxCharacters: 200 }, extras: { imageLinks: 6 } },
          },
          { meter: ctx.meter, signal: abortSignal },
        );
        const seen = new Set<string>();
        const images: ImageItem[] = [];
        // Interleave pages so the gallery is not dominated by one site.
        const perPage = res.results.map((r) => {
          const urls = [r.image, ...(r.extras?.imageLinks ?? [])].filter((u): u is string => typeof u === "string");
          return { r, urls: urls.filter((u) => /^https?:\/\//.test(u) && !BAD_IMAGE.test(u)) };
        });
        for (let round = 0; round < 6 && images.length < 24; round++) {
          for (const { r, urls } of perPage) {
            const url = urls[round];
            if (!url) continue;
            const key = url.split("?")[0];
            if (seen.has(key)) continue;
            seen.add(key);
            images.push({ url, title: r.title ?? undefined, pageUrl: r.url, domain: domainOf(r.url) });
          }
        }
        const sources = res.results.filter((r) => images.some((i) => i.pageUrl === r.url)).map((r) => toSource(r));
        return { kind: "images", query, images, sources, exaCostUsd: res.costDollars?.total, error: images.length === 0 ? "No images found for that." : undefined };
      } catch (err) {
        return { kind: "images", query, images: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.error
        ? `Image search failed: ${output.error}`
        : `A gallery of ${output.images.length} images is now shown to the user, from: ${[...new Set(output.images.map((i) => i.domain))].slice(0, 8).join(", ")}. Do not list the images again; add at most one sentence.`,
    }),
  });
}
