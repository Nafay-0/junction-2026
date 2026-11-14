import { DockError } from "@/core/errors";
import { ATTACKS, runAttack } from "@/server/show/attacks";
import { bodyOf, optionalId, showRoute } from "@/server/show/http";
import { keepAttack } from "@/server/show/keep";
import type { AttackId } from "@/server/show/types";

/** GET: the attacks and their keys. POST { id, sandboxId? }: run one through the real gate and say what held it. */
export async function GET(req: Request) {
  return showRoute(req, async () => Response.json({ attacks: ATTACKS }));
}

export async function POST(req: Request) {
  return showRoute(req, async (rt, staff) => {
    const body = await bodyOf(req);
    const id = ATTACKS.find((a) => a.id === body.id)?.id as AttackId | undefined;
    if (!id) throw new DockError(400, "attack_unknown", `Unknown attack; one of ${ATTACKS.map((a) => a.id).join(", ")}.`);
    const result = await runAttack(rt, id, { sandboxId: optionalId(body.sandboxId), by: staff.name });
    await keepAttack(result);
    return Response.json({ result });
  });
}
