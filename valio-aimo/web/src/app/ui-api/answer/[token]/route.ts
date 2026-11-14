import { z } from "zod";
import { DockError } from "@/core/errors";
import type { HumanVia } from "@/core/intake";
import { openAnswerLink, spendAnswerLink, ANSWER_LINK_MINUTES } from "@/server/answer-links";
import { currentApprover } from "@/server/approver-session";
import { handle, readJson } from "@/server/http";
import { admit } from "@/server/ops/onsite";
import type { Runtime } from "@/server/runtime";

/**
 * The buyer's one-time answer page's back end (server/answer-links.ts).
 *   GET   what Dock asks: the open concerns or questions with their fixed choices
 *   POST  { by, responses: [{ key, choice }] } or { by, answers: [{ questionId, optionId }] }: the answer, once
 * The answer goes through the same intake calls an agent's would, on the channel `answer_link`; with the kitchen's
 * signed-in session on this phone it is that person's answer.
 */
const noStore = { "cache-control": "no-store" };

async function personOf(req: Request, rt: Runtime, orgId: string): Promise<string | undefined> {
  const me = await currentApprover(req, rt).catch(() => undefined);
  return me && me.account.orgId === orgId ? me.account.name : undefined;
}

export async function GET(req: Request, ctx: RouteContext<"/ui-api/answer/[token]">) {
  return handle(async (rt) => {
    const { token } = await ctx.params;
    const link = openAnswerLink(token);
    await admit(rt.dock, link.session, "answer link"); // an agent suspended since the link was made is refused here too
    const step = await rt.dock.intake.get(link.session, link.requestId);
    link.check(step);
    const person = await personOf(req, rt, link.session.mandate.issuer.orgId);
    return Response.json(
      {
        kitchenName: link.session.mandate.issuer.name,
        requestId: step.requestId,
        state: step.state,
        need: step.need.text ?? step.need.item.text,
        concerns: step.concerns.map((c) => ({ key: c.key, message: c.message, confirmable: c.confirmable, corrections: c.corrections.map((x) => ({ id: x.id, label: x.label })) })),
        questions: step.questions.map((q) => ({ id: q.id, text: q.text, options: q.options })),
        signedInAs: person ?? null,
        minutes: ANSWER_LINK_MINUTES,
      },
      { headers: noStore },
    );
  });
}

const Body = z.object({
  by: z.string().trim().min(1).max(120),
  responses: z.array(z.object({ key: z.string().min(1), choice: z.string().min(1) })).min(1).max(20).optional(),
  answers: z.array(z.object({ questionId: z.string().min(1), optionId: z.string().min(1) })).min(1).max(10).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/ui-api/answer/[token]">) {
  return handle(async (rt) => {
    const { token } = await ctx.params;
    const link = openAnswerLink(token);
    await admit(rt.dock, link.session, "answer link");
    const parsed = Body.safeParse(await readJson(req));
    if (!parsed.success) throw new DockError(400, "invalid_request", z.prettifyError(parsed.error));
    const body = parsed.data;
    link.check(await rt.dock.intake.get(link.session, link.requestId));
    const person = await personOf(req, rt, link.session.mandate.issuer.orgId);
    const via: HumanVia = { channel: "answer_link", ...(person ? { person } : {}) };
    const by = person ?? `${body.by} (answer link)`;
    const step = body.responses
      ? await rt.dock.intake.respondToConcerns(link.session, link.requestId, { by, responses: body.responses }, via)
      : body.answers
        ? await rt.dock.intake.answer(link.session, link.requestId, { by, answers: body.answers }, via)
        : (() => {
            throw new DockError(400, "invalid_request", "Send responses (to concerns) or answers (to questions).");
          })();
    spendAnswerLink(token);
    return Response.json({ done: true, state: step.state, message: "Thank you. Your answer went to Dock; the agent carries on from here." }, { headers: noStore });
  });
}
