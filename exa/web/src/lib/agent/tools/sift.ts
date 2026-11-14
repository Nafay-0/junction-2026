import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { decide, decisionsConfigured, type ChoiceAnswer, type DecisionQuestion, type YesNoAnswer } from "@/lib/decisions/client";
import { exaSearch, type ExaResult } from "@/lib/exa/client";
import { SIFT_SURE, toSource, type SiftData, type SiftItem, type SiftVerdict } from "@/lib/widgets/types";
import { clip, errorMessage, type ToolContext } from "./context";

/*
 * Sift: find the ones that fit. Exa returns dozens of pages in one search, each with its text;
 * Gemini's decision model then checks every page against every wish in a single request and
 * about a second, where an agent reading pages one by one would manage four or five. The result
 * is a grid: one row per page, one column per wish, each cell a yes, a no or "does not say",
 * with how sure the judge is.
 *
 * The judge only ever sees what Exa returned for a page, and it answers with probabilities, not
 * words: it cannot invent a fact, only say whether the page states one.
 */

/** Pages checked in one sift: enough to be worth sifting, few enough to stay at a few cents on Exa. */
const USUAL_PAGES = 40;
const THOROUGH_PAGES = 100;
/** What each page contributes: its opening, plus the passages Exa finds further down that bear on the wishes. */
const OPENING_CHARS = 1800;
const PASSAGE_CHARS = 1400;
/** A page with less than this to read cannot be judged. */
const MIN_CHARS = 200;
const RECENCY_DAYS = { day: 1, week: 7, month: 31, year: 366 } as const;

const ANSWERS = {
  yes: "The page says so, or clearly implies it",
  no: "The page says otherwise",
  unknown: "The page does not give enough information to tell",
} as const;

type Wish = { label: string; test: string };

/** The same page under two addresses counts once. */
const pageKey = (url: string) => url.replace(/#.*$/, "").replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");

const readable = (r: ExaResult) => `${r.text ?? ""} ${(r.highlights ?? []).join(" ")}`.replace(/\s+/g, " ").trim();

/** One page as the judge reads it. */
function pageText(r: ExaResult, n: number): string {
  const opening = clip((r.text ?? "").replace(/\s+/g, " "), OPENING_CHARS);
  const passages = (r.highlights ?? []).map((h) => `- ${clip(h.replace(/\s+/g, " "), PASSAGE_CHARS)}`).join("\n");
  return `[Page ${n}] ${r.title ?? ""}\n${r.url}\n${opening}${passages ? `\nPassages from further down the page:\n${passages}` : ""}`;
}

function verdictOf(answer: ChoiceAnswer | undefined): SiftVerdict {
  if (!answer || answer.type !== "choice") return { answer: "unknown", confidence: 0 };
  const choice = answer.choice === "yes" || answer.choice === "no" ? answer.choice : "unknown";
  return { answer: choice, confidence: Math.round(answer.confidence * 100) / 100 };
}

const metCount = (item: SiftItem) => (item.verdicts ?? []).filter((v) => v.answer === "yes").length;

/** "yes", "probably yes (61%)", "no", "not stated": how a verdict reads to the model. */
function verdictWords(v: SiftVerdict): string {
  if (v.answer === "unknown") return "not stated";
  return v.confidence >= SIFT_SURE ? v.answer : `probably ${v.answer} (${Math.round(v.confidence * 100)}%)`;
}

export function siftTool(ctx: ToolContext) {
  return tool({
    description:
      "Find the ones that fit: reads dozens of web pages at once and checks every one against every wish the user has, then shows a grid of which pages meet which wishes. " +
      "Use it when the user wants things that must meet several conditions and each candidate has a page of its own that states the facts: recipes, job ads, flats and other listings, product reviews, courses, events, studies and papers, grants, tools. " +
      "It checks about 40 pages in the time you could read one, so prefer it to searching and reading page by page whenever the request is 'find me … that …'. " +
      "Not for places to go (findPlaces knows opening hours), flights, hotels or shop prices, and not for a single fact.",
    inputSchema: z.object({
      title: z.string().describe('A short title for the grid, in the user\'s language: "Chickpea dinners that fit".'),
      what: z
        .string()
        .describe('What one result should be, singular, in a few words: "a recipe", "a job ad", "a hands-on review of one robot vacuum", "a listing for one flat to rent", "a study". Pages that are something else (lists, shop fronts, home pages) are left out.'),
      queries: z
        .array(z.string())
        .min(1)
        .max(3)
        .describe("One to three descriptions of the pages to find, each worded differently to cast a wider net. Describe the pages (subject, kind of page, time period), not keywords. Do not put the wishes in as must-haves: the sift checks those."),
      wishes: z
        .array(
          z.object({
            label: z.string().describe('The column heading, two or three words, in the user\'s language: "Under 30 min", "No nuts", "Remote".'),
            test: z
              .string()
              .describe(
                'One statement, in English, that is true or false of a single page, starting with the thing itself and giving numbers: "the recipe takes 30 minutes or less from start to finish", "the job can be done fully remotely". One condition per wish.',
              ),
          }),
        )
        .min(1)
        .max(6)
        .describe("What the user wants, one condition each. Include only what they asked for or clearly need."),
      category: z.enum(["news", "company", "people", "publication", "personal site", "financial report"]).optional().describe('Only for those kinds of page: "publication" for studies and papers.'),
      includeDomains: z.array(z.string()).max(20).optional().describe("Only search these sites."),
      recency: z.enum(["day", "week", "month", "year"]).optional().describe("Only pages published within this window, for things that go out of date: job ads, events, listings."),
      thorough: z.boolean().optional().describe("Check about 100 pages instead of about 40. Use it when the user asks for all of them, or when a first sift found too few that fit."),
    }),
    // Each `yield` replaces what the widget shows; the last value yielded is the tool's result.
    async *execute(input, { abortSignal }): AsyncGenerator<SiftData> {
      const wishes: Wish[] = input.wishes.map((w) => ({ label: w.label.trim(), test: w.test.trim().replace(/[.?!]+$/, "") }));
      const base = { kind: "sift" as const, title: input.title, what: input.what, wishes };
      try {
        yield { ...base, items: [], checked: 0, sources: [], stage: "Searching the live web" };

        // Differently worded searches find many of the same pages, so each asks for more than its share
        // and the surplus is cut after the doubles are gone.
        const limit = input.thorough ? THOROUGH_PAGES : USUAL_PAGES;
        const perQuery = Math.min(100, Math.ceil((limit / input.queries.length) * (input.queries.length > 1 ? 1.5 : 1)));
        const dated = input.recency && input.category !== "company" && input.category !== "people";
        const searches = await Promise.allSettled(
          input.queries.map((query) =>
            exaSearch(
              {
                query,
                objective: `Pages that are each ${input.what}. Leave out lists, round-ups, category pages and home pages.`,
                numResults: perQuery,
                category: input.category,
                includeDomains: input.includeDomains?.length ? input.includeDomains : undefined,
                startPublishedDate: dated ? new Date(Date.now() - RECENCY_DAYS[input.recency!] * 86_400_000).toISOString() : undefined,
                userLocation: ctx.country,
                // The opening of each page, plus the passages that bear on the wishes wherever they are on the page.
                contents: { text: { maxCharacters: OPENING_CHARS }, highlights: { query: wishes.map((w) => w.test).join("; "), maxCharacters: PASSAGE_CHARS } },
              },
              { meter: ctx.meter, signal: abortSignal },
            ),
          ),
        );
        // Taken in turn from each search, so every wording contributes its best pages before any is cut.
        const lists = searches.map((s) => (s.status === "fulfilled" ? s.value.results : []));
        const found: ExaResult[] = [];
        for (let rank = 0; rank < perQuery; rank++) for (const list of lists) if (list[rank]) found.push(list[rank]);
        const exaCostUsd = Math.round(searches.reduce((sum, s) => sum + (s.status === "fulfilled" ? (s.value.costDollars?.total ?? 0) : 0), 0) * 1e5) / 1e5;
        if (found.length === 0) {
          const failed = searches.find((s) => s.status === "rejected");
          yield { ...base, items: [], checked: 0, sources: [], error: failed ? errorMessage((failed as PromiseRejectedResult).reason) : "Nothing was found. Try describing it differently." };
          return;
        }

        // One entry per page, and only pages with something to read.
        const seen = new Set<string>();
        let unreadable = 0;
        const pages = found
          .filter((r) => {
            const key = pageKey(r.url);
            if (seen.has(key)) return false;
            seen.add(key);
            if (readable(r).length >= MIN_CHARS) return true;
            unreadable += 1;
            return false;
          })
          .slice(0, limit);
        const asItem = (r: ExaResult): SiftItem => ({ ...toSource({ url: r.url, title: r.title, publishedDate: r.publishedDate, snippet: clip(r.highlights?.[0], 240) || undefined }), image: r.image ?? undefined });
        const listed = pages.map(asItem);
        if (pages.length === 0) {
          yield { ...base, items: [], checked: 0, sources: [], exaCostUsd, error: "The pages that were found had nothing to read. Try describing it differently." };
          return;
        }

        const checks = pages.length * wishes.length;
        yield { ...base, items: listed, checked: pages.length, sources: listed.slice(0, 12), exaCostUsd, stage: `Checking ${pages.length} pages against ${wishes.length === 1 ? "your wish" : `${wishes.length} wishes`}` };

        if (!decisionsConfigured()) {
          yield { ...base, items: listed, checked: pages.length, sources: listed, exaCostUsd, unjudged: "These pages were found but could not be checked against your wishes: the decision model is not set up on this server." };
          return;
        }

        // One request: every page in the shared input, and one question per page and wish.
        const questions: Record<string, DecisionQuestion> = {};
        pages.forEach((_, i) => {
          const n = i + 1;
          questions[`p${n}_is`] = {
            type: "noul",
            instructions: `Look only at Page ${n}. Is that page itself ${input.what}, with real content about it?`,
            criteria: { true_description: `The page is about one specific ${bare(input.what)} and says something about it`, false_description: "The page is a list or round-up of several, a category, search or home page, an error page, or has no real content" },
          };
          wishes.forEach((wish, w) => {
            questions[`p${n}_w${w}`] = { type: "choice", instructions: `Look only at Page ${n}. According to that page, is it true that ${wish.test}?`, criteria: ANSWERS };
          });
        });

        let judged: Awaited<ReturnType<typeof decide>>;
        try {
          judged = await decide(pages.map((r, i) => pageText(r, i + 1)).join("\n\n"), questions, { meter: ctx.meter, signal: abortSignal });
        } catch (err) {
          if (abortSignal?.aborted) throw err;
          yield { ...base, items: listed, checked: pages.length, sources: listed, exaCostUsd, unjudged: `These pages were found but could not be checked against your wishes. ${errorMessage(err)}` };
          return;
        }

        // Best fit first: most wishes met, then the surest. Pages that are not one such thing are left out.
        const rows = pages
          .map((r, i) => {
            const n = i + 1;
            const is = judged.answers[`p${n}_is`] as YesNoAnswer | undefined;
            const answers = wishes.map((_, w) => judged.answers[`p${n}_w${w}`] as ChoiceAnswer | undefined);
            const item: SiftItem = { ...listed[i], verdicts: answers.map(verdictOf) };
            const fit = answers.reduce((sum, a) => sum + (a?.probabilities?.yes ?? 0), 0);
            return { item, fit, isOne: (is?.noul ?? 1) >= 0.5, rank: i };
          })
          .sort((a, b) => metCount(b.item) - metCount(a.item) || b.fit - a.fit || a.rank - b.rank);
        const kept = rows.filter((row) => row.isOne);
        // If nearly nothing passes as "one such thing", the description of the thing was off, not the pages: show them all.
        const items = (kept.length >= 3 ? kept : rows).map((row) => row.item);

        yield {
          ...base,
          items,
          checked: pages.length,
          skipped: pages.length - items.length + unreadable || undefined,
          judgements: checks + pages.length,
          judgedMs: judged.ms,
          sources: items,
          exaCostUsd,
        };
      } catch (err) {
        yield { ...base, items: [], checked: 0, sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.stage) return { type: "text", value: "Sifting." };
      if (output.error) return { type: "text", value: `The sift found nothing to show: ${output.error}` };
      if (output.unjudged) {
        const lines = output.items.slice(0, 10).map((item, i) => `${i + 1}. ${item.title ?? item.domain} (${item.url})`);
        return { type: "text", value: `${output.unjudged} They are shown to the user as a plain list. Read the most promising ones with readPages if the wishes matter.\n\n${lines.join("\n")}` };
      }
      const all = output.wishes.length;
      const fits = output.items.filter((item) => metCount(item) === all);
      const near = output.items.filter((item) => metCount(item) === all - 1);
      const lines = output.items.slice(0, 10).map((item, i) => {
        const cells = output.wishes.map((wish, w) => `${wish.label}: ${verdictWords(item.verdicts?.[w] ?? { answer: "unknown", confidence: 0 })}`);
        return `${i + 1}. ${item.title ?? item.domain} (${item.url})\n   ${cells.join("; ")}`;
      });
      return {
        type: "text",
        value:
          `Checked ${output.checked} pages against ${all} ${all === 1 ? "wish" : "wishes"}${output.judgedMs ? ` in ${(output.judgedMs / 1000).toFixed(1)} seconds` : ""}. ` +
          `${fits.length} meet every wish${all > 1 ? `; ${near.length} miss exactly one` : ""}. ` +
          "The grid is now on the user's screen, best fit first, with every page linked: do not list it again. " +
          "Say in two or three sentences how many pages were checked and how many fit, which one you would pick and why, and what the near misses lack. " +
          '"Not stated" means the page does not say, not that the answer is no: say so rather than guess, and read that page with readPages if it decides the matter. ' +
          "A verdict marked probably is not certain; do not present it as a fact.\n\n" +
          `Best fits:\n${lines.join("\n")}`,
      };
    },
  });
}

/** "a recipe" to "recipe": the thing without its article. */
function bare(what: string): string {
  return what.trim().replace(/^(an?|the|one)\s+/i, "");
}
