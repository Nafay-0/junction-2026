import { fetchMarketBySlug } from "@/lib/agent/tools/markets";
import { requireUser } from "@/lib/auth/server";

/** Fresh odds for the prediction market widget's live refresh. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!/^[a-z0-9-]{3,120}$/i.test(slug)) return Response.json({ error: "Unknown market." }, { status: 400 });
  try {
    const market = await fetchMarketBySlug(slug, req.signal);
    return Response.json(market, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Lookup failed." }, { status: 502 });
  }
}
