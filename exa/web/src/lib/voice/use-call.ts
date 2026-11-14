"use client";

import * as React from "react";
import { LiveCall, NO_CALL, type CallSnapshot } from "./live-call";

/** The one live call there can be at a time, shared by everything that shows or drives it. */
export const liveCall = new LiveCall();

export function useCall(): CallSnapshot {
  return React.useSyncExternalStore(liveCall.subscribe, liveCall.getSnapshot, () => NO_CALL);
}
