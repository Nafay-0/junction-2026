import { errorBody, handle } from "@/server/http";

/**
 * DEV ONLY: the approval messages Dock would have sent to approvers' phones, with their one-time links.
 * Lets the scripted demo play the approver over HTTP. Returns 404 in production builds.
 */
export async function GET(req: Request) {
  void req.url;
  if (process.env.NODE_ENV === "production") return Response.json(errorBody("not_found", "Not available in production."), { status: 404 });
  return handle(async ({ outbox }) => Response.json({ messages: outbox.messages() }));
}
