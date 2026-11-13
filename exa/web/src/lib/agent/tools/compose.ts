import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { toSource, type ActionsData, type ComparisonData, type KeyFactsData, type PlanData } from "@/lib/widgets/types";

/*
 * Widgets the model composes itself from what it has already found, and the two tools that
 * shape the conversation: a visible plan, and clarifying questions answered in the browser.
 */

const sourceUrls = z.array(z.string().url()).max(8).optional().describe("URLs of the pages this is based on. Only URLs that tools returned.");
const shown = { type: "text" as const, value: "Shown to the user. Do not repeat its contents in your text." };

export function showComparisonTool() {
  return tool({
    description:
      "Show a side-by-side comparison table of two to five options across the criteria that matter. Use it when the user is choosing between things and the differences fit a table. " +
      "Fill it only with facts you found; write 'Not stated' when a source did not say.",
    inputSchema: z.object({
      title: z.string(),
      columns: z.array(z.string()).min(2).max(5).describe("The options being compared."),
      rows: z
        .array(z.object({ label: z.string().describe("The criterion."), values: z.array(z.string()).describe("One short value per column, in column order.") }))
        .min(2)
        .max(10),
      winner: z.number().int().min(0).optional().describe("Index of the column you recommend, if you recommend one."),
      note: z.string().optional().describe("One sentence explaining the recommendation or a caveat."),
      sourceUrls,
    }),
    execute: async ({ sourceUrls: urls, ...input }): Promise<ComparisonData> => ({
      kind: "comparison",
      ...input,
      rows: input.rows.map((r) => ({ ...r, values: input.columns.map((_, i) => r.values[i] ?? "Not stated") })),
      sources: (urls ?? []).map((url) => toSource({ url })),
    }),
    toModelOutput: () => shown,
  });
}

export function showKeyFactsTool() {
  return tool({
    description:
      "Show the handful of numbers and facts that answer the question as stat tiles: amounts, dates, deadlines, limits, fees. Use it when the answer comes down to three to eight specific facts. Give each fact the URL it came from.",
    inputSchema: z.object({
      title: z.string(),
      facts: z
        .array(
          z.object({
            label: z.string().describe("What the fact is, a few words."),
            value: z.string().describe("The fact itself, short: a number with its unit, a date, a yes or no."),
            detail: z.string().optional().describe("One short clarifying line: who it applies to, since when."),
            sourceUrl: z.string().url().optional(),
          }),
        )
        .min(2)
        .max(8),
    }),
    execute: async (input): Promise<KeyFactsData> => {
      const urls = [...new Set(input.facts.map((f) => f.sourceUrl).filter((u): u is string => !!u))];
      return { kind: "facts", ...input, sources: urls.map((url) => toSource({ url })) };
    },
    toModelOutput: () => shown,
  });
}

export function showActionsTool() {
  return tool({
    description:
      "Finish a task by showing the next steps as buttons with real links behind them: book, call, get directions, email a drafted message, add to calendar, open the official form. " +
      "This is how you get a task as close to done as possible: the user only has to tap. Use it at the end of any answer that has a concrete next step. " +
      "Links: https pages from your tool results; tel: for phone numbers; mailto: with a prefilled subject and body for drafted emails (URL-encode them); " +
      "https://www.google.com/maps/dir/?api=1&destination=LAT,LNG for directions; " +
      "https://calendar.google.com/calendar/render?action=TEMPLATE&text=TITLE&dates=YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS&details=DETAILS&location=PLACE for calendar events.",
    inputSchema: z.object({
      title: z.string().optional().describe('A short heading, for example "Ready when you are".'),
      actions: z
        .array(
          z.object({
            label: z.string().describe("Starts with a verb: 'Book a table at Grön'."),
            description: z.string().optional().describe("One short line: what happens when they tap."),
            type: z.enum(["link", "book", "call", "email", "directions", "calendar", "download"]),
            href: z.string().describe("The link. Never invent a URL."),
            primary: z.boolean().optional().describe("True for the one main action."),
          }),
        )
        .min(1)
        .max(6),
    }),
    execute: async (input): Promise<ActionsData> => ({
      kind: "actions",
      title: input.title,
      actions: input.actions.filter((a) => /^(https?:|tel:|mailto:)/i.test(a.href)),
      sources: [],
    }),
    toModelOutput: () => ({ type: "text", value: "The action buttons are shown. End your turn with at most one short sentence." }),
  });
}

export function updatePlanTool() {
  return tool({
    description:
      "Show or update your plan for a task with several steps, so the user can follow along. Call it once at the start with every step (first step 'active', the rest 'pending'), " +
      "and again whenever a step finishes. Skip it for simple questions that take one or two tool calls.",
    inputSchema: z.object({
      steps: z
        .array(z.object({ title: z.string().describe("Short and concrete: 'Find direct flights for 5 to 8 December'."), status: z.enum(["pending", "active", "done"]) }))
        .min(2)
        .max(7),
    }),
    execute: async ({ steps }): Promise<PlanData> => ({ kind: "plan", steps }),
    toModelOutput: () => ({ type: "text", value: "Plan shown." }),
  });
}

/** Answered in the browser: there is no `execute`, so the run pauses until the user replies. */
export function askUserTool() {
  return tool({
    description:
      "Ask the user one to three quick questions before you start, when the answer changes what you would do and you cannot reasonably assume it: travel dates, budget, city, who it is for. " +
      "Offer two to five likely options per question so they can answer with a tap. Do not ask for things you can look up or sensibly assume; state the assumption instead. Ask at most once per task.",
    inputSchema: z.object({
      intro: z.string().optional().describe("One short line on why you are asking."),
      questions: z
        .array(
          z.object({
            id: z.string().describe("A short key, for example 'dates'."),
            question: z.string(),
            type: z.enum(["single", "multi", "text"]),
            options: z.array(z.object({ label: z.string(), description: z.string().optional() })).max(6).optional(),
            placeholder: z.string().optional(),
          }),
        )
        .min(1)
        .max(3),
    }),
    outputSchema: z.object({
      answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
      skipped: z.boolean().optional(),
    }),
  });
}
