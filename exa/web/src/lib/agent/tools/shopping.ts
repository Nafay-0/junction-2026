import "server-only";

import { Output, streamText, tool } from "ai";
import { z } from "zod";
import { exaSearch, type ExaResult } from "@/lib/exa/client";
import { domainOf, toSource, type Product, type ProductsData } from "@/lib/widgets/types";
import { extractionProviderOptions } from "../providers";
import { clip, errorMessage, type ToolContext } from "./context";
import { slug } from "./structured";

/*
 * Product search: Exa finds live shop and review pages (many carry a structured "product"
 * record with images), then the fast worker model reads the quoted passages and lines the
 * products up side by side. Prices are only taken from text Exa returned, never guessed.
 * The cards appear one by one as the worker model writes them.
 */

const extraction = z.object({
  products: z
    .array(
      z.object({
        resultIndex: z.number().int().describe("The number of the search result this product comes from."),
        title: z.string().describe("Clean product name without shop names or marketing text."),
        brand: z.string().optional(),
        price: z.number().optional().describe("Only if a price is stated in the result. Never estimate."),
        currency: z.string().optional().describe("ISO currency code of that price."),
        rating: z.number().optional().describe("Out of 5, only if stated."),
        reviewCount: z.number().optional(),
        availability: z.string().optional().describe('A few words, for example "In stock".'),
        specs: z.array(z.object({ label: z.string(), value: z.string() })).max(4).describe("The specs that matter for this kind of product: short values, same labels across products."),
        note: z.string().optional().describe("Who this is best for, in under 15 words."),
      }),
    )
    .max(5),
  verdict: z.string().describe("One or two sentences recommending a choice for this request."),
});

type Draft = Partial<z.infer<typeof extraction>["products"][number]>;

function toProduct(draft: Draft | undefined, results: ExaResult[], index: number): Product | null {
  if (!draft || typeof draft.title !== "string" || typeof draft.resultIndex !== "number") return null;
  const r = results[draft.resultIndex - 1];
  if (!r) return null;
  const entity = r.entities?.find((e) => e.type === "product");
  const entityImages = (entity?.properties as { images?: string[] } | undefined)?.images;
  const image = [entityImages?.[0], r.image, r.extras?.imageLinks?.[0]].find((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
  return {
    id: slug(draft.title, index),
    title: draft.title,
    brand: draft.brand,
    image,
    price: typeof draft.price === "number" ? draft.price : undefined,
    currency: draft.currency,
    merchant: merchantName(r.url),
    url: r.url,
    rating: draft.rating,
    reviewCount: draft.reviewCount,
    availability: draft.availability,
    specs: (draft.specs ?? []).filter((s): s is { label: string; value: string } => typeof s?.label === "string" && typeof s?.value === "string"),
    note: draft.note,
  };
}

export function searchProductsTool(ctx: ToolContext) {
  return tool({
    description:
      "Find products to buy and compare them: shows product cards with photos, prices, shops and ratings, plus a side-by-side spec comparison. " +
      "Use it for shopping questions, price checks and 'which one should I buy'.",
    inputSchema: z.object({
      query: z.string().describe('What to buy and the constraints, for example "noise-cancelling over-ear headphones under 300 EUR".'),
      shops: z.array(z.string()).max(12).optional().describe('Shop domains to search, only when the user names shops or asks for a specific country\'s shops, for example ["verkkokauppa.com","gigantti.fi","power.fi"].'),
    }),
    // Each `yield` replaces what the widget shows; the last value yielded is the tool's result.
    async *execute({ query, shops }, { abortSignal }): AsyncGenerator<ProductsData> {
      const base = { kind: "products" as const, query };
      try {
        yield { ...base, products: [], sources: [], stage: "Searching shops and reviews" };
        const res = await exaSearch(
          {
            query: `${query}, product pages with current price`,
            objective: "Product listing pages and trusted reviews that state the current price, key specs and rating. Skip forums and outdated pages.",
            numResults: 10,
            includeDomains: shops?.length ? shops : undefined,
            userLocation: ctx.country,
            contents: { highlights: { maxCharacters: 700 }, extras: { imageLinks: 2 } },
          },
          { meter: ctx.meter, signal: abortSignal },
        );
        if (res.results.length === 0) {
          yield { ...base, products: [], sources: [], error: "No products found. Try describing it differently." };
          return;
        }

        const allSources = res.results.map((r) => toSource(r));
        const stage = `Comparing prices and specs from ${res.results.length} pages`;
        yield { ...base, products: [], sources: allSources, stage };

        const listing = res.results
          .map((r, i) => {
            const entity = r.entities?.find((e) => e.type === "product");
            const record = entity ? `\nStructured record: ${clip(JSON.stringify(entity.properties), 700)}` : "";
            return `[${i + 1}] ${r.title ?? ""}\n${r.url}\n${(r.highlights ?? []).map((h) => clip(h, 650)).join("\n")}${record}`;
          })
          .join("\n\n");
        const stream = streamText({
          model: ctx.worker.model,
          providerOptions: extractionProviderOptions(ctx.worker.info),
          output: Output.object({ schema: extraction }),
          abortSignal,
          prompt:
            `A shopper asked: "${query}". Today is ${ctx.today}.\n\n` +
            "From the search results below, pick up to 5 distinct products that match the request and line them up for comparison. " +
            "One entry per product model; when the same model appears in several shops, use the result with the best stated price. " +
            "Use only facts stated in the results. Leave price out when none is stated. Keep every value short.\n\n" +
            listing,
        });

        // Show each product as soon as the worker has finished writing it.
        let shown = 0;
        for await (const partial of stream.partialOutputStream) {
          const drafts = (partial.products ?? []) as Draft[];
          // The last entry may still be mid-sentence: only the ones before it are complete.
          const complete = drafts.slice(0, Math.max(0, drafts.length - 1));
          if (complete.length > shown) {
            shown = complete.length;
            const products = complete.map((d, i) => toProduct(d, res.results, i)).filter((p): p is Product => p !== null);
            yield { ...base, products, sources: allSources, stage };
          }
        }
        const output = await stream.output;
        ctx.meter.addWorker(ctx.worker.info.id, await stream.totalUsage);

        const products = output.products.map((d, i) => toProduct(d, res.results, i)).filter((p): p is Product => p !== null);
        const priced = products.filter((p) => typeof p.price === "number");
        if (priced.length > 1) priced.reduce((a, b) => (b.price! < a.price! ? b : a)).tag = "Lowest price";
        const used = new Set(products.map((p) => p.url));
        yield {
          ...base,
          products,
          verdict: output.verdict,
          sources: res.results.filter((r) => used.has(r.url)).map((r) => toSource({ ...r, snippet: clip(r.highlights?.[0], 240) || undefined })),
          exaCostUsd: res.costDollars?.total,
          error: products.length === 0 ? "Could not find matching products with enough detail." : undefined,
        };
      } catch (err) {
        yield { ...base, products: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.stage) return { type: "text", value: "Searching products." };
      if (output.error) return { type: "text", value: output.error };
      const lines = output.products.map(
        (p, i) => `${i + 1}. ${p.title}: ${p.price !== undefined ? `${p.price} ${p.currency ?? ""}` : "price not stated"} at ${p.merchant}${p.rating ? `, ${p.rating}/5` : ""}${p.note ? `. ${p.note}` : ""} (${p.url})`,
      );
      return {
        type: "text",
        value:
          `These ${output.products.length} products are now shown to the user as cards with a compare view. Do not repeat the list. ` +
          `Give your recommendation in two or three sentences.\nVerdict so far: ${output.verdict ?? ""}\n\n${lines.join("\n")}`,
      };
    },
  });
}

/** "www.verkkokauppa.com" to "Verkkokauppa.com"; known shops get their proper names. */
function merchantName(url: string): string {
  const domain = domainOf(url);
  const known: Record<string, string> = {
    "amazon.com": "Amazon",
    "amazon.de": "Amazon.de",
    "amazon.co.uk": "Amazon UK",
    "bestbuy.com": "Best Buy",
    "walmart.com": "Walmart",
    "verkkokauppa.com": "Verkkokauppa.com",
    "gigantti.fi": "Gigantti",
    "power.fi": "Power",
    "ebay.com": "eBay",
    "target.com": "Target",
  };
  if (known[domain]) return known[domain];
  const name = domain.split(".").slice(0, -1).join(".") || domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
