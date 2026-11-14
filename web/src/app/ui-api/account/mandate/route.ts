import { DEFAULT_TERMS, FORBID_ALLERGENS, PRODUCT_GROUPS, REQUIRE_CLAIMS, SUBSTITUTION_RULES, parseTerms } from "@/server/accounts/terms";
import { noStore, signedInRoute } from "@/server/accounts/routes";
import { readJson } from "@/server/http";

/**
 * GET  /ui-api/account/mandate   the form's vocabulary, its defaults, and the kitchen's current terms if signed
 * POST /ui-api/account/mandate   { terms }: sign the kitchen's mandate. The first time this makes the kitchen (its
 *                                key, mandate, agent and memory); after that it reissues the mandate and retires the
 *                                old one. Only the signed-in account can, for its own kitchen.
 */
export async function GET(req: Request) {
  return signedInRoute(req, async (rt, a) =>
    Response.json(
      {
        account: rt.accounts.view(a),
        defaults: DEFAULT_TERMS,
        current: a.kitchen?.terms ?? null,
        vocabulary: { groups: PRODUCT_GROUPS.map((g) => g.id), require: REQUIRE_CLAIMS, forbid: FORBID_ALLERGENS, substitution: SUBSTITUTION_RULES },
        editable: a.kind !== "demo",
      },
      { headers: noStore },
    ),
  );
}

export async function POST(req: Request) {
  return signedInRoute(req, async (rt, a) => {
    const body = (await readJson(req)) as { terms?: unknown };
    const signed = await rt.accounts.signKitchen(a.username, parseTerms(body.terms));
    const first = !a.kitchen;
    return Response.json({ account: rt.accounts.view(signed), mandateId: signed.kitchen?.mandate.mandateId, first, next: `/k/${signed.username}` }, { status: first ? 201 : 200, headers: noStore });
  });
}
