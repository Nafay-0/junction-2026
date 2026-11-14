import type { ClientKind } from "@/lib/client-kind";

/*
 * A conversation belongs to the kind of client it was started in. These are the words for that,
 * in one place, for the server (which refuses a save from the other kind) and the interface
 * (which shows why the conversation cannot be continued here). Nothing here needs the database.
 */

/** "the desktop app" / "the web". */
export const originName = (origin: ClientKind) => (origin === "desktop" ? "the desktop app" : "the web");

/** Why a conversation started in `origin` cannot be continued from the other kind of client. */
export const readOnlyReason = (origin: ClientKind) =>
  origin === "desktop"
    ? "This conversation was started in the desktop app. It is read-only here: open it in the desktop app to continue."
    : "This conversation was started on the web. It is read-only in the desktop app: open it on the web to continue.";

/** The short form, for a tooltip on a row in the conversation list. */
export const readOnlyHint = (origin: ClientKind) => (origin === "desktop" ? "Started in the desktop app. Read-only here." : "Started on the web. Read-only here.");
