"use client";

import * as React from "react";
import { api } from "./fetch";
import type { SessionUser } from "./types";

/*
 * The signed-in account, for the interface. The page loads it on the server and passes it down,
 * so nothing has to wait for a request to know who is looking.
 */

const SessionContext = React.createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

/** The signed-in account. Only inside the signed-in part of the app. */
export function useUser(): SessionUser {
  const user = React.useContext(SessionContext);
  if (!user) throw new Error("useUser() was called outside <SessionProvider>: this part of the interface is only shown to a signed-in user.");
  return user;
}

/** Sign out here, then show the sign-in page. Settings kept in the browser (theme, model, place) stay. */
export async function signOut(): Promise<void> {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* offline: the cookie stays, and the next request will say so */
  }
  try {
    window.localStorage.removeItem("hovi.active");
  } catch {
    /* storage blocked */
  }
  // A full page load on purpose, not a client-side route change: nothing of the signed-out account stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}

/** Two letters for an avatar: "Ada Lovelace" gives AL, an email gives its first letter. */
export function initialsOf(user: Pick<SessionUser, "name" | "email">): string {
  const words = user.name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? user.email).slice(0, 2);
  return letters.toUpperCase();
}
