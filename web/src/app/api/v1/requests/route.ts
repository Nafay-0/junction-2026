import { authenticate, handle, readJson } from "@/server/http";

export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const request = await dock.openRequest(session, (await readJson(req)) as never);
    return Response.json({ request }, { status: 201 });
  });
}
