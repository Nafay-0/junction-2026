import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/cookie";

/*
 * The gate in front of the app. Someone without a session cookie gets the sign-in page instead of
 * a page (the website's front page and its downloads excepted), and a 401 instead of an API
 * answer. That is all it does: it only looks at whether the cookie is there. Whether the cookie is
 * still good (not signed out, not blocked) is checked against the database by the page or the
 * route itself (lib/auth/server.ts), on every request.
 *
 * Two routes are left out on purpose, /api/chat and /api/conversations: Next.js keeps a copy of
 * every request body that passes through here and cuts it off at 10 MB, and those two carry whole
 * conversations with attached pictures. They check the session themselves with requireUser().
 */

const PUBLIC_PAGES = new Set(["/login", "/about"]);
/**
 * The pages that are someone's own: the app itself (the front door is handled on its own below),
 * a chat, the Jobs page, the admin area, the development tools. Signed out, these lead to the
 * sign-in page and back. Any other address is nobody's: it is let through, and the visitor gets
 * the "page not found" page instead of being asked to sign in to see nothing. Each of these
 * pages also checks the session itself, so a page left off this list is still not open.
 */
const PRIVATE_PAGES = /^\/(?:chat|jobs|admin|dev)(?:\/|$)/;
/** A chat's id, as the server accepts it everywhere. */
const CHAT_ID = /^[A-Za-z0-9_-]{6,80}$/;
/** The page that was asked for, handed on to the app so a page that sends someone to sign in can send them back. */
export const PATH_HEADER = "x-beryl-path";
/** The desktop app names itself in its window's User-Agent (desktop/main.cjs). */
const DESKTOP_APP = /BerylDesktop\//;
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/health"]);
/** Icons, the web app manifest and the like: needed before anyone has signed in. */
const PUBLIC_FILE = /^\/(?:favicon\.ico|icon(?:[-.\w]*)?|apple-icon(?:[-.\w]*)?|manifest\.(?:webmanifest|json)|sw\.js|robots\.txt)$|\.(?:png|svg|ico|webp|jpg|jpeg|woff2?)$/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname) || PUBLIC_FILE.test(pathname)) return NextResponse.next();
  // The desktop app's installers: anyone may download them, signed in or not.
  if (pathname.startsWith("/download/")) return NextResponse.next();
  // The pretend shop the browser tests run against: a static page with nothing of anyone's in it.
  if (pathname === "/dev/sandbox.html") return NextResponse.next();
  // The widget gallery and the browser panel preview are development tools.
  if (pathname.startsWith("/dev/") && process.env.NODE_ENV !== "production") return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // A chat used to be linked as /?chat=<id> (older emails still are): it lives at /chat/<id> now.
  const linkedChat = pathname === "/" ? request.nextUrl.searchParams.get("chat") : null;
  if (linkedChat && CHAT_ID.test(linkedChat)) return NextResponse.redirect(new URL(`/chat/${linkedChat}`, request.url));
  // The front page of the website: someone who is not signed in gets the landing page there, which
  // the page itself renders. Not in the desktop app, where a signed-out visitor goes to sign in.
  if (!token && pathname === "/" && !DESKTOP_APP.test(request.headers.get("user-agent") ?? "")) return NextResponse.next();
  if (!token) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "You are signed out. Sign in again." }, { status: 401 });
    // An address that is nobody's page: let it be answered with "not found".
    if (pathname !== "/" && !PRIVATE_PAGES.test(pathname)) return NextResponse.next();
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  // Opening a page keeps the sign-in alive for another 30 days (the server does the same for the session itself).
  // The page is told which address was asked for: if the sign-in turns out to have ended, it can lead back here.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, pathname + search);
  const response = NextResponse.next({ request: { headers } });
  if (!pathname.startsWith("/api/") && request.method === "GET") response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(request));
  return response;
}

export const config = {
  // Everything except Next's own files (scripts, styles, images, the development tools) and the two routes named above.
  matcher: ["/((?!_next/|__next|api/chat|api/conversations).*)"],
};
