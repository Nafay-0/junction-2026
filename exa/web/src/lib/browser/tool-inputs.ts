import { z } from "zod";

/*
 * What the agent's browser tools take. One definition, used twice: by the server, which shows it
 * to the model, and by the desktop app, which checks every step it is handed before taking it.
 */

export const browserOpenInput = z.object({
  url: z.string().describe("The address to open: one a tool returned or the user gave, or a site's home page when you need to find your way from there."),
  fresh: z.boolean().optional().describe("True when this starts a different task from the one the browser was last used for: tabs left over from that task are closed first."),
});

export const browserActInput = z.object({
  action: z.enum(["click", "type", "select", "press", "scroll", "hover", "back", "wait"]),
  ref: z.string().optional().describe('The reference of the element, from the latest page text, for example "e12". Needed for click, type, select and hover; optional for press and scroll.'),
  text: z
    .string()
    .optional()
    .describe("type: the text to enter. select: the option to choose, exactly as listed. press: the key (Enter, Escape, Tab, ArrowDown, ArrowUp, PageDown, PageUp, Backspace)."),
  submit: z.boolean().optional().describe("type: press Enter after typing. For search boxes."),
  direction: z.enum(["up", "down"]).optional().describe("scroll: which way. Default down."),
  seconds: z.number().optional().describe("wait: how long, 1 to 10 seconds. For pages that are still loading results."),
  commits: z
    .boolean()
    .optional()
    .describe(
      "Set true when this step submits, sends, books, reserves, orders, posts, deletes, signs up, accepts terms, or otherwise changes something on the user's behalf. The user is shown the step and must approve it before it happens.",
    ),
  summary: z
    .string()
    .optional()
    .describe("With commits: what exactly will happen and what will be sent, in one or two sentences the user can check at a glance: who, what, when, how many, which contact details, what it costs."),
});

export const browserReadInput = z.object({
  scope: z.enum(["view", "page"]).optional().describe('"view": what is on screen now (default). "page": the whole page, top to bottom.'),
  find: z.string().optional().describe("Only the lines that mention this phrase, wherever they are on the page."),
});

export const browserLookInput = z.object({
  why: z.string().optional().describe("A few words on what you need to see."),
});

export const browserCloseInput = z.object({
  reason: z.string().optional().describe("A few words on why: 'the reservation is confirmed', 'you asked me to'."),
});

export const requestUserActionInput = z.object({
  kind: z.enum(["login", "captcha", "verification", "payment", "other"]),
  reason: z.string().describe('One plain sentence addressed to the user: "Sign in to your TableOnline account so I can book under your name."'),
  site: z.string().optional().describe('The site it concerns, for example "tableonline.fi".'),
});

/** What the interface may ask of the browser on the user's behalf. */
export const controlRequestInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("forward") }),
  z.object({ action: z.literal("reload") }),
  z.object({ action: z.literal("navigate"), url: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("visit"), url: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("tab"), tabId: z.string().max(40) }),
  z.object({ action: z.literal("fit"), width: z.number().min(100).max(10_000), height: z.number().min(100).max(10_000) }),
  z.object({ action: z.literal("approval"), toolCallId: z.string().min(1).max(200), approved: z.boolean() }),
  z.object({ action: z.literal("close") }),
]);
