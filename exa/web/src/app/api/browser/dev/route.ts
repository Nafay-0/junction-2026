import { browserFor, devUseChromeFolder, validBrowserId, type ActInput } from "@/lib/browser/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Development only: take a browser step directly, without a model in between. This is how the
 * safety rules are tested end to end (`pnpm test:browser`): the test asks for exactly the steps a
 * model must never get away with and checks that the browser refuses them.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not available." }, { status: 404 });
  const id = new URL(req.url).searchParams.get("id");
  if (!validBrowserId(id)) return Response.json({ error: "Missing or invalid browser id." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { open?: string; act?: ActInput; read?: { scope?: "view" | "page"; find?: string }; review?: ActInput; look?: boolean; chromeFolder?: string; state?: boolean };
  // Tests point "the user's own Chrome" at a stand-in, so they never touch the real one.
  if (body.chromeFolder !== undefined) {
    devUseChromeFolder(body.chromeFolder);
    return Response.json(browserFor(id).snapshotState());
  }
  const session = browserFor(id);
  if (body.state) return Response.json(session.snapshotState());
  if (body.open) return Response.json(await session.open(body.open));
  if (body.read) return Response.json(await session.read({ scope: body.read.scope ?? "view", find: body.read.find }));
  if (body.look) return Response.json({ ...(await session.look("dev-look")), picture: session.picture("dev-look")?.length ?? 0 });
  if (body.review) return Response.json(await session.review(`dev-${crypto.randomUUID()}`, body.review));
  if (body.act) return Response.json(await session.act(`dev-${crypto.randomUUID()}`, body.act));
  return Response.json({ error: "Nothing to do." }, { status: 400 });
}
