import { browserFor, validBrowserId } from "@/lib/browser/session";
import type { ControlRequest } from "@/lib/browser/protocol";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS = new Set(["take", "release", "back", "forward", "reload", "navigate", "tab", "close", "forget"]);

/** Take over, hand back, the address bar and its buttons, tabs, closing, and forgetting sign-ins. */
export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!validBrowserId(id)) return Response.json({ error: "Missing or invalid browser id." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) return Response.json({ error: "Unknown action." }, { status: 400 });
  if (body.action === "navigate" && (typeof body.url !== "string" || !body.url.trim() || body.url.length > 2000)) return Response.json({ error: "No address." }, { status: 400 });
  if (body.action === "tab" && typeof body.tabId !== "string") return Response.json({ error: "No tab." }, { status: 400 });
  const session = browserFor(id);
  // Typing an address is something only the user does, so it puts them in control.
  if (body.action === "navigate") await session.control({ action: "take" });
  const state = await session.control(body as unknown as ControlRequest);
  return Response.json(state);
}
