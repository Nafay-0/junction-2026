import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One way in. An agent's mandate is verified by the core (`dock.authenticate`), and then the operations layer is
 * asked whether staff suspended the agent. Two functions do both: `authenticate` in server/http.ts for calls that
 * arrive as HTTP requests (REST, MCP, the on-site console), and `onsiteSession` in server/ops/onsite.ts for doors
 * that call Dock in-process. A door that calls `dock.authenticate` itself skips the operations check: that is how
 * a suspended agent could still order by voice, by photo and through the menu planner.
 *
 * This test reads the server's source and fails when a new file verifies a mandate on its own. If it fails for
 * your file: take the session from `onsiteSession(dock, creds, "<door>")`, or from `authenticate(req, dock)` when
 * you have the agent's HTTP request. Only add the file below when it never acts for the agent (it reads, to show a
 * page) or it runs the operations check itself, and say which.
 */
const WEB = join(__dirname, "..", "..");

const MAY_VERIFY_A_MANDATE: Record<string, string> = {
  "src/server/http.ts": "the way in for HTTP calls: verifies, then enforces suspensions",
  "src/server/ops/onsite.ts": "the way in for in-process doors: verifies, then enforces suspensions",
  "src/server/sandboxes.ts": "the scripted buyer: enforces suspensions itself, right after",
  "src/app/api/v1/approver/demo-order/route.ts": "the presenter's scripted buyer: enforces suspensions itself, right after",
  "src/server/kitchen-portal.ts": "read only: the store's pages, which show the suspension instead of failing",
  "src/app/ui-api/kitchens/[kitchen]/claims/route.ts": "read only: signed claims already issued to the kitchen",
  "src/app/ui-api/memory/kitchens/[kitchen]/requests/[requestId]/route.ts": "read only: the request's own record, for the kitchen's memory",
  "src/server/aiven/test-dock.ts": "test helper",
  "src/server/memory/bench.ts": "offline benchmark on a dock of its own",
};
/** Files that enforce by hand must keep doing so. */
const ENFORCES_ITSELF = ["src/server/sandboxes.ts", "src/app/api/v1/approver/demo-order/route.ts"];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("every door takes its agent session through the operations check", () => {
  const files = [...sources(join(WEB, "src", "server")), ...sources(join(WEB, "src", "app"))];
  const verifying = files.filter((f) => /\bdock\s*\.\s*authenticate\s*\(/.test(readFileSync(f, "utf8"))).map((f) => relative(WEB, f));

  it("no server file verifies a mandate on its own, outside the two ways in", () => {
    const strays = verifying.filter((f) => !(f in MAY_VERIFY_A_MANDATE));
    expect(strays, `These files call dock.authenticate directly, which skips the suspension check. Use onsiteSession (server/ops/onsite.ts) or authenticate (server/http.ts): ${strays.join(", ")}`).toEqual([]);
  });

  it("the files that enforce suspensions by hand still do", () => {
    for (const f of ENFORCES_ITSELF) expect(readFileSync(join(WEB, f), "utf8"), f).toMatch(/suspensions\([^)]*\)\s*\.enforce\(/);
  });

  it("the list of exceptions names only files that exist and still need it", () => {
    for (const f of Object.keys(MAY_VERIFY_A_MANDATE)) expect(verifying, `${f} no longer calls dock.authenticate: remove it from the list`).toContain(f);
  });
});
