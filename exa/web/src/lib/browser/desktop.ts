"use client";

import * as React from "react";
import type { BrowserCall, BrowserEvent, BrowserState, BrowserStepData, ControlRequest } from "./protocol";

/**
 * What the desktop app offers the interface (see desktop/preload.cjs). Absent in a web browser:
 * its presence is how the interface knows it is running inside the desktop app, where there is a
 * live browser. The engine behind it runs in the app, on the user's computer.
 */
export type BerylDesktop = {
  version: string;
  platform: string;
  browser: {
    /** Take one of the agent's steps. Resolves with the page as it then stands. */
    run(call: BrowserCall): Promise<BrowserStepData>;
    /** The user pressed Stop: steps in flight end. */
    stop(): Promise<void>;
    /** The agent hands the page to the user (`input` is what the agent's request said). */
    handover(input: unknown, toolCallId: string): Promise<void>;
    control(request: ControlRequest): Promise<BrowserState>;
    state(): Promise<BrowserState>;
    /** The browser view with this id is on screen. */
    attach(webContentsId: number): Promise<void>;
    /** Wipe every sign-in, cookie and saved form entry of one account's store. */
    forget(partition: string): Promise<void>;
    subscribe(listener: (event: BrowserEvent) => void): () => void;
  };
};

declare global {
  interface Window {
    berylDesktop?: BerylDesktop;
  }
}

const never = () => () => {};
const read = (): BerylDesktop | null => window.berylDesktop ?? null;

/** The desktop app's bridge, or null in a web browser (and while the page is still hydrating). */
export function useDesktopApp(): BerylDesktop | null {
  return React.useSyncExternalStore(never, read, () => null);
}

/** Where one account's sign-ins are kept in the desktop app: a store of its own, so accounts on one computer stay apart. */
export const browserPartition = (userId: string) => `persist:beryl-${userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "guest"}`;
