"use client";

import * as React from "react";
import { AnimatePresence, MotionConfig, motion, useAnimationControls, type MotionStyle } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownLeft,
  Globe,
  Hourglass,
  Keyboard,
  ListChecks,
  LoaderCircle,
  MonitorOff,
  MousePointerClick,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { frameSrc, sendInput, subscribeFrames, useBrowser } from "@/lib/browser/client";
import { useDesktopApp } from "@/lib/browser/desktop";
import { VIEWPORT, type AgentAction, type BrowserState, type UserInput } from "@/lib/browser/protocol";
import { DesktopBrowserView } from "./desktop-view";

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

/**
 * The live page: the newest picture of it, what the agent is doing drawn on top, and, while the
 * user is in control, their mouse, touch and keyboard passed through to the page.
 */
export function BrowserView(props: {
  browserId: string;
  className?: string;
  /** Extra content under the "no browser yet" message, for example a button. */
  empty?: React.ReactNode;
}) {
  // In the desktop app the browser is a real view in the window; on the web it is pictures from the server.
  const desktop = useDesktopApp();
  return desktop ? <DesktopBrowserView {...props} desktop={desktop} /> : <StreamedBrowserView {...props} />;
}

function StreamedBrowserView({
  browserId,
  className,
  empty,
}: {
  browserId: string;
  className?: string;
  empty?: React.ReactNode;
}) {
  const { state, action: latest, fresh, connected } = useBrowser(browserId);
  // Only a step that is happening now is drawn. The last one is not replayed when this view is
  // opened again or the agent gets the page back; a step waiting for approval stays marked.
  const action = latest && (fresh || (latest.kind === "approval" && Boolean(state.approval))) ? latest : null;
  const viewport = state.viewport.width > 0 && state.viewport.height > 0 ? state.viewport : VIEWPORT;

  /* Fit the page into whatever room there is, keeping its shape. */
  const room = React.useRef<HTMLDivElement>(null);
  const [space, setSpace] = React.useState<Size | null>(null);
  React.useEffect(() => {
    const el = room.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSpace({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = space ? Math.min(space.width / viewport.width, space.height / viewport.height) : 0;
  // On a phone or in a narrow pane the whole page is too small to read. Zooming in shows part of
  // it at a readable size; the view then follows the agent's pointer, and a drag moves around.
  const [wantZoom, setWantZoom] = React.useState(false);
  const canZoom = fit > 0 && fit < 0.56;
  const zoomed = wantZoom && canZoom;
  const scale = zoomed ? clamp(fit * 2.2, 0.6, 1) : fit;
  const stage: Size = { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };

  /* Frames go straight to the image: no React state per frame. */
  const image = React.useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = React.useState(false);
  React.useEffect(() => {
    return subscribeFrames(browserId, (frame) => {
      if (image.current) image.current.src = frameSrc(frame);
      setHasFrame(true);
    });
  }, [browserId]);

  const ready = state.status === "ready";
  const userControl = ready && state.control === "user";
  const stageRef = React.useRef<HTMLDivElement>(null);
  const sinkRef = React.useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = React.useState(false);
  const [nudge, setNudge] = React.useState<{ id: number; x: number; y: number } | null>(null);
  const nudgeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  const input = useUserInput({ browserId, stageRef, sinkRef, roomRef: room, scale, viewport, enabled: userControl });

  // Zoomed in while the agent works: keep what it is doing in the middle of the view.
  const followId = action?.id;
  const followPoint = action?.point;
  React.useEffect(() => {
    const el = room.current;
    if (!el || !zoomed || !followPoint) return;
    el.scrollTo({ left: followPoint.x * scale - el.clientWidth / 2, top: followPoint.y * scale - el.clientHeight / 2, behavior: "smooth" });
  }, [zoomed, followId, followPoint, scale]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (userControl) {
      input.onPointerDown(e);
      return;
    }
    if (!ready) return;
    // The agent is driving: say so where the user clicked, instead of doing nothing.
    const rect = e.currentTarget.getBoundingClientRect();
    setNudge({ id: Date.now(), x: e.clientX - rect.left, y: e.clientY - rect.top });
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => setNudge(null), 2200);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("relative flex min-h-0 min-w-0 flex-1", className)}>
      <div ref={room} className={cn("min-h-0 min-w-0 flex-1", zoomed ? "overflow-auto overscroll-contain rounded-xl" : "flex items-start justify-center")}>
        <div
          ref={stageRef}
          role="group"
          aria-label={ready ? `Live browser: ${state.title || state.url || "page"}` : "Live browser"}
          onPointerDown={onPointerDown}
          onPointerMove={userControl ? input.onPointerMove : undefined}
          onPointerUp={userControl ? input.onPointerUp : undefined}
          onPointerCancel={userControl ? input.onPointerCancel : undefined}
          onContextMenu={userControl ? (e) => e.preventDefault() : undefined}
          style={scale > 0 ? { width: stage.width, height: stage.height } : { width: "100%", aspectRatio: `${viewport.width} / ${viewport.height}` }}
          className={cn(
            "relative shrink-0 overflow-hidden rounded-xl bg-card shadow-card outline-none select-none",
            "transition-shadow duration-300",
            userControl ? "cursor-default touch-none" : ready ? "cursor-not-allowed" : "cursor-default",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={image}
            alt=""
            draggable={false}
            className={cn("pointer-events-none absolute inset-0 size-full transition-[opacity,filter] duration-300", hasFrame && ready ? "opacity-100" : "opacity-0", !connected && "saturate-50")}
          />

          {/* Where the keyboard goes while the user is in control. A real text field, so a phone's
              keyboard opens and composed or dictated text arrives; it is never shown. */}
          {userControl ? (
            <textarea
              ref={sinkRef}
              aria-label="Type into the page. Your keys go to the page, not to the chat."
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              rows={1}
              defaultValue={SENTINEL}
              onKeyDown={input.onKeyDown}
              onKeyUp={input.onKeyUp}
              onInput={input.onInput}
              onCompositionEnd={input.onCompositionEnd}
              onPaste={input.onPaste}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                input.releaseKeys();
              }}
              className="pointer-events-none absolute top-1/2 left-1/2 size-px resize-none overflow-hidden border-0 bg-transparent p-0 text-[16px] opacity-0 outline-none"
            />
          ) : null}

          {/* Page loading: a thin line along the top. */}
          {ready && state.loading ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-page-accent/20">
              <div className="h-full w-1/3 animate-sweep bg-page-accent" />
            </div>
          ) : null}

          {ready && scale > 0 ? (
            <>
              {state.control === "agent" && action ? <ActionLayer key={action.id} action={action} scale={scale} stage={stage} approvalPending={Boolean(state.approval)} /> : null}
              <AgentPointer action={action} scale={scale} viewport={viewport} busy={state.busy || Boolean(state.approval)} hidden={state.control !== "agent"} />
            </>
          ) : null}

          {/* The user is in control: a brass edge, brighter once the page has the keyboard. */}
          <div
            aria-hidden
            className={cn("pointer-events-none absolute inset-0 z-30 rounded-xl transition-opacity duration-300", userControl ? "opacity-100" : "opacity-0")}
            style={{
              boxShadow: `inset 0 0 0 ${focused ? 2.5 : 2}px color-mix(in oklch, var(--page-brass) ${focused ? 100 : 75}%, transparent), inset 0 0 ${focused ? 30 : 18}px color-mix(in oklch, var(--page-brass) ${focused ? 30 : 16}%, transparent)`,
            }}
          />
          <AnimatePresence>
            {userControl && !focused ? (
              <motion.div
                key="hint"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="pointer-events-none absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-page-ink/92 px-3 py-1.5 text-[0.72rem] font-medium whitespace-nowrap text-page-paper shadow-float"
              >
                <Keyboard className="size-3.5" />
                Click the page to type in it
              </motion.div>
            ) : null}
            {nudge ? (
              <motion.div
                key={nudge.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE }}
                style={{ left: clamp(nudge.x - 120, 8, stage.width - 256), top: clamp(nudge.y + 14, 8, stage.height - 44) }}
                className="pointer-events-none absolute z-40 w-[15.5rem] rounded-xl bg-page-ink/92 px-3 py-2 text-[0.72rem] leading-snug text-page-paper shadow-float"
              >
                {APP_NAME} is driving. Press <span className="font-semibold">Take over</span> to use the page yourself.
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Placeholder state={state} hasFrame={hasFrame} empty={empty} />

          <AnimatePresence>
            {!connected && state.status !== "idle" ? (
              <motion.div
                key="offline"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center"
              >
                <span className="flex items-center gap-1.5 rounded-full bg-page-ink/92 px-3 py-1.5 text-[0.72rem] font-medium text-page-paper shadow-float">
                  <WifiOff className="size-3.5" />
                  Connection lost. Reconnecting
                  <LoaderCircle className="size-3.5 animate-spin" />
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      {ready && canZoom ? (
        <button
          type="button"
          onClick={() => setWantZoom((v) => !v)}
          aria-label={zoomed ? "Show the whole page" : "Zoom in"}
          aria-pressed={zoomed}
          className="absolute right-2 bottom-2 z-50 flex size-9 items-center justify-center rounded-full bg-page-ink/88 text-page-paper shadow-float transition-transform active:scale-95"
        >
          {zoomed ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
        </button>
      ) : null}
      </div>
    </MotionConfig>
  );
}

/* ───────────────────────── What shows when there is no page ───────────────────────── */

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

const BUTTONS = ["left", "middle", "right"] as const;
/** Kept in the hidden text field so that Backspace on a phone keyboard has something to delete, and so reports itself. */
const SENTINEL = "\u200b";

/**
 * Turns what the user does on the picture into input for the real page. Only used while the user
 * is in control. Nothing here is logged or kept: events go to the batcher and are gone.
 */
function useUserInput({
  browserId,
  stageRef,
  sinkRef,
  roomRef,
  scale,
  viewport,
  enabled,
}: {
  browserId: string;
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** The box the page sits in. It scrolls when the page is zoomed in. */
  roomRef: React.RefObject<HTMLDivElement | null>;
  /** The hidden text field that holds the keyboard. */
  sinkRef: React.RefObject<HTMLTextAreaElement | null>;
  scale: number;
  viewport: Size;
  enabled: boolean;
}) {
  const down = React.useRef(new Set<string>());
  const lastClick = React.useRef({ at: 0, x: 0, y: 0, count: 0 });
  const touch = React.useRef<{ id: number; startX: number; startY: number; lastX: number; lastY: number; at: number; moved: boolean } | null>(null);

  const send = React.useCallback((...events: UserInput[]) => sendInput(browserId, events), [browserId]);

  const toPage = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || scale <= 0) return { x: 0, y: 0 };
      return { x: Math.round(clamp((clientX - rect.left) / scale, 0, viewport.width - 1)), y: Math.round(clamp((clientY - rect.top) / scale, 0, viewport.height - 1)) };
    },
    [stageRef, scale, viewport.width, viewport.height],
  );

  /** Move the zoomed-in view first; what it cannot take is left over for the page itself. */
  const pan = React.useCallback(
    (dx: number, dy: number) => {
      const el = roomRef.current;
      if (!el) return { dx, dy };
      const left = el.scrollLeft;
      const top = el.scrollTop;
      el.scrollLeft = left + dx;
      el.scrollTop = top + dy;
      return { dx: dx - (el.scrollLeft - left), dy: dy - (el.scrollTop - top) };
    },
    [roomRef],
  );

  const releaseKeys = React.useCallback(() => {
    if (down.current.size === 0) return;
    send(...[...down.current].map((key): UserInput => ({ type: "key", action: "up", key })));
    down.current.clear();
  }, [send]);

  // The wheel has to be a real listener: React's own cannot stop the chat from scrolling too.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.height : 1;
      const rest = pan(e.deltaX * unit, e.deltaY * unit);
      if (Math.abs(rest.dx) < 0.5 && Math.abs(rest.dy) < 0.5) return;
      const at = toPage(e.clientX, e.clientY);
      // Divided by the scale so the page moves under the pointer as far as the wheel turned.
      send({ type: "wheel", ...at, deltaX: clamp(rest.dx / scale, -2400, 2400), deltaY: clamp(rest.dy / scale, -2400, 2400) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, enabled, scale, viewport.height, toPage, send, pan]);

  // Leaving control with a key held would leave it stuck down in the page.
  React.useEffect(() => {
    if (!enabled) releaseKeys();
  }, [enabled, releaseKeys]);

  const focusSink = () => {
    const el = sinkRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.value = SENTINEL;
    el.setSelectionRange(1, 1);
  };
  const tap = (key: string) => send({ type: "key", action: "down", key }, { type: "key", action: "up", key });

  return {
    releaseKeys,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      focusSink();
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      if (e.pointerType === "touch") {
        touch.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, at: e.timeStamp, moved: false };
        return;
      }
      const at = toPage(e.clientX, e.clientY);
      const last = lastClick.current;
      const again = e.timeStamp - last.at < 450 && Math.abs(at.x - last.x) < 6 && Math.abs(at.y - last.y) < 6;
      lastClick.current = { at: e.timeStamp, ...at, count: again ? last.count + 1 : 1 };
      send({ type: "mouse", action: "move", ...at }, { type: "mouse", action: "down", ...at, button: BUTTONS[e.button] ?? "left", clickCount: lastClick.current.count });
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") {
        const t = touch.current;
        if (!t || t.id !== e.pointerId) return;
        if (!t.moved && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < 8) return;
        t.moved = true;
        // A finger dragging the picture moves the zoomed-in view, then scrolls the page.
        const rest = pan(t.lastX - e.clientX, t.lastY - e.clientY);
        t.lastX = e.clientX;
        t.lastY = e.clientY;
        if (Math.abs(rest.dx) >= 0.5 || Math.abs(rest.dy) >= 0.5) send({ type: "wheel", ...toPage(e.clientX, e.clientY), deltaX: rest.dx / scale, deltaY: rest.dy / scale });
        return;
      }
      send({ type: "mouse", action: "move", ...toPage(e.clientX, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const at = toPage(e.clientX, e.clientY);
      if (e.pointerType === "touch") {
        const t = touch.current;
        touch.current = null;
        if (!t || t.moved || e.timeStamp - t.at > 700) return;
        // A tap is a click. Asking for the keyboard again here: some phones only open it at the end of a touch.
        focusSink();
        send({ type: "mouse", action: "move", ...at }, { type: "mouse", action: "down", ...at, button: "left", clickCount: 1 }, { type: "mouse", action: "up", ...at, button: "left", clickCount: 1 });
        return;
      }
      send({ type: "mouse", action: "up", ...at, button: BUTTONS[e.button] ?? "left", clickCount: lastClick.current.count });
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") {
        touch.current = null;
        return;
      }
      send({ type: "mouse", action: "up", ...toPage(e.clientX, e.clientY), button: "left" });
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Paste arrives as its own event; let the browser raise it.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") return;
      // A phone keyboard or an input method does not name its keys: the text arrives as input instead.
      if (e.key === "Unidentified" || e.key === "Process" || e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      down.current.add(e.key);
      send({ type: "key", action: "down", key: e.key });
    },
    onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!down.current.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      down.current.delete(e.key);
      send({ type: "key", action: "up", key: e.key });
    },
    /** Text that did not come as named keys: a phone keyboard, dictation, autofill. */
    onInput: (e: React.FormEvent<HTMLTextAreaElement>) => {
      const native = e.nativeEvent as InputEvent;
      if (native.isComposing) return;
      const el = e.currentTarget;
      const text = el.value.replaceAll(SENTINEL, "");
      if (native.inputType === "deleteContentBackward" || (!text && !el.value)) tap("Backspace");
      else if (native.inputType === "insertLineBreak" || native.inputType === "insertParagraph" || text === "\n") tap("Enter");
      else if (text) send({ type: "text", text });
      el.value = SENTINEL;
      el.setSelectionRange(1, 1);
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      if (e.data) send({ type: "text", text: e.data });
      e.currentTarget.value = SENTINEL;
      e.currentTarget.setSelectionRange(1, 1);
    },
    onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      if (text) send({ type: "text", text });
    },
  };
}

/* ───────────────────────── A small live picture ───────────────────────── */

/** The page as a thumbnail, fed by the same stream as the full view. */
export function BrowserThumbnail({ browserId, className }: { browserId: string; className?: string }) {
  const image = React.useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = React.useState(false);
  React.useEffect(() => {
    return subscribeFrames(browserId, (frame) => {
      if (image.current) image.current.src = frameSrc(frame);
      setHasFrame(true);
    });
  }, [browserId]);
  return (
    <span className={cn("relative block overflow-hidden bg-surface", className)} style={{ aspectRatio: `${VIEWPORT.width} / ${VIEWPORT.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={image} alt="" draggable={false} className={cn("absolute inset-0 size-full object-cover object-top transition-opacity duration-300", hasFrame ? "opacity-100" : "opacity-0")} />
      {hasFrame ? null : <span className="shimmer absolute inset-0" aria-hidden />}
    </span>
  );
}
