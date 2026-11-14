import { opsRead } from "@/server/ops/handler";
import { WORDS_HIDDEN, scrubWords } from "@/server/ops/viewer";
import { ledgerForCheck } from "@/server/ops/views";

/**
 * GET /ops-api/ledger: the whole hash chain for the browser to check on its own. Buyer-side intake steps (the
 * kitchen's memory) come with their content withheld and their hashes kept, so the chain still links through them.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt, _who, scope) => {
    const dump = ledgerForCheck(rt);
    if (!scope?.texts.length) return Response.json(dump);
    // For a viewer, an entry quoting someone's own words keeps its hashes and goes without its content, like the
    // kitchen's memory: the chain still links through it in the browser's check.
    let hidden = 0;
    const entries = dump.entries.map((e) => {
      if (e.withheld || scrubWords(e, scope) === e || JSON.stringify(scrubWords(e, scope)) === JSON.stringify(e)) return e;
      hidden += 1;
      return { ...e, summary: `Kept with the kitchen: ${WORDS_HIDDEN}.`, data: { step: (e.data as { step?: unknown }).step, event: (e.data as { event?: unknown }).event }, withheld: "buyer_words" as const };
    });
    return Response.json({ ...dump, entries, withheld: dump.withheld + hidden });
  });
}
