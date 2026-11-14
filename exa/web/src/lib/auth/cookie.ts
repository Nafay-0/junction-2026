/*
 * The session cookie's name and lifetime. On its own, without any server code, because the
 * request gate (src/proxy.ts) needs them too and must stay small.
 */

export const SESSION_COOKIE = "beryl_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

/** Was this request made over HTTPS? Behind a host's load balancer the original scheme is in a header. */
export function isSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

/**
 * How the cookie is set: unreadable by scripts, sent on ordinary navigation to this site only, and
 * marked Secure whenever the site is served over HTTPS (always, once deployed).
 */
export function sessionCookieOptions(request: Request) {
  return { httpOnly: true, sameSite: "lax" as const, secure: isSecure(request), path: "/", maxAge: SESSION_SECONDS };
}
