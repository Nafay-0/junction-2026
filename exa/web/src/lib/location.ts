"use client";

import * as React from "react";
import { useStored } from "@/lib/use-client";
import type { ExactLocation } from "@/lib/widgets/types";

/**
 * The user's location, read through the browser's Geolocation API.
 * It is asked for only when the user or the agent needs it, kept in this browser's storage,
 * and sent with messages so searches and maps can use it. Nothing is stored on a server.
 */

const KEY = "hovi.location";
const DECLINED_KEY = "hovi.location.declined";

export type PermissionState = "granted" | "prompt" | "denied" | "unsupported";

export type LocateResult =
  | { ok: true; location: ExactLocation }
  | { ok: false; reason: "denied" | "unavailable" | "timeout" | "unsupported" | "insecure" };

/** What the browser will do if we ask: answer silently, show its prompt, or refuse. */
export async function permissionState(): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    // Some browsers cannot be asked in advance; they will show their prompt when we request a position.
    return "prompt";
  }
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  });
}

/** Turn coordinates into a name ("Otaniemi, Espoo, Finland"). Best effort: the coordinates still work without it. */
export async function describe(lat: number, lng: number): Promise<{ label?: string; country?: string }> {
  try {
    const res = await fetch(`/api/geo/reverse?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    return (await res.json()) as { label?: string; country?: string };
  } catch {
    return {};
  }
}

/** Ask the browser for the position. This is the call that makes the browser show its permission prompt. */
export async function locate(): Promise<LocateResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return { ok: false, reason: "unsupported" };
  if (typeof window !== "undefined" && !window.isSecureContext) return { ok: false, reason: "insecure" };
  try {
    const position = await currentPosition();
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    // Give the name lookup a moment, but do not hold the conversation up for it:
    // the name is filled in afterwards if it arrives late.
    const named = await Promise.race([describe(lat, lng), new Promise<{ label?: string; country?: string }>((resolve) => setTimeout(() => resolve({}), 2500))]);
    return { ok: true, location: { lat, lng, accuracyM: Math.round(accuracy), label: named.label, country: named.country, at: Date.now() } };
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) return { ok: false, reason: "denied" };
    if (code === 3) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "unavailable" };
  }
}

function parse(raw: string): ExactLocation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ExactLocation;
    return typeof value?.lat === "number" && typeof value?.lng === "number" ? value : null;
  } catch {
    return null;
  }
}

/** The saved exact location, and whether the user has said no to sharing it. */
export function useExactLocation() {
  const [raw, setRaw] = useStored(KEY, "");
  const [declinedRaw, setDeclinedRaw] = useStored(DECLINED_KEY, "");
  const location = React.useMemo(() => parse(raw), [raw]);
  const save = React.useCallback(
    (next: ExactLocation | null) => {
      setRaw(next ? JSON.stringify(next) : "");
      if (next) setDeclinedRaw("");
    },
    [setRaw, setDeclinedRaw],
  );
  const setDeclined = React.useCallback((value: boolean) => setDeclinedRaw(value ? "1" : ""), [setDeclinedRaw]);
  return { location, declined: declinedRaw === "1", save, setDeclined };
}

export function formatAccuracy(m: number | undefined): string {
  if (!m) return "";
  return m >= 1000 ? `within ${(m / 1000).toFixed(1)} km` : `within ${Math.max(5, Math.round(m / 5) * 5)} m`;
}
