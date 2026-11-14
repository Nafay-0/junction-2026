import "server-only";

import { tool } from "ai";
import { z } from "zod";
import type { BrowserStepData } from "@/lib/browser/protocol";
import { browserActInput, browserCloseInput, browserLookInput, browserOpenInput, browserReadInput, requestUserActionInput } from "@/lib/browser/tool-inputs";

/*
 * The agent's hands: a real browser the user watches live. Exa finds things; these tools do
 * things with them (fill the booking form, put the product in the basket, go through the steps
 * of an application), up to the point where the user must decide.
 *
 * The browser is not on the server. It is a view inside the desktop app, on the user's computer,
 * so none of these tools has an `execute`: the run pauses, the interface hands the step to the
 * app, the app takes it and the result comes back with the next request. That is also where the
 * safety rules are applied (lib/browser/guard.ts, in code): payment and passwords are refused
 * outright, and anything that acts on the user's behalf waits for their yes, in the app, before
 * it is done. The web version does not get these tools at all (see createTools).
 */

/** What the app sends back for a step. Checked for shape only: the content is the app's own. */
const step = z.custom<BrowserStepData>((value) => typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "browser" && typeof (value as { page?: unknown }).page === "string");

const pageText = ({ output }: { output: BrowserStepData }) => ({ type: "text" as const, value: output.page });

export function browserOpenTool() {
  return tool({
    description:
      "Open a web page in the live browser, which the user watches as you work. This is how you act on the web instead of only reading it: reserve a table, put a product in the basket, " +
      "start a booking, fill in a form or an application, do something in an account the user is signed in to. Find the right page first with the search tools, then open it here. " +
      "You get back the page as text: what is in view, with a reference like [e12] on everything you can act on. References are only good for the page text you saw last.",
    inputSchema: browserOpenInput,
    outputSchema: step,
    toModelOutput: pageText,
  });
}

export function browserActTool() {
  return tool({
    description:
      "Take one step on the page open in the live browser: click, type into a field, choose from a list, press a key, scroll, go back, or wait. You get the page back as it stands after the step. " +
      "Work like a careful person: one step, look at the result, next step. Dismiss cookie banners by choosing only necessary cookies. " +
      "A step can be refused by a safety rule (payment, passwords, one-time codes): the reply says why, and you then hand the page to the user with requestUserAction instead of trying another way.",
    inputSchema: browserActInput,
    outputSchema: step,
    toModelOutput: pageText,
  });
}

export function browserReadTool() {
  return tool({
    description:
      "Read the page open in the live browser again without changing it. Every step already returns what is in view, so use this to read the whole page (results, prices, terms, a confirmation), " +
      "to look for a phrase anywhere on it, or after the user has had the page and handed it back.",
    inputSchema: browserReadInput,
    outputSchema: step,
    toModelOutput: pageText,
  });
}

export function browserLookTool() {
  return tool({
    description:
      "Look at the page open in the live browser as a picture. Use it only when the text you get back is not enough: the page is drawn as an image or a canvas (a seat map, a chart, a calendar), " +
      "a control does nothing and you cannot tell why, or you need to check how something looks. It is slower than reading, so do not use it as a routine step. You still act through references; the picture is for understanding.",
    inputSchema: browserLookInput,
    outputSchema: step,
    toModelOutput: ({ output }) => {
      // The picture travels with the step while the answer is being written. It is dropped when the conversation is saved.
      if (!output.picture) return { type: "text", value: output.ok ? output.page.replace(/^A picture of the page[^\n]*\n\n/, "(The picture taken here is no longer kept. Look again if you need it.)\n\n") : output.page };
      return {
        type: "content",
        value: [
          { type: "text", text: output.page },
          { type: "file", mediaType: "image/jpeg", data: { type: "data", data: output.picture } },
        ],
      };
    },
  });
}

export function browserCloseTool() {
  return tool({
    description:
      "Close the live browser. Do it as your last step when the task there is finished and nothing is left for the user to see or do on the page, and whenever the user asks you to close it. " +
      "Sign-ins are kept, so the next task starts signed in. Do not close it while the user still needs the page: a basket waiting for them to pay, a form they should check, a page you have handed over.",
    inputSchema: browserCloseInput,
    outputSchema: step,
    toModelOutput: pageText,
  });
}

/**
 * Answered in the interface: the moment the model asks, the app hands the browser to the user
 * (their clicks and keys reach the page, the agent's do not) and the run waits for them.
 */
export function requestUserActionTool() {
  return tool({
    description:
      "Hand the live browser to the user for something only they may do, and wait until they say they are done. Use it for: signing in (kind login), a CAPTCHA or 'are you human' check (captcha), " +
      "a code sent to their phone or email (verification), paying (payment), or anything else that needs them in person (other). " +
      "You never type passwords, codes or payment details and you never pay: this is how those steps get done. Say plainly in `reason` what you need them to do.",
    inputSchema: requestUserActionInput,
    outputSchema: z.object({
      status: z.enum(["done", "skipped", "interrupted"]),
      note: z.string().optional(),
    }),
    toModelOutput: ({ input, output }) => {
      if (output.status === "interrupted") {
        return {
          type: "text",
          value:
            "The app was closed while it was the user's turn, and the live browser closed with it: the page is gone. Nobody said they were done, and nobody skipped it. " +
            "Whatever the user finished before closing is kept by the site (a sign-in stays signed in); what was only typed into a form is not. " +
            "Open the page again with browserOpen and look at where things stand before repeating anything. If what you asked for is done, carry on. If it is still needed, ask for it again with requestUserAction. " +
            "Do not ask the user whether to continue.",
        };
      }
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
