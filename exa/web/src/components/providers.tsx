"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** App-wide client providers: tooltips, toasts, and motion that respects the reduced-motion setting. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster position="top-center" />
    </MotionConfig>
  );
}
