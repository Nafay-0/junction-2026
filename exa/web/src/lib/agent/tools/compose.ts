import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { toSource, type ActionsData, type ComparisonData, type CustomBlock, type CustomData, type KeyFactsData, type PlanData } from "@/lib/widgets/types";

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

const HTML_LIMIT = 24_000;

/**
 * The open-ended widget. The model composes it from blocks when none of the fixed widgets fits:
 * charts, stat tiles, tables, lists and timelines, progress bars, images, buttons, and (as a last
 * resort) a sandboxed HTML fragment. One flat block shape with optional fields keeps the schema
 * acceptable to every model family; `normaliseBlocks` drops anything unusable.
 */
export function showWidgetTool() {
  const item = z.object({
    label: z.string(),
    value: z.string().optional().describe("stats: the number or short fact. list: text on the right (or the headline in a timeline). progress: text beside the bar."),
    detail: z.string().optional().describe("A second, quieter line."),
    href: z.string().optional().describe("A URL that makes the entry a link. Only URLs that tools returned."),
    trend: z.enum(["up", "down", "flat"]).optional().describe("stats: direction of change, drawn as an arrow. Green for up and red for down unless good says otherwise."),
    good: z.boolean().optional().describe("stats: set false when a rise is bad news (unemployment, prices, debt), true when a fall is good news, so the colour matches the meaning."),
    percent: z.number().optional().describe("progress: how full the bar is, 0 to 100."),
  });
  const block = z.object({
    type: z.enum(["text", "stats", "chart", "table", "list", "progress", "image", "buttons", "callout", "html"]),
    width: z.enum(["full", "half"]).optional().describe('"half" puts two consecutive blocks side by side on wide screens.'),
    title: z.string().optional().describe("A small heading above the block."),
    text: z.string().optional().describe("text: markdown. callout: one or two plain sentences."),
    tone: z.enum(["info", "success", "warning"]).optional().describe("callout: its colour."),
    items: z.array(item).max(24).optional().describe("stats, list, progress: the entries."),
    listStyle: z.enum(["bullets", "numbers", "checks", "timeline"]).optional().describe('list: "timeline" uses label as the date or step, value as the headline, detail as the description.'),
    chartType: z.enum(["pie", "donut", "bar", "stackedBar", "horizontalBar", "line", "area", "scatter", "radar"]).optional(),
    labels: z.array(z.string()).max(60).optional().describe("chart: slice names for pie and donut, x-axis labels otherwise (for scatter, the x values as numbers in strings)."),
    series: z
      .array(z.object({ name: z.string(), values: z.array(z.number()).describe("One number per label, in the same order.") }))
      .max(8)
      .optional()
      .describe("chart: the data. Pie and donut use the first series only."),
    unit: z.string().optional().describe('chart: unit shown with values, for example "€", "%", "km".'),
    columns: z.array(z.string()).max(8).optional().describe("table: header cells."),
    rows: z.array(z.array(z.string())).max(60).optional().describe("table: body rows, each lined up with columns."),
    url: z.string().optional().describe("image: an https image address that a tool returned."),
    caption: z.string().optional().describe("image: a line under it."),
    buttons: z
      .array(
        z.object({
          label: z.string(),
          action: z.enum(["link", "ask", "copy"]).describe('"link" opens value (a URL). "ask" sends value to you as the user\'s next message, so write it as the user would. "copy" copies value.'),
          value: z.string(),
          primary: z.boolean().optional(),
        }),
      )
      .max(6)
      .optional(),
    html: z
      .string()
      .optional()
      .describe(
        "html: a self-contained fragment (markup, a <style> and a <script> if needed; no <html> or <body>) for something no other block can express, such as a calculator or a custom diagram. " +
          "It runs in a sandboxed frame with no network access: no external scripts, fonts, images over http, or fetch. Use inline SVG or canvas and plain JavaScript. " +
          "Style with the provided CSS variables (--foreground, --muted-foreground, --card, --border, --brand, --brand-soft, --primary, --primary-foreground, --up, --down, --chart-1 to --chart-5, --radius) " +
          "and helper classes (.btn, .btn-primary, .card, .muted, .row, .grid) so it matches the app in light and dark themes; never hard-code colours. " +
          "window.hovi.ask(text) sends text to you as the user's next message, hovi.open(url) opens a page, hovi.copy(text) copies. Keep it under 150 lines.",
      ),
    height: z.number().optional().describe("html: starting height in pixels."),
  });
  return tool({
    description:
      "Show a custom widget that you compose from blocks, for anything the other tools do not cover: a pie or bar chart of numbers you found, a small dashboard, a timeline, a ranked list with links, a checklist, a table, buttons for next steps, or (with an html block) something interactive such as a calculator. " +
      "Use the specialised tools first when one fits (places, flights, hotels, products, stocks, prediction markets, images, weather, comparison, key facts). " +
      "Blocks render in order; give two related blocks width 'half' to sit side by side (a chart next to its key numbers). Three to six blocks is usually right. " +
      "Use only data you found or the user gave; cite it with sourceUrls. Prefer chart, stats, table and list blocks over html: they are faster and always look right. " +
      "Buttons with action 'ask' let the user continue with one tap ('Compare with last year', 'Find cheaper options').",
    inputSchema: z.object({
      title: z.string().describe("A short title, a few words."),
      subtitle: z.string().optional().describe("One line of context: the period, the place, what the numbers are."),
      blocks: z.array(block).min(1).max(10),
      sourceUrls,
    }),
    execute: async ({ sourceUrls: urls, ...input }): Promise<CustomData> => ({
      kind: "custom",
      title: input.title,
      subtitle: input.subtitle,
      blocks: normaliseBlocks(input.blocks as CustomBlock[]),
      sources: (urls ?? []).map((url) => toSource({ url })),
    }),
    toModelOutput: () => ({ type: "text", value: "The widget is shown to the user. Do not repeat its contents; add at most two sentences of judgement or next step." }),
  });
}

/** Keep only blocks that have what their type needs, and trim what could hurt (oversized HTML, unsafe links). */
export function normaliseBlocks(blocks: CustomBlock[]): CustomBlock[] {
  const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);
  const out: CustomBlock[] = [];
  for (const b of blocks ?? []) {
    if (!b || typeof b.type !== "string") continue;
    const items = (b.items ?? []).filter((i) => i && typeof i.label === "string").map((i) => ({ ...i, href: safeUrl(i.href) }));
    switch (b.type) {
      case "text":
      case "callout":
        if (b.text?.trim()) out.push({ type: b.type, width: b.width, title: b.title, text: b.text, tone: b.tone });
        break;
      case "stats":
      case "list":
      case "progress":
        if (items.length) out.push({ type: b.type, width: b.width, title: b.title, items, listStyle: b.listStyle });
        break;
      case "chart": {
        const labels = (b.labels ?? []).map(String);
        const series = (b.series ?? [])
          .filter((s) => s && Array.isArray(s.values))
          .map((s) => ({ name: String(s.name ?? ""), values: s.values.slice(0, labels.length).map((v) => (Number.isFinite(v) ? v : 0)) }));
        if (b.chartType && labels.length && series.some((s) => s.values.length)) out.push({ type: "chart", width: b.width, title: b.title, chartType: b.chartType, labels, series, unit: b.unit });
        break;
      }
      case "table":
        if (b.columns?.length && b.rows?.length) out.push({ type: "table", width: b.width, title: b.title, columns: b.columns, rows: b.rows.map((r) => b.columns!.map((_, i) => String(r?.[i] ?? ""))) });
        break;
      case "image":
        if (safeUrl(b.url)) out.push({ type: "image", width: b.width, title: b.title, url: b.url, caption: b.caption });
        break;
      case "buttons": {
        const buttons = (b.buttons ?? []).filter((x) => x && x.label && x.value && (x.action !== "link" || safeUrl(x.value)));
        if (buttons.length) out.push({ type: "buttons", width: b.width, title: b.title, buttons });
        break;
      }
      case "html":
        if (b.html?.trim()) out.push({ type: "html", width: b.width, title: b.title, html: b.html.slice(0, HTML_LIMIT), height: b.height });
        break;
    }
  }
  return out;
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

/**
 * Answered in the browser: shows a card that asks to share the exact location. Accepting makes the
 * browser show its own permission prompt (if it has not been allowed before); the position is then
 * saved in the browser and sent with every later message.
 */
export function requestLocationTool() {
  return tool({
    description:
      "Ask the user to share their exact location through the browser. Use it when the task depends on exactly where they are and you only have an approximate place: " +
      "'near me', 'closest', 'within walking distance', 'how do I get there from here'. Do not use it when they named a place, or when the context already gives their exact location. " +
      "If they decline or the browser blocks it, carry on with the approximate place (or the place they typed) and say which place you assumed.",
    inputSchema: z.object({
      reason: z.string().describe("One short sentence telling the user what you will use it for, for example 'to find cafes within walking distance of you'."),
    }),
    outputSchema: z.union([
      z.object({
        status: z.literal("granted"),
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().optional(),
        label: z.string().optional(),
        country: z.string().optional(),
        at: z.number(),
      }),
      z.object({ status: z.enum(["denied", "unavailable", "declined"]), place: z.string().optional() }),
    ]),
    toModelOutput: ({ output }) => {
      if (output.status === "granted") {
        return {
          type: "text",
          value:
            `The user shared their exact location: ${output.label ?? "unnamed place"} (${output.lat.toFixed(5)}, ${output.lng.toFixed(5)}` +
            `${output.accuracyM ? `, accurate to about ${output.accuracyM} m` : ""}). It is saved for the rest of this conversation. ` +
            'For places around them, call findPlaces with near set to "near me".',
        };
      }
      const why = output.status === "denied" ? "The user or their browser did not allow location access." : output.status === "unavailable" ? "The device could not determine a location." : "The user chose not to share their location.";
      return {
        type: "text",
        value: `${why} ${output.place ? `Use this place instead: ${output.place}.` : "Carry on with the approximate place from the context and say which place you assumed."} Do not ask for location again.`,
      };
    },
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
