"use client";

import * as React from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { LoaderCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { control, useBrowser } from "@/lib/browser/client";
import { useDesktopApp } from "@/lib/browser/desktop";
import { ActionLayer, AgentPointer, Placeholder } from "./browser-view";

type Size = { width: number; height: number };

/** Electron's browser view element. React does not know it, so it is made and kept by hand. */
type ViewElement = HTMLElement & { getWebContentsId(): number };

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The live browser: the page itself, in a browser view that belongs to the desktop app's window.
 * While the user is in control they click and type straight into it, exactly as in any browser.
 * While the agent is driving, what it does is drawn on top: its pointer, a ring round what it is
 * about to press, the text it types.
 */
export function BrowserView({
  partition,
  className,
  empty,
}: {
  /** The store this account's sign-ins are kept in (see browserPartition). */
  partition: string;
  className?: string;
  /** Extra content under the "no browser yet" message, for example a button. */
  empty?: React.ReactNode;
}) {
  const desktop = useDesktopApp();
  const { state, action: latest, fresh, connected } = useBrowser();
  const action = latest && (fresh || (latest.kind === "approval" && Boolean(state.approval))) ? latest : null;

  const room = React.useRef<HTMLDivElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
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

  // The view exists while the server wants a browser: it appears when a task (or the user) opens
  // one and goes when the browser is closed. Putting it on screen is what starts the bridge.
  const wanted = state.status === "starting" || state.status === "ready";
  React.useEffect(() => {
    const parent = host.current;
    if (!wanted || !parent || !desktop) return;
    const view = document.createElement("webview") as ViewElement;
    view.setAttribute("src", "about:blank");
    view.setAttribute("partition", partition);
    view.setAttribute("allowpopups", "true");
    view.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:inline-flex;background:#fff";
    let gone = false;
    const onReady = () => {
      view.removeEventListener("dom-ready", onReady);
      if (!gone) void desktop.browser.attach(view.getWebContentsId()).catch(() => {});
    };
    view.addEventListener("dom-ready", onReady);
    parent.appendChild(view);
    return () => {
      gone = true;
      view.removeEventListener("dom-ready", onReady);
      view.remove();
    };
  }, [wanted, desktop, partition]);

  // Tell the server how much room the view has, so the page is laid out to fit it.
  const ready = state.status === "ready";
  const width = space?.width ?? 0;
  const height = space?.height ?? 0;
  React.useEffect(() => {
    if (!ready || width < 100 || height < 100) return;
    const timer = setTimeout(() => void control({ action: "fit", width, height }).catch(() => {}), 160);
    return () => clearTimeout(timer);
  }, [ready, width, height]);

  const userControl = ready && state.control === "user";
  const scale = ready && state.viewport.width > 0 && width > 0 ? width / state.viewport.width : 0;
  const stage: Size = { width, height };

  const [nudge, setNudge] = React.useState<{ id: number; x: number; y: number } | null>(null);
  const nudgeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  return (
    <MotionConfig reducedMotion="user">
      <div ref={room} className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-card shadow-card", className)}>
        {/* The browser itself. */}
        <div ref={host} className={cn("absolute inset-0", ready ? "opacity-100" : "opacity-0")} />

        {/* While the agent is driving, the page is not the user's to click: say so instead of doing nothing. */}
        {ready && !userControl ? (
          <div
            className="absolute inset-0 z-20 cursor-not-allowed"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setNudge({ id: Date.now(), x: e.clientX - rect.left, y: e.clientY - rect.top });
              clearTimeout(nudgeTimer.current);
              nudgeTimer.current = setTimeout(() => setNudge(null), 2200);
            }}
          />
        ) : null}

        {ready && state.loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-page-accent/20">
            <div className="h-full w-1/3 animate-sweep bg-page-accent" />
          </div>
        ) : null}

        {ready && scale > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-30">
            {state.control === "agent" && action ? <ActionLayer key={action.id} action={action} scale={scale} stage={stage} approvalPending={Boolean(state.approval)} /> : null}
            <AgentPointer action={action} scale={scale} viewport={state.viewport} busy={state.busy || Boolean(state.approval)} hidden={state.control !== "agent"} />
          </div>
        ) : null}

        {/* The user is in control: a brass edge. Their clicks and keys go to the page itself. */}
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 z-30 rounded-xl transition-opacity duration-300", userControl ? "opacity-100" : "opacity-0")}
          style={{ boxShadow: "inset 0 0 0 2px color-mix(in oklch, var(--page-brass) 85%, transparent)" }}
        />

        <AnimatePresence>
          {nudge ? (
            <motion.div
              key={nudge.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              style={{ left: Math.min(Math.max(nudge.x - 120, 8), Math.max(8, width - 256)), top: Math.min(Math.max(nudge.y + 14, 8), Math.max(8, height - 44)) }}
              className="pointer-events-none absolute z-40 w-[15.5rem] rounded-xl bg-page-ink/92 px-3 py-2 text-[0.72rem] leading-snug text-page-paper shadow-float"
            >
              {APP_NAME} is driving. Press <span className="font-semibold">Take over</span> to use the page yourself.
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Placeholder state={state} hasFrame={ready} empty={empty} />

        <AnimatePresence>
          {!connected && state.status !== "idle" ? (
            <motion.div key="offline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-page-ink/92 px-3 py-1.5 text-[0.72rem] font-medium text-page-paper shadow-float">
                <WifiOff className="size-3.5" />
                Connection lost. Reconnecting
                <LoaderCircle className="size-3.5 animate-spin" />
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
