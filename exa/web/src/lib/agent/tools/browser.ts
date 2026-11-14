import "server-only";

import { tool } from "ai";
import { z } from "zod";
import type { BrowserStepData } from "@/lib/browser/protocol";
import { browserFor, type ActInput, type BrowserSession } from "@/lib/browser/session";
import type { ToolContext } from "./context";

/*
 * The agent's hands: a real browser the user watches live. Exa finds things; these tools do
 * things with them (fill the booking form, put the product in the basket, go through the steps
 * of an application), up to the point where the user must decide.
 *
 * The safety rules are not in these descriptions: they are code (lib/browser/guard.ts) that every
 * step passes through. Payment and passwords are refused outright; anything that acts on the
 * user's behalf waits for their approval (the `toolApproval` policy in the chat route).
 */

const unavailable = (action: BrowserStepData["action"]): BrowserStepData => {
  const problem = "The live browser is not available in this session. Give the user links to finish the task themselves.";
  return { kind: "browser", label: "The live browser is not available", action, url: "", title: "", ok: false, problem, page: problem, sources: [] };
};

const session = (ctx: ToolContext): BrowserSession | null => (ctx.browserId ? browserFor(ctx.browserId) : null);

export function browserOpenTool(ctx: ToolContext) {
  return tool({
    description:
      "Open a web page in the live browser, which the user watches as you work. This is how you act on the web instead of only reading it: reserve a table, put a product in the basket, " +
      "start a booking, fill in a form or an application, do something in an account the user is signed in to. Find the right page first with the search tools, then open it here. " +
      "You get back the page as text: what is in view, with a reference like [e12] on everything you can act on. References are only good for the page text you saw last.",
    inputSchema: z.object({
      url: z.string().describe("The address to open: one a tool returned or the user gave, or a site's home page when you need to find your way from there."),
      fresh: z.boolean().optional().describe("True when this starts a different task from the one the browser was last used for: tabs left over from that task are closed first."),
    }),
    execute: async ({ url, fresh }, { abortSignal }): Promise<BrowserStepData> => session(ctx)?.open(url, abortSignal, fresh === true) ?? unavailable("open"),
    toModelOutput: ({ output }) => ({ type: "text", value: output.page }),
  });
}

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

export function browserActTool(ctx: ToolContext) {
  return tool({
    description:
      "Take one step on the page open in the live browser: click, type into a field, choose from a list, press a key, scroll, go back, or wait. You get the page back as it stands after the step. " +
      "Work like a careful person: one step, look at the result, next step. Dismiss cookie banners by choosing only necessary cookies. " +
      "A step can be refused by a safety rule (payment, passwords, one-time codes): the reply says why, and you then hand the page to the user with requestUserAction instead of trying another way.",
    inputSchema: browserActInput,
    execute: async (input, { abortSignal, toolCallId }): Promise<BrowserStepData> => {
      const action = input.action === "back" ? "navigate" : input.action;
      return session(ctx)?.act(toolCallId, input as ActInput, abortSignal) ?? unavailable(action);
    },
    toModelOutput: ({ output }) => ({ type: "text", value: output.page }),
  });
}

export function browserReadTool(ctx: ToolContext) {
  return tool({
    description:
      "Read the page open in the live browser again without changing it. Every step already returns what is in view, so use this to read the whole page (results, prices, terms, a confirmation), " +
      "to look for a phrase anywhere on it, or after the user has had the page and handed it back.",
    inputSchema: z.object({
      scope: z.enum(["view", "page"]).optional().describe('"view": what is on screen now (default). "page": the whole page, top to bottom.'),
      find: z.string().optional().describe("Only the lines that mention this phrase, wherever they are on the page."),
    }),
    execute: async ({ scope, find }, { abortSignal }): Promise<BrowserStepData> =>
      session(ctx)?.read({ scope: find ? "page" : (scope ?? "view"), find }, abortSignal) ?? unavailable("read"),
    toModelOutput: ({ output }) => ({ type: "text", value: output.page }),
  });
}

export function browserLookTool(ctx: ToolContext) {
  return tool({
    description:
      "Look at the page open in the live browser as a picture. Use it only when the text you get back is not enough: the page is drawn as an image or a canvas (a seat map, a chart, a calendar), " +
      "a control does nothing and you cannot tell why, or you need to check how something looks. It is slower than reading, so do not use it as a routine step. You still act through references; the picture is for understanding.",
    inputSchema: z.object({
      why: z.string().optional().describe("A few words on what you need to see."),
    }),
    execute: async (_input, { abortSignal, toolCallId }): Promise<BrowserStepData> => session(ctx)?.look(toolCallId, abortSignal) ?? unavailable("read"),
    toModelOutput: ({ toolCallId, output }) => {
      // The picture is kept on the server for a few steps, never in the conversation the browser saves.
      const picture = session(ctx)?.picture(toolCallId);
      if (!picture) return { type: "text", value: output.ok ? output.page.replace(/^A picture of the page[^\n]*\n\n/, "(The picture taken here is no longer kept. Look again if you need it.)\n\n") : output.page };
      return {
        type: "content",
        value: [
          { type: "text", text: output.page },
          { type: "file", mediaType: "image/jpeg", data: { type: "data", data: picture } },
        ],
      };
    },
  });
}

export function browserCloseTool(ctx: ToolContext) {
  return tool({
    description:
      "Close the live browser. Do it as your last step when the task there is finished and nothing is left for the user to see or do on the page, and whenever the user asks you to close it. " +
      "Sign-ins are kept, so the next task starts signed in. Do not close it while the user still needs the page: a basket waiting for them to pay, a form they should check, a page you have handed over.",
    inputSchema: z.object({
      reason: z.string().optional().describe("A few words on why: 'the reservation is confirmed', 'you asked me to'."),
    }),
    execute: async (_input, { abortSignal }): Promise<BrowserStepData> => session(ctx)?.shut(abortSignal) ?? unavailable("close"),
    toModelOutput: ({ output }) => ({ type: "text", value: output.page }),
  });
}

/**
 * Answered in the interface: there is no `execute`, so the run pauses. The moment the model asks,
 * the browser is handed to the user (their mouse and keys reach the page, the agent's do not).
 */
export function requestUserActionTool(ctx: ToolContext) {
  return tool({
    description:
      "Hand the live browser to the user for something only they may do, and wait until they say they are done. Use it for: signing in (kind login), a CAPTCHA or 'are you human' check (captcha), " +
      "a code sent to their phone or email (verification), paying (payment), or anything else that needs them in person (other). " +
      "You never type passwords, codes or payment details and you never pay: this is how those steps get done. Say plainly in `reason` what you need them to do.",
    inputSchema: z.object({
      kind: z.enum(["login", "captcha", "verification", "payment", "other"]),
      reason: z.string().describe('One plain sentence addressed to the user: "Sign in to your TableOnline account so I can book under your name."'),
      site: z.string().optional().describe('The site it concerns, for example "tableonline.fi".'),
    }),
    outputSchema: z.object({
      status: z.enum(["done", "skipped"]),
      note: z.string().optional(),
    }),
    onInputAvailable: ({ input, toolCallId }) => {
      session(ctx)?.requestHandover({ kind: input.kind, reason: input.reason, site: input.site, toolCallId });
    },
    toModelOutput: ({ input, output }) => {
      if (output.status === "skipped") {
        return { type: "text", value: `The user chose not to do this${output.note ? ` ("${output.note}")` : ""}. Do not ask again. Finish what can be finished without it, or stop and say what is left for them to do.` };
      }
      if (input.kind === "payment") {
        return { type: "text", value: "The user has had the payment page and handed the browser back. Do not touch the payment. Read the page once with browserRead and tell them, in a sentence or two, where things stand." };
      }
      return { type: "text", value: `The user says they are done${output.note ? ` ("${output.note}")` : ""} and has handed the browser back. Read the page with browserRead to see where things stand, then carry on with the task.` };
    },
  });
}
