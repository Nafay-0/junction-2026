import type { EarlierRequest } from "@/server/agent/interpret";
import { overview } from "@/server/kitchen-portal";
import { earlierFor as fromRequests, looksLikeFollowUp } from "@/app/k/[kitchen]/memory";
import type { TurnRun } from "./pipeline";

/** Words that change the request on the table rather than start a new one ("make it 200 litres", "is there a lactose-free one?"). */
const CHANGE = /\b(make it|instead|rather|change|double|half|twice|more|less|fewer|lactose|gluten|organic|cheaper|cheapest|bigger|smaller|another|other|one|vaihda|tuplat?|puolet|enemmän|vähemmän|sen sijaan|halvempi|laktoositon\w*|gluteeniton\w*|ändra|dubbel|hälften|mer|mindre|istället|billigare|laktosfri\w*)\b/i;

/**
 * The earlier requests the reader may resolve the words against, newest first: the requests of this conversation
 * (so "make it 200 litres" changes the one on the table), then the kitchen's history when the words point back
 * ("same as last Thursday but double"). None for a plain new request: the reader then reads only the words.
 */
export async function earlierFor(run: TurnRun, words: string): Promise<EarlierRequest[]> {
  const inThread = [...new Set(run.store.cards(run.thread).flatMap((x) => ("requestId" in x.card && x.card.requestId ? [x.card.requestId] : [])))].reverse();
  const backRef = looksLikeFollowUp(words);
  const change = inThread.length > 0 && CHANGE.test(words);
  if (!backRef && !change) return [];
  const ov = await overview(run.k);
  const byId = new Map(ov.requests.map((r) => [r.requestId ?? r.key, r]));
  const thread = inThread.slice(0, 3).flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  const rest = backRef ? ov.requests.filter((r) => !thread.includes(r)) : [];
  return fromRequests([...thread, ...rest], 6);
}
