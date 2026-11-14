import { CLIENT_HEADER, clientKind } from "@/lib/client-kind";

/*
 * Requests from the interface to the app's own server. Each one says which kind of client it
 * comes from (the web, or the desktop app), and a request that finds the user signed out sends
 * them to the sign-in page instead of failing quietly.
 */

let leaving = false;

/** Go to the sign-in page, and come back here afterwards. */
export function goToSignIn(): void {
  if (typeof window === "undefined" || leaving || window.location.pathname === "/login") return;
  leaving = true;
  const here = window.location.pathname + window.location.search;
  window.location.assign(here && here !== "/" ? `/login?next=${encodeURIComponent(here)}` : "/login");
}

/** `fetch` for the app's own API: adds the client header, sends JSON, and handles being signed out. */
export async function api(path: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<Response> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json === undefined ? {} : { "content-type": "application/json" }), [CLIENT_HEADER]: clientKind(), ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (response.status === 401) goToSignIn();
  return response;
}

/** The sentence a failed response carries, or a plain one of our own. */
export async function errorOf(response: Response, fallback = "That did not work. Try again."): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return fallback;
}
