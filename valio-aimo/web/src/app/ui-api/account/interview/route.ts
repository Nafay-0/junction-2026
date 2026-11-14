import { noStore, signedInRoute } from "@/server/accounts/routes";
import { readJson } from "@/server/http";
import { langFromCookie } from "@/app/_i18n/lang";
import { finishInterview, interviewStep } from "@/server/accounts/interview-run";

/**
 * The set-up interview, the second step of a new account (server/accounts/interview.ts; docs/agent-thread.md
 * "Set-up interview"). Only the signed-in account, for its own kitchen.
 *
 * POST /ui-api/account/interview   { answers }                    the next question (or the terms to sign), from the
 *                                                                  answers so far and what the records already say
 * POST /ui-api/account/interview   { answers, finish: true, ms? }  sign: the kitchen's mandate from the answers (the
 *                                                                  account's own signing), what to remember in its
 *                                                                  memory, and one ledger entry with every question
 *                                                                  asked, skipped (and why) and answered
 */
export async function POST(req: Request) {
  return signedInRoute(req, async (rt, a, { address }) => {
    const body = (await readJson(req)) as { answers?: unknown; finish?: boolean; ms?: unknown };
    if (body.finish) {
      const lang = langFromCookie(req.headers.get("cookie")) ?? "en";
      const r = await finishInterview(rt, a, body.answers, typeof body.ms === "number" && Number.isFinite(body.ms) ? Math.round(body.ms) : undefined, { lang, clientAddress: address });
      return Response.json(r, { status: r.first ? 201 : 200, headers: noStore });
    }
    return Response.json(interviewStep(a, body.answers), { headers: noStore });
  });
}
