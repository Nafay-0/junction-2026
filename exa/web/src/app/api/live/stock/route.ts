import { fetchStockQuote } from "@/lib/agent/tools/markets";
import { requireUser } from "@/lib/auth/server";

/** Fresh quote for the stock widget's live refresh. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "";
  if (!/^[A-Za-z.\-]{1,8}$/.test(symbol)) return Response.json({ error: "Unknown symbol." }, { status: 400 });
  try {
    const quote = await fetchStockQuote(symbol, { signal: req.signal });
    return Response.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Lookup failed." }, { status: 502 });
  }
}
