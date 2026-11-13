import { authenticate, handle, readJson } from "@/server/http";

export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const result = await dock.requestQuote(session, (await readJson(req)) as never);
    return Response.json(result, { status: 201 });
  });
}
