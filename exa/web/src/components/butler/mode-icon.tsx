import { AudioLines, Brain, BrainCircuit, Gauge, Zap, type LucideIcon } from "lucide-react";
import type { ModeId } from "@/lib/agent/modes";

/** One picture per mode: lightning for the quickest, a brain for the ones that think longest. */
const ICONS: Record<ModeId, LucideIcon> = { ultrafast: Zap, fast: Gauge, smart: Brain, expert: BrainCircuit };

/** The icon of a mode, or the voice icon for what was said in a live call. */
export function ModeIcon({ mode, className }: { mode: ModeId | "voice"; className?: string }) {
  const Icon = mode === "voice" ? AudioLines : ICONS[mode];
  return <Icon className={className} aria-hidden />;
}
