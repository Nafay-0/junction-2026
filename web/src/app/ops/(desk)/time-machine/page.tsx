import type { Metadata } from "next";
import { Suspense } from "react";
import { TimeMachineScreen } from "./time-machine";

export const metadata: Metadata = { title: "Time machine" };

/** /ops/time-machine?order=…&at=…: the rules as they stood at any moment, beside the rules now (MariaDB history). */
export default function TimeMachinePage() {
  return (
    <Suspense>
      <TimeMachineScreen />
    </Suspense>
  );
}
