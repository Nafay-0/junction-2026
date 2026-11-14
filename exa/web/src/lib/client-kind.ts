/**
 * Where the interface is running. "desktop" is the desktop app, which has a live browser inside
 * it; "web" is everything else (a browser tab, the installed web app, a phone), which can search,
 * read and show, but not act on websites. A conversation belongs to the kind it was started in.
 */
export type ClientKind = "web" | "desktop";

/** Sent with every request to the app's own server, so it knows which kind is asking. */
export const CLIENT_HEADER = "x-beryl-client";

/** The kind of client this code is running in. On the server (no window) it is "web". */
export function clientKind(): ClientKind {
  return typeof window !== "undefined" && "berylDesktop" in window ? "desktop" : "web";
}

/** The kind a request to the server says it comes from. */
export function clientKindOf(request: Request): ClientKind {
  return request.headers.get(CLIENT_HEADER) === "desktop" ? "desktop" : "web";
}
