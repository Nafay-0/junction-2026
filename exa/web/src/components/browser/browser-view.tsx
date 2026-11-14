"use client";

import * as React from "react";
import { AnimatePresence, motion, useAnimationControls, type MotionStyle } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownLeft,
  Globe,
  Hourglass,
  Keyboard,
  ListChecks,
  MonitorOff,
  MousePointerClick,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import type { AgentAction, BrowserState } from "@/lib/browser/protocol";

const EASE = [0.22, 1, 0.36, 1] as const;

/** How long a step stays highlighted after it happens, in milliseconds. */
const HOLD: Record<AgentAction["kind"], number> = {
  navigate: 1300,
  click: 900,
  type: 800,
  select: 1100,
  press: 900,
  scroll: 900,
  hover: 800,
  read: 1400,
  wait: 1600,
  approval: 0,
  blocked: 2400,
};

const KIND_ICON: Record<AgentAction["kind"], React.ComponentType<{ className?: string }>> = {
  navigate: Globe,
  click: MousePointerClick,
  type: Keyboard,
  select: ListChecks,
  press: CornerDownLeft,
  scroll: ArrowDown,
  hover: MousePointerClick,
  read: ScanText,
  wait: Hourglass,
  approval: ShieldCheck,
  blocked: ShieldAlert,
};

type Size = { width: number; height: number };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

export function Placeholder({ state, hasFrame, empty }: { state: BrowserState; hasFrame: boolean; empty?: React.ReactNode }) {
  if (state.status === "ready" && hasFrame) return null;
  const base = "absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center";
  if (state.status === "starting" || state.status === "ready") {
    return (
      <div className={base} aria-live="polite">
        <div className="flex w-full max-w-[22rem] flex-col gap-2.5" aria-hidden>
          <div className="shimmer h-3 w-2/5 rounded-full" />
          <div className="shimmer h-24 w-full rounded-xl" />
          <div className="shimmer h-3 w-4/5 rounded-full" />
          <div className="shimmer h-3 w-3/5 rounded-full" />
        </div>
        <span className="text-shimmer text-[0.85rem]">{state.status === "starting" ? "Starting the browser" : "Loading the page"}</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={base} role="alert">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" />
        </span>
        <p className="text-[0.95rem] font-medium">The browser could not start</p>
        <p className="max-w-[26rem] text-[0.82rem] leading-relaxed text-muted-foreground">{state.error || "Something went wrong on the machine that runs it. Ask again in a moment."}</p>
      </div>
    );
  }
  const closed = state.status === "closed";
  const Icon = closed ? MonitorOff : Globe;
  return (
    <div className={cn(base, "backdrop-room")}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Icon className="size-5" />
      </span>
      <p className="font-display text-[1.35rem] leading-tight">{closed ? "The browser is closed" : "No browser yet"}</p>
      <p className="max-w-[24rem] text-[0.85rem] leading-relaxed text-muted-foreground">
        {closed ? "Your sign-ins are kept. The agent opens it again when a task needs it." : "The agent opens a browser here when a task needs one, and you can watch every step."}
      </p>
      {empty}
    </div>
  );
}

/* ───────────────────────── The agent's pointer ───────────────────────── */

/**
 * The agent's pointer. It lives across steps, so it glides from where the last step left it, and
 * it steps out of the way when the agent has been idle for a moment or the user takes over.
 */
export function AgentPointer({
  action,
  scale,
  viewport,
  busy,
  hidden,
}: {
  action: AgentAction | null;
  scale: number;
  viewport: Size;
  busy: boolean;
  hidden: boolean;
}) {
  const glide = useAnimationControls();
  const press = useAnimationControls();
  const handled = React.useRef<number | null>(null);
  const point = action?.point;
  const id = action?.id ?? null;
  const kind = action?.kind;
  const leadMs = action?.leadMs ?? 0;

  React.useEffect(() => {
    if (!point || id === null) return;
    const target = { x: point.x * scale, y: point.y * scale };
    if (handled.current === id) {
      // Same step, new size: stay on the target.
      glide.set(target);
      return;
    }
    handled.current = id;
    void glide.start({ ...target, opacity: 1, transition: { duration: Math.max(0.16, (leadMs / 1000) * 0.9), ease: EASE, opacity: { duration: 0.2 } } });
    if (kind !== "click" && kind !== "select") return;
    const timer = setTimeout(() => void press.start({ scale: [1, 0.8, 1], transition: { duration: 0.3, ease: "easeOut" } }), leadMs);
    return () => clearTimeout(timer);
  }, [id, point, scale, kind, leadMs, glide, press]);

  React.useEffect(() => {
    if (hidden) {
      void glide.start({ opacity: 0, transition: { duration: 0.2 } });
      return;
    }
    if (busy) return;
    // Idle: step aside after a moment. With no step to point at any more, step aside at once.
    const timer = setTimeout(() => void glide.start({ opacity: 0, transition: { duration: 0.5 } }), id === null ? 0 : 2600);
    return () => clearTimeout(timer);
  }, [hidden, busy, id, glide]);

  return (
    <motion.div
      aria-hidden
      initial={{ x: viewport.width * scale * 0.5, y: viewport.height * scale * 0.62, opacity: 0 }}
      animate={glide}
      className="pointer-events-none absolute top-0 left-0 z-40"
    >
      <motion.div animate={press} style={{ originX: 0, originY: 0 }} className="relative">
        <svg width="22" height="24" viewBox="0 0 22 24" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_2px_5px_rgb(0_0_0/0.28)]">
          <path d="M3 2 3 18.6 7.5 14.7 10.6 21.4 13.5 20.1 10.5 13.5 16.6 13.3Z" fill="var(--page-accent)" stroke="var(--page-paper)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="absolute top-[18px] left-[13px] rounded-full bg-page-accent px-1.5 py-px text-[0.62rem] leading-4 font-semibold tracking-wide whitespace-nowrap text-page-paper shadow-card">
          {APP_NAME}
        </span>
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────────── One step, drawn over the page ───────────────────────── */

export function ActionLayer({ action, scale, stage, approvalPending }: { action: AgentAction; scale: number; stage: Size; approvalPending: boolean }) {
  const text = action.text ?? "";
  const typingMs = action.kind === "type" && text ? Math.min(1100, 200 + text.length * 32) : 0;
  const [phase, setPhase] = React.useState<"lead" | "do" | "gone">("lead");
  React.useEffect(() => {
    const timers = [setTimeout(() => setPhase("do"), Math.max(0, action.leadMs))];
    if (action.kind !== "approval") timers.push(setTimeout(() => setPhase("gone"), action.leadMs + typingMs + HOLD[action.kind]));
    return () => timers.forEach(clearTimeout);
  }, [action, typingMs]);

  // An approval ring waits for as long as the user's answer is outstanding.
  const visible = action.kind === "approval" ? approvalPending || phase === "lead" : phase !== "gone";
  const done = phase === "do";
  const tone = action.kind === "blocked" ? "var(--page-stop)" : action.kind === "approval" ? "var(--page-brass)" : "var(--page-accent)";
  const box = action.box ? { x: action.box.x * scale, y: action.box.y * scale, w: action.box.width * scale, h: action.box.height * scale } : null;
  const point = action.point ? { x: action.point.x * scale, y: action.point.y * scale } : null;
  const Icon = action.kind === "scroll" && action.direction === "up" ? ArrowUp : KIND_ICON[action.kind];

  // The caption sits above its target, or below when the target touches the top of the page.
  const captionAbove = box ? box.y > 36 : false;
  const captionTop = box ? (captionAbove ? box.y - 31 : box.y + box.h + 8) : 0;
  const anchorRight = box ? box.x + box.w / 2 > stage.width * 0.62 : false;
  const captionStyle: MotionStyle = box
    ? {
        top: clamp(captionTop, 6, stage.height - 30),
        ...(anchorRight ? { right: clamp(stage.width - (box.x + box.w), 6, stage.width - 60) } : { left: clamp(box.x, 6, stage.width - 60) }),
      }
    : { bottom: 14, left: "50%", translateX: "-50%" };

  // What is being entered appears on the other side of the field from the caption.
  const bubbleBelow = box ? (captionAbove ? box.y + box.h + 44 < stage.height : false) : true;
  const bubbleTop = box ? (bubbleBelow ? box.y + box.h + 8 : captionAbove ? box.y - 31 - 38 : box.y + box.h + 42) : 0;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div key="step" className="pointer-events-none absolute inset-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}>
          {action.kind === "read" ? <ReadSweep height={stage.height} /> : null}

          {box ? (
            <motion.div
              initial={{ opacity: 0, scale: 1.05 }}
              animate={action.kind === "blocked" ? { opacity: 1, scale: 1, x: [0, -5, 5, -3, 3, 0] } : { opacity: 1, scale: 1 }}
              transition={{ duration: action.kind === "blocked" ? 0.45 : 0.28, ease: EASE }}
              style={{
                left: box.x - 4,
                top: box.y - 4,
                width: box.w + 8,
                height: box.h + 8,
                border: `2px solid ${tone}`,
                background: `color-mix(in oklch, ${tone} 9%, transparent)`,
                boxShadow: `0 0 0 1px color-mix(in oklch, var(--page-paper) 70%, transparent), 0 0 0 5px color-mix(in oklch, ${tone} 20%, transparent), inset 0 0 0 1px color-mix(in oklch, var(--page-paper) 55%, transparent)`,
              }}
              className="absolute rounded-lg"
            >
              {action.kind === "approval" ? (
                <motion.span
                  className="absolute -inset-1 rounded-[0.7rem]"
                  style={{ boxShadow: `0 0 0 3px color-mix(in oklch, ${tone} 30%, transparent)` }}
                  animate={{ opacity: [0.9, 0.25, 0.9] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                />
              ) : null}
            </motion.div>
          ) : null}

          {/* A click lands: two soft rings from the spot. */}
          {done && action.kind === "click" && point
            ? [0, 0.14].map((delay) => (
                <motion.span
                  key={delay}
                  initial={{ opacity: 0.55, scale: 0.3 }}
                  animate={{ opacity: 0, scale: 2.4 }}
                  transition={{ duration: 0.7, delay, ease: "easeOut" }}
                  style={{ left: point.x - 14, top: point.y - 14, border: `1.5px solid ${tone}`, background: `color-mix(in oklch, ${tone} 12%, transparent)` }}
                  className="absolute size-7 rounded-full"
                />
              ))
            : null}

          {action.kind === "scroll" ? <ScrollHint up={action.direction === "up"} stage={stage} /> : null}

          <motion.div
            initial={{ opacity: 0, y: box ? (captionAbove ? 4 : -4) : 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={captionStyle}
            className={cn(
              "absolute flex max-w-[min(24rem,82%)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] leading-4 font-medium shadow-float",
              action.kind === "blocked" ? "bg-page-stop text-page-paper" : "bg-page-ink/92 text-page-paper",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{action.label}</span>
          </motion.div>

          {done && text && box && (action.kind === "type" || action.kind === "select") ? (
            <motion.div
              initial={{ opacity: 0, y: bubbleBelow ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              style={{ top: clamp(bubbleTop, 6, stage.height - 38), ...(anchorRight ? { right: clamp(stage.width - (box.x + box.w), 6, stage.width - 60) } : { left: clamp(box.x, 6, stage.width - 60) }) }}
              className="absolute flex max-w-[min(26rem,86%)] items-center gap-1.5 rounded-lg border border-page-ink/15 bg-page-paper px-2.5 py-1.5 text-[0.8rem] leading-5 font-medium text-page-ink shadow-float"
            >
              {action.kind === "select" ? <Check className="size-3.5 shrink-0 text-page-accent" /> : null}
              {action.kind === "type" ? <Typed text={text} durationMs={typingMs} /> : <span className="truncate">{text}</span>}
            </motion.div>
          ) : null}

          {done && text && action.kind === "press" ? (
            <motion.kbd
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.22, ease: EASE }}
              style={box ? { left: clamp(box.x + box.w + 10, 6, stage.width - 80), top: clamp(box.y + box.h / 2 - 14, 6, stage.height - 34) } : { left: "50%", bottom: 50, translateX: "-50%" }}
              className="absolute rounded-md border border-page-ink/20 bg-page-paper px-2 py-1 font-sans text-[0.72rem] font-semibold text-page-ink [box-shadow:inset_0_-2px_0_color-mix(in_oklch,var(--page-ink)_14%,transparent),var(--shadow-float)]"
            >
              {text}
            </motion.kbd>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Text that appears a few characters at a time, with a caret, as if typed. */
function Typed({ text, durationMs }: { text: string; durationMs: number }) {
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const total = text.length;
    const step = Math.max(1, Math.ceil(total / Math.max(1, durationMs / 40)));
    const timer = setInterval(() => {
      setShown((n) => {
        const next = Math.min(total, n + step);
        if (next >= total) clearInterval(timer);
        return next;
      });
    }, 40);
    return () => clearInterval(timer);
  }, [text, durationMs]);
  return (
    <span className="flex min-w-0 items-center">
      <span className="truncate whitespace-pre">{text.slice(0, shown)}</span>
      <motion.span aria-hidden className="ml-px inline-block h-4 w-[1.5px] shrink-0 rounded-full bg-page-accent" animate={{ opacity: [1, 0.15, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
    </span>
  );
}

/** Looking over the page: one quiet band of light from top to bottom. */
function ReadSweep({ height }: { height: number }) {
  const band = Math.max(60, height * 0.24);
  return (
    <motion.div
      initial={{ y: -band, opacity: 0 }}
      animate={{ y: height, opacity: [0, 1, 1, 0] }}
      transition={{ duration: 1.35, ease: "easeInOut" }}
      style={{
        height: band,
        background: "linear-gradient(to bottom, transparent, color-mix(in oklch, var(--page-accent) 13%, transparent) 55%, color-mix(in oklch, var(--page-accent) 32%, transparent) 98%, transparent)",
      }}
      className="absolute inset-x-0 top-0"
    />
  );
}

function ScrollHint({ up, stage }: { up: boolean; stage: Size }) {
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <motion.div
      initial={{ opacity: 0, y: up ? 10 : -10 }}
      animate={{ opacity: [0, 1, 1, 0], y: up ? -14 : 14 }}
      transition={{ duration: 1, ease: "easeOut" }}
      style={{ right: 16, top: stage.height / 2 - 20 }}
      className="absolute flex size-10 items-center justify-center rounded-full bg-page-ink/88 text-page-paper shadow-float"
    >
      <Arrow className="size-[1.1rem]" />
    </motion.div>
  );
}

/* ───────────────────────── The user's input, passed to the page ───────────────────────── */
