"use client";

/** Small fetch wrapper for the phone screens: JSON in, JSON out, errors as data. */
export type ApiError = { code: string; message: string; rule?: string; details?: Record<string, unknown> };
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError; data?: T };

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: { code: "network", message: "No connection to Dock. Check the wifi and try again." } };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: res.status, error: { code: "bad_response", message: `Dock answered ${res.status} without JSON.` } };
  }
  const obj = json as T & { error?: ApiError };
  if (!res.ok || obj.error) return { ok: false, status: res.status, error: obj.error ?? { code: "http_error", message: `HTTP ${res.status}` }, data: obj };
  return { ok: true, status: res.status, data: obj };
}

/** What went wrong with a passkey prompt, in words for the person holding the phone. */
export function passkeyProblem(err: unknown): { cancelled: boolean; title: string; body: string } {
  const e = err as { name?: string; code?: string; message?: string };
  switch (e?.code) {
    case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
      return { cancelled: false, title: "This phone needs a screen lock", body: "Passkeys need Face ID, a fingerprint or a device PIN. Turn on a screen lock and try again." };
    case "ERROR_INVALID_DOMAIN":
    case "ERROR_INVALID_RP_ID":
      return { cancelled: false, title: "Passkeys don't work on this address", body: "This page must be opened over https (or on localhost) for passkeys to work." };
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return { cancelled: false, title: "Already set up", body: "This phone already has a passkey for this kitchen." };
  }
  switch (e?.name) {
    case "NotAllowedError":
      return { cancelled: true, title: "Cancelled", body: "The Face ID or fingerprint prompt was closed or timed out. Nothing happened. Tap to try again." };
    case "AbortError":
      return { cancelled: true, title: "Cancelled", body: "The passkey prompt was interrupted. Tap to try again." };
    case "NotSupportedError":
      return { cancelled: false, title: "This browser can't use passkeys", body: "Try the phone's default browser (Safari on iPhone, Chrome on Android)." };
    case "SecurityError":
      return { cancelled: false, title: "Passkeys are blocked here", body: "This page must be opened over https for passkeys to work." };
    case "InvalidStateError":
      return { cancelled: false, title: "Already set up", body: "This phone already has a passkey for this kitchen." };
  }
  return { cancelled: false, title: "The passkey didn't work", body: e?.message ? `Your phone said: ${e.message}` : "Something went wrong with the passkey prompt." };
}
