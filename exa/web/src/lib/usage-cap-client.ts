"use client";

import * as React from "react";
import { api } from "@/lib/auth/fetch";
import { USAGE_CAP_CODE, USAGE_CAP_SENTENCE, type CapStatus } from "@/lib/usage-cap";

/*
 * Where the signed-in account stands against the usage limit its admin set, as the interface
 * knows it. The server is the one that refuses; this only lets the interface stop offering what
 * would be refused, and say why. One copy for the whole app, so the chat, a live call and the
 * dialog all agree.
 */

const NONE: CapStatus = { reached: false, capUsd: null, spentUsd: null, adminEmail: null };

let status: CapStatus = NONE;
const listeners = new Set<() => void>();

function set(next: CapStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Ask the server where the account stands. Also how the interface learns that the admin has raised the limit. */
export async function refreshCap(): Promise<CapStatus> {
  try {
    const response = await api("/api/usage");
    if (response.ok) set((await response.json()) as CapStatus);
  } catch {
    /* offline: what was known stands */
  }
  return status;
}

/** The server has just refused or stopped something for the limit: say so at once, then fetch the details. */
export function markCapReached(): void {
  if (!status.reached) set({ ...status, reached: true });
  void refreshCap();
}

export function useCap(): CapStatus {
  return React.useSyncExternalStore(
    subscribe,
    () => status,
    () => NONE,
  );
}

/** True when what a request came back with is the limit's refusal, however it was wrapped. */
export function isCapRefusal(problem: unknown): boolean {
  const text = problem instanceof Error ? problem.message : typeof problem === "string" ? problem : "";
  return text.includes(`"${USAGE_CAP_CODE}"`) || text.includes(USAGE_CAP_SENTENCE);
}
