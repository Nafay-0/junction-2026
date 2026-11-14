import { scan } from "@/server/channels/scan/door";
import { handle } from "@/server/http";

/**
 * POST /ui-api/scan/{kitchen}  multipart "file" (JPEG, PNG, WebP up to 8 MB; PDF up to 10 MB and 5 pages)
 *                              or JSON { text } (a pasted list or email, up to 20,000 characters)
 * Reads the list into lines for the buyer to review. The file is processed in memory and not kept.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/scan/[kitchen]">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    return Response.json(await scan(kitchen, req), { headers: { "cache-control": "no-store" } });
  });
}
