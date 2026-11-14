import { handle } from "@/server/http";
import { restWatch } from "@/server/watch/rest";

/** POST /api/v1/watch/answer { findingId | renewalId, choice, productId?, by }: the buyer's answer; a switch or renewal is an ordinary order through the gate. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restWatch(rt, req, "answer_watch")));
}
