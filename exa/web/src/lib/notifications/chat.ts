import "server-only";
import { takeNotifyWhenDone, wantsNotifyWhenDone } from "@/lib/db/notifications";
import { notify } from "./notify";

/*
 * "Tell me when it's done." A chat that takes long offers this; the user says yes and goes off
 * to do something else. When the work in that chat is really over, they are told: in the app,
 * and by email if they are away.
 *
 * An answer can be written in several requests: it pauses for a step in the live browser, an
 * approval or a question, and carries on in the next one. So a request that ends is not yet a
 * chat that is finished. This looks at how the answer stands when a request ends.
 */

type Part = { type: string; state?: string; text?: string; toolCallId?: string; input?: { title?: string; question?: string; questions?: Array<{ question?: string }> } };
type Message = { id?: string; role: string; parts?: Part[] };

/** Steps the interface answers. While one is open the answer is not finished. */
const ASKS_THE_USER = new Set(["tool-askUser", "tool-requestLocation"]);
const waiting = (part: Part) => part.type.startsWith("tool-") && (part.state === "input-available" || part.state === "input-streaming");

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The last thing the agent wrote in the answer, as one short paragraph. */
function lastWords(message: Message): string {
  const text = (message.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .at(-1);
  return clip((text ?? "").replace(/[#*_`>|]/g, "").replace(/\s+/g, " ").trim(), 220);
}

/** A request in a chat has ended. Never throws. */
export async function chatEnded(input: { userId: string; conversationId: string; messages: unknown[]; aborted: boolean }): Promise<void> {
  try {
    const last = (input.messages as Message[]).at(-1);
    // The user pressed Stop: they are here and they know. The request to be told goes with it.
    if (input.aborted) {
      await takeNotifyWhenDone(input.userId, input.conversationId);
      return;
    }
    if (!last || last.role !== "assistant") return;
    const open = (last.parts ?? []).filter(waiting);
    if (open.length > 0) {
      // A question for the user is worth telling them about, if they asked to hear about this chat.
      const question = open.find((p) => ASKS_THE_USER.has(p.type));
      if (question && (await wantsNotifyWhenDone(input.userId, input.conversationId))) {
        await notify({
          userId: input.userId,
          kind: "needs_you",
          title: "Beryl has a question for you",
          body: clip(question.input?.title ?? question.input?.question ?? question.input?.questions?.[0]?.question ?? "It needs your answer to carry on.", 220),
          conversationId: input.conversationId,
          dedupe: `ask:${question.toolCallId ?? last.id ?? ""}`,
          email: "away",
          afterMs: 60_000,
        });
      }
      // Anything else that is open (a step in the live browser, the user's turn on a page) is the
      // desktop app's to carry on with, and it reports "waiting for you" itself.
      return;
    }
    const asked = await takeNotifyWhenDone(input.userId, input.conversationId);
    if (!asked) return;
    await notify({
      userId: input.userId,
      kind: "chat_done",
      title: `Done: ${clip(asked.title, 90)}`,
      body: lastWords(last),
      conversationId: input.conversationId,
      dedupe: `done:${input.conversationId}:${last.id ?? Date.now()}`,
      email: "away",
    });
  } catch (err) {
    console.warn("[notify] could not tell about a finished chat", err instanceof Error ? err.message : err);
  }
}
