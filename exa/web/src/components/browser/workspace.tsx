"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Columns2, MessageSquare, PanelRightClose } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { control, useBrowser, watchBrowser } from "@/lib/browser/client";
import { IDLE_STATE, type BrowserState, type HandoverAnswer } from "@/lib/browser/protocol";
import { useMediaQuery, useStored } from "@/lib/use-client";
import { BrowserPane } from "./browser-pane";

export type BrowserLayoutMode = "closed" | "split" | "full";

type Layout = {
  /** How the live browser is shown right now. */
  mode: BrowserLayoutMode;
  /** Show the live browser: beside the chat by default, or filling the window. */
  open: (mode?: "split" | "full") => void;
  close: () => void;
};

const LayoutContext = React.createContext<Layout | null>(null);
const NO_LAYOUT: Layout = { mode: "closed", open: () => {}, close: () => {} };

/** For anything in the chat that wants to open or close the live browser. Safe to call outside a workspace. */
export function useBrowserLayout(): Layout {
  return React.useContext(LayoutContext) ?? NO_LAYOUT;
}

const MODE_KEY = "hovi.browser.mode";
const SPLIT_KEY = "hovi.browser.split";
const DEFAULT_SPLIT = 0.58;
/** Narrowest useful browser pane and chat, in pixels. */
const MIN_PANE = 360;
const MIN_CHAT = 380;
const EASE = [0.22, 1, 0.36, 1] as const;

const asMode = (value: string): BrowserLayoutMode => (value === "split" || value === "full" ? value : "closed");

/*
 * The layout belongs to this tab: it survives a reload, but opening the browser in one tab does
 * not open it in another. (The divider's position is a preference, so that one is shared.)
 */
const modeListeners = new Set<() => void>();
let modeInMemory: string | null = null;

function readMode(): string {
  if (modeInMemory !== null) return modeInMemory;
  try {
    return window.sessionStorage.getItem(MODE_KEY) ?? "closed";
  } catch {
    return "closed";
  }
}

function writeMode(next: BrowserLayoutMode) {
  modeInMemory = next;
  try {
    window.sessionStorage.setItem(MODE_KEY, next);
  } catch {
    /* storage blocked: the choice holds for this visit */
  }
  modeListeners.forEach((listener) => listener());
}

function subscribeMode(onChange: () => void) {
  modeListeners.add(onChange);
  return () => {
    modeListeners.delete(onChange);
  };
}

/**
 * Hosts the live browser next to the chat.
 *
 * Wide screens: the browser on the left and the chat on the right with a divider to drag, or the
 * browser filling the window with the chat one tap away. Phones: the browser is a full-screen
 * sheet over the chat. It opens by itself when the agent starts a browser and whenever the agent
 * hands the page to the user; after that, closing it is the user's choice and stays.
 */
export function BrowserWorkspace({
  browserId,
  onHandoverDone,
  children,
}: {
  browserId: string;
  /** The user finished or skipped what the agent asked for. `toolCallId` names the agent's waiting request. */
  onHandoverDone: (answer: HandoverAnswer, toolCallId?: string) => void;
  /** The chat. */
  children: React.ReactNode;
}) {
  const { state } = useBrowser(browserId);
  const wide = useMediaQuery("(min-width: 768px)");
  const storedMode = React.useSyncExternalStore(subscribeMode, readMode, () => "closed");
  const [storedSplit, setStoredSplit] = useStored(SPLIT_KEY, String(DEFAULT_SPLIT));
  /** True once the user has opened the pane themselves, so it may show before there is a browser. */
  const [asked, setAsked] = React.useState(false);
  /** In full-screen mode: whether the chat is slid in over the page. */
  const [peek, setPeek] = React.useState(false);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

  const stored = asMode(storedMode);
  // With no browser running there is nothing to show unless the user asked for the pane.
  const mode: BrowserLayoutMode = stored !== "closed" && state.status === "idle" && !asked ? "closed" : stored;
  const split = clampSplit(dragging ?? (Number(storedSplit) || DEFAULT_SPLIT));

  const modeRef = React.useRef(stored);
  React.useEffect(() => {
    modeRef.current = stored;
  }, [stored]);

  /* Open by itself when a browser starts, and whenever the agent hands the page over. */
  React.useEffect(() => {
    return watchBrowser(browserId, (next: BrowserState, previous: BrowserState) => {
      // The first message after connecting describes what already was: not news.
      if (previous === IDLE_STATE) return;
      const started = (previous.status === "idle" || previous.status === "closed") && (next.status === "starting" || next.status === "ready");
      const handedOver = Boolean(next.handover) && (!previous.handover || previous.handover.toolCallId !== next.handover?.toolCallId);
      if ((started || handedOver) && modeRef.current === "closed") writeMode("split");
      // The browser was closed (the agent finished there, or the user chose "Close browser"): the
      // pane has nothing left to show, so the chat gets its room back.
      const ended = previous.status === "ready" && (next.status === "closed" || next.status === "idle");
      if (ended && modeRef.current !== "closed") {
        setPeek(false);
        writeMode("closed");
      }
      // An approval is answered in the chat: bring the chat in when the page covers it.
      if (next.approval && !previous.approval && modeRef.current === "full") setPeek(true);
    });
  }, [browserId]);

  const open = React.useCallback(
    (next: "split" | "full" = "split") => {
      setAsked(true);
      setPeek(false);
      writeMode(next);
    },
    [],
  );
  const close = React.useCallback(() => {
    setPeek(false);
    writeMode("closed");
  }, []);
  const layout = React.useMemo<Layout>(() => ({ mode, open, close }), [mode, open, close]);

  const answerHandover = React.useCallback(
    (answer: HandoverAnswer) => {
      const toolCallId = state.handover?.toolCallId;
      void control(browserId, { action: "release" })
        .catch((err: unknown) => void toast.error(err instanceof Error ? err.message : "The browser did not respond."))
        .then(() => onHandoverDone(answer, toolCallId));
    },
    [browserId, state.handover?.toolCallId, onHandoverDone],
  );

  /* Full screen: Escape steps back to the split view (unless the page itself has the keyboard). */
  const full = wide && mode === "full";
  React.useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setPeek(false);
      writeMode("split");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  /* The divider. */
  const ratioAt = (clientX: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return split;
    const min = MIN_PANE / rect.width;
    const max = 1 - MIN_CHAT / rect.width;
    return Math.min(Math.max((clientX - rect.left) / rect.width, min), Math.max(min, max));
  };
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
    setDragging(ratioAt(e.clientX));
  };
  const onDividerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging !== null) setDragging(ratioAt(e.clientX));
  };
  const onDividerUp = () => {
    document.body.style.userSelect = "";
    if (dragging !== null) setStoredSplit(dragging.toFixed(3));
    setDragging(null);
  };
  const onDividerKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -0.03 : e.key === "ArrowRight" ? 0.03 : 0;
    if (!step) return;
    e.preventDefault();
    setStoredSplit(clampSplit(split + step).toFixed(3));
  };

  const showPane = mode !== "closed";
  const sheet = !wide && showPane;
  const paneMode = mode === "full" ? "full" : "split";

  return (
    <LayoutContext.Provider value={layout}>
      <div ref={root} className="relative flex min-h-0 min-w-0 flex-1">
        <AnimatePresence initial={false}>
          {showPane ? (
            <motion.div
              key="pane"
              initial={sheet ? { opacity: 0, y: 24 } : { opacity: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={sheet ? { opacity: 0, y: 24 } : { opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              style={wide && mode === "split" ? { width: `${split * 100}%`, minWidth: MIN_PANE, maxWidth: `calc(100% - ${MIN_CHAT}px)` } : undefined}
              className={cn(
                "flex min-h-0 flex-col",
                // Below the app's own menus and dialogs (which sit at 50), above everything else.
                sheet || full ? "fixed inset-0 z-40 bg-background" : "relative shrink-0",
              )}
            >
              <BrowserPane
                browserId={browserId}
                mode={paneMode}
                phone={!wide}
                onMode={(next) => {
                  setPeek(false);
                  writeMode(next);
                }}
                onClose={close}
                onHandover={answerHandover}
                onShowChat={full ? () => setPeek(true) : !wide ? close : undefined}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {wide && mode === "split" ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the browser and the chat"
            aria-valuenow={Math.round(split * 100)}
            aria-valuemin={20}
            aria-valuemax={80}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onDoubleClick={() => setStoredSplit(String(DEFAULT_SPLIT))}
            onKeyDown={onDividerKey}
            className="group/divider relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[width,background-color] duration-150",
                "group-hover/divider:w-[3px] group-hover/divider:bg-brand/60 group-focus-visible/divider:w-[3px] group-focus-visible/divider:bg-brand",
                dragging !== null && "w-[3px] bg-brand",
              )}
            />
            <span
              className={cn(
                "absolute top-1/2 left-1/2 h-9 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border opacity-0 transition-opacity duration-150 group-hover/divider:opacity-100",
                dragging !== null && "bg-brand opacity-100",
              )}
            />
          </div>
        ) : null}

        {/* Full screen: a tap outside the chat slides it away again. */}
        {full && peek ? <div aria-hidden className="fixed inset-0 z-[43]" onClick={() => setPeek(false)} /> : null}

        {/* The chat. One element in every layout, so nothing in it restarts when the layout changes. */}
        <div
          inert={full && !peek}
          className={cn(
            // A named container: what is inside sizes itself to this column, not to the window,
            // because beside the browser the column is far narrower than the screen.
            "@container/chat flex min-w-0 flex-col",
            full
              ? cn(
                  "fixed inset-y-0 right-0 z-[44] w-[min(30rem,100vw)] border-l border-border bg-background shadow-float transition-transform duration-300 ease-out",
                  peek ? "translate-x-0" : "translate-x-full",
                )
              : "min-h-0 flex-1",
          )}
        >
          {children}
        </div>

        {full ? <FullScreenStrip state={state} peek={peek} onPeek={() => setPeek((v) => !v)} onSplit={() => writeMode("split")} /> : null}
      </div>
    </LayoutContext.Provider>
  );
}

function clampSplit(value: number): number {
  return Math.min(Math.max(value, 0.2), 0.8);
}

/** In full-screen mode: what the agent is doing, and the ways back to the chat. */
function FullScreenStrip({ state, peek, onPeek, onSplit }: { state: BrowserState; peek: boolean; onPeek: () => void; onSplit: () => void }) {
  const waiting = state.control === "user" || Boolean(state.approval);
  const text = state.approval
    ? "Waiting for your approval"
    : state.control === "user"
      ? state.handover
        ? "Your turn"
        : "You are in control"
      : state.activity || (state.busy ? "Working" : state.status === "ready" ? "Idle" : "No page open");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: 0.1 }}
      className={cn(
        "fixed bottom-12 left-1/2 z-[42] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 py-1 pr-1 pl-3.5 shadow-float backdrop-blur-xl transition-[margin] duration-300",
        // Step aside while the chat is slid in.
        peek && "lg:-ml-[15rem]",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", waiting ? "bg-brass" : state.busy ? "animate-pulse-dot bg-brand" : "bg-subtle")} />
      <span className={cn("max-w-[min(40vw,24rem)] min-w-0 truncate pr-2 text-[0.8rem] font-medium", state.busy && !waiting && "text-shimmer")} aria-live="polite">
        {text}
      </span>
      <span className="h-5 w-px bg-border" aria-hidden />
      <button type="button" onClick={onPeek} aria-pressed={peek} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {peek ? <PanelRightClose className="size-3.5" /> : <MessageSquare className="size-3.5" />}
        {peek ? "Hide chat" : "Chat"}
      </button>
      <button type="button" onClick={onSplit} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <Columns2 className="size-3.5" />
        Split view
      </button>
    </motion.div>
  );
}
