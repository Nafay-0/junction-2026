import { browserFor, validBrowserId } from "@/lib/browser/session";
import type { UserInput } from "@/lib/browser/protocol";

export const dynamic = "force-dynamic";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Only well-formed events get through. Nothing received here is logged. */
function clean(raw: unknown): UserInput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.type === "mouse" && (e.action === "move" || e.action === "down" || e.action === "up") && finite(e.x) && finite(e.y)) {
    const button = e.button === "right" || e.button === "middle" ? e.button : "left";
    return { type: "mouse", action: e.action, x: e.x, y: e.y, button, clickCount: finite(e.clickCount) ? Math.min(Math.max(Math.round(e.clickCount), 1), 3) : 1 };
  }
  if (e.type === "wheel" && finite(e.x) && finite(e.y) && finite(e.deltaX) && finite(e.deltaY)) {
    const cap = (n: number) => Math.max(-2000, Math.min(2000, n));
    return { type: "wheel", x: e.x, y: e.y, deltaX: cap(e.deltaX), deltaY: cap(e.deltaY) };
  }
  if (e.type === "key" && (e.action === "down" || e.action === "up") && typeof e.key === "string" && e.key.length > 0 && e.key.length <= 24) {
    return { type: "key", action: e.action, key: e.key };
  }
  if (e.type === "text" && typeof e.text === "string" && e.text.length <= 20_000) return { type: "text", text: e.text };
  return null;
}

/** The user's mouse and keys while they are in control of the live browser. */
export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!validBrowserId(id)) return Response.json({ error: "Missing or invalid browser id." }, { status: 400 });
  let body: { events?: unknown };
  try {
    body = (await req.json()) as { events?: unknown };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 200).map(clean).filter((e): e is UserInput => e !== null);
  const accepted = browserFor(id).input(events);
  return accepted ? new Response(null, { status: 204 }) : Response.json({ error: "The agent is driving. Take over first." }, { status: 409 });
}
