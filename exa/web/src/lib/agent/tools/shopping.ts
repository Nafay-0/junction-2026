import "server-only";

import { generateText, Output, tool } from "ai";
import { z } from "zod";
import { exaSearch } from "@/lib/exa/client";
import { domainOf, toSource, type Product, type ProductsData } from "@/lib/widgets/types";
import { workerProviderOptions } from "../providers";
import { clip, errorMessage, type ToolContext } from "./context";
import { slug } from "./structured";

/*
 * Product search: Exa finds live shop and review pages (many carry a structured "product"
 * record with images), then the fast worker model reads the quoted passages and lines the
 * products up side by side. Prices are only taken from text Exa returned, never guessed.
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
        availability: z.string().optional().describe('For example "In stock", "Ships in 2 days".'),
        specs: z.array(z.object({ label: z.string(), value: z.string() })).max(5).describe("The specs that matter for this kind of product, same labels across products where possible."),
        note: z.string().optional().describe("One short sentence: who this is best for."),
      }),
    )
    .max(6),
  verdict: z.string().describe("One or two sentences recommending a choice for this request."),
});

export function searchProductsTool(ctx: ToolContext) {
  return tool({
    description:
      "Find products to buy and compare them: shows product cards with photos, prices, shops and ratings, plus a side-by-side spec comparison. " +
      "Use it for shopping questions, price checks and 'which one should I buy'.",
    inputSchema: z.object({
      query: z.string().describe('What to buy and the constraints, for example "noise-cancelling over-ear headphones under 300 EUR".'),
      shops: z.array(z.string()).max(12).optional().describe('Shop domains to search, when the user wants specific shops or a country, for example ["verkkokauppa.com","gigantti.fi","power.fi"].'),
    }),
    async *execute({ query, shops }, { abortSignal }): AsyncGenerator<ProductsData, ProductsData> {
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
            contents: { highlights: { maxCharacters: 900 }, extras: { imageLinks: 2 } },
          },
          { meter: ctx.meter, signal: abortSignal },
        );
        if (res.results.length === 0) return { ...base, products: [], sources: [], error: "No products found. Try describing it differently." };

        yield { ...base, products: [], sources: res.results.map((r) => toSource(r)), stage: `Comparing prices and specs from ${res.results.length} pages` };

        const listing = res.results
          .map((r, i) => {
            const entity = r.entities?.find((e) => e.type === "product");
            const record = entity ? `\nStructured record: ${clip(JSON.stringify(entity.properties), 900)}` : "";
            return `[${i + 1}] ${r.title ?? ""}\n${r.url}\n${(r.highlights ?? []).map((h) => clip(h, 800)).join("\n")}${record}`;
          })
          .join("\n\n");
        const { output, usage } = await generateText({
          model: ctx.worker.model,
          providerOptions: workerProviderOptions(ctx.worker.info),
          output: Output.object({ schema: extraction }),
          abortSignal,
          prompt:
            `A shopper asked: "${query}". Today is ${ctx.today}.\n\n` +
            "From the search results below, pick up to 6 distinct products that match the request and line them up for comparison. " +
            "One entry per product model; when the same model appears in several shops, use the result with the best stated price. " +
            "Use only facts stated in the results. Leave price out when none is stated.\n\n" +
            listing,
        });
        ctx.meter.addWorker(ctx.worker.info.id, usage);

        const products: Product[] = [];
        for (const p of output.products) {
          const r = res.results[p.resultIndex - 1];
          if (!r) continue;
          const entity = r.entities?.find((e) => e.type === "product");
          const entityImages = (entity?.properties as { images?: string[] } | undefined)?.images;
          const image = [entityImages?.[0], r.image, r.extras?.imageLinks?.[0]].find((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
          products.push({
            id: slug(p.title, products.length),
            title: p.title,
            brand: p.brand,
            image,
            price: p.price,
            currency: p.currency,
            merchant: merchantName(r.url),
            url: r.url,
            rating: p.rating,
            reviewCount: p.reviewCount,
            availability: p.availability,
            specs: p.specs,
            note: p.note,
          });
        }
        const priced = products.filter((p) => typeof p.price === "number");
        if (priced.length > 1) priced.reduce((a, b) => (b.price! < a.price! ? b : a)).tag = "Lowest price";
        const used = new Set(products.map((p) => p.url));
        return {
          ...base,
          products,
          verdict: output.verdict,
          sources: res.results.filter((r) => used.has(r.url)).map((r) => toSource({ ...r, snippet: clip(r.highlights?.[0], 240) })),
          exaCostUsd: res.costDollars?.total,
          error: products.length === 0 ? "Could not find matching products with enough detail." : undefined,
        };
      } catch (err) {
        return { ...base, products: [], sources: [], error: errorMessage(err) };
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
