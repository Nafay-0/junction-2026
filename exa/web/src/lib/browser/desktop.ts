"use client";

import * as React from "react";

/**
 * What the desktop app offers the interface (see desktop/preload.cjs). Absent in a web browser:
 * its presence is how the interface knows it is running inside the desktop app, where the live
 * browser is a real view in the window instead of pictures from a server.
 */
export type BatonDesktop = {
  /** The browser view with this id is on screen: returns where the agent can reach it. */
  attach(webContentsId: number): Promise<string>;
  /** Wipe every sign-in, cookie and saved form entry of the browser view. */
  forget(): Promise<void>;
  version: string;
};

declare global {
  interface Window {
    batonDesktop?: BatonDesktop;
  }
}

const never = () => () => {};
const read = (): BatonDesktop | null => window.batonDesktop ?? null;

/** The desktop app's bridge, or null in a web browser (and while the page is still hydrating). */
export function useDesktopApp(): BatonDesktop | null {
  return React.useSyncExternalStore(never, read, () => null);
}
