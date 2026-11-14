"use client";

import { useSyncExternalStore } from "react";

/**
 * Who is at the operations desk in this browser: staff (signed in with the passcode) or a viewer (looking, not
 * operating). The rail reads /ops-api/session and sets it; pages read it to show each action disabled for a viewer
 * with "Staff only". Only a hint for the screen: the server refuses every action to a viewer whatever the page shows.
 */
export type OpsRole = "staff" | "viewer" | undefined;

let role: OpsRole;
const listeners = new Set<() => void>();

export function setOpsRole(r: OpsRole): void {
  if (r === role) return;
  role = r;
  for (const l of listeners) l();
}

export function useOpsRole(): OpsRole {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => role,
    () => undefined,
  );
}

/** True until the role is known to be staff: an action stays disabled until the session says so. */
export function useViewer(): boolean {
  return useOpsRole() !== "staff";
}

export const STAFF_ONLY = "Staff only";
