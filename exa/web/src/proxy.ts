import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookie";

/*
 * The gate in front of the app. Someone without a session cookie gets the sign-in page instead of
 * a page, and a 401 instead of an API answer. That is all it does: it only looks at whether the
 * cookie is there. Whether the cookie is still good (not signed out, not blocked) is checked
 * against the database by the page or the route itself (lib/auth/server.ts), on every request.
 *
 * Two routes are left out on purpose, /api/chat and /api/conversations: Next.js keeps a copy of
 * every request body that passes through here and cuts it off at 10 MB, and those two carry whole
 * conversations with attached pictures. They check the session themselves with requireUser().
 */

const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout"]);
/** Icons, the web app manifest and the like: needed before anyone has signed in. */
const PUBLIC_FILE = /^\/(?:favicon\.ico|icon(?:[-.\w]*)?|apple-icon(?:[-.\w]*)?|manifest\.(?:webmanifest|json)|sw\.js|robots\.txt)$|\.(?:png|svg|ico|webp|jpg|jpeg|woff2?)$/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname) || PUBLIC_FILE.test(pathname)) return NextResponse.next();
  // The pretend shop the browser tests run against: a static page with nothing of anyone's in it.
  if (pathname === "/dev/sandbox.html") return NextResponse.next();
  // The widget gallery and the browser panel preview are development tools.
  if (pathname.startsWith("/dev/") && process.env.NODE_ENV !== "production") return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "You are signed out. Sign in again." }, { status: 401 });
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  // Opening a page keeps the sign-in alive for another 30 days (the server does the same for the session itself).
  const response = NextResponse.next();
  if (!pathname.startsWith("/api/") && request.method === "GET") response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(request));
  return response;
}

export const config = {
  // Everything except Next's own files and the two routes named above.
  matcher: ["/((?!_next/static|_next/image|api/chat|api/conversations).*)"],
};
