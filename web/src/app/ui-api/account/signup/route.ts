import { accountCookie } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";
import { isLang, langFromCookie } from "@/app/_i18n/lang";

/**
 * POST /ui-api/account/signup { restaurant, username, password, email, lang? }: step 1 of opening an account. The
 * business email (required here) is for order confirmations, receipts and alerts: it becomes the kitchen's contact,
 * pending until confirmed from the mail, once the kitchen exists (accounts/email.ts). No person's name is asked.
 * Signs this browser in; step 2 is the set-up interview
 * (POST /ui-api/account/interview), which ends in signing the mandate that makes the kitchen.
 */
export async function POST(req: Request) {
  return accountRoute(req, async (rt, { address }) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const lang = isLang(body.lang) ? body.lang : (langFromCookie(req.headers.get("cookie")) ?? "en");
    const s = await rt.accounts.signUp({ restaurant: body.restaurant, username: body.username, password: body.password, email: body.email, lang }, address, { requireEmail: true });
    return Response.json({ account: s.account, next: "/k/signup?step=rules" }, { status: 201, headers: { ...noStore, "set-cookie": accountCookie(req, s.token, s.expiresAt) } });
  });
}
