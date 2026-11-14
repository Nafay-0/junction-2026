"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  Columns2,
  CreditCard,
  Globe,
  Hand,
  KeyRound,
  Layers,
  Lock,
  LogIn,
  Maximize2,
  MoreHorizontal,
  Power,
  RotateCw,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { control, useBrowser } from "@/lib/browser/client";
import type { BrowserState, ControlRequest, HandoverAnswer, HandoverKind } from "@/lib/browser/protocol";
import { domainOf, faviconOf } from "@/lib/widgets/types";
import { IconAction } from "@/components/butler/icon-action";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrowserView } from "./browser-view";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The live browser with its controls: where the page is, who is driving, what the agent is doing,
 * and the moments that need the user (signing in, a check, payment, an approval).
 */
export function BrowserPane({
  browserId,
  mode,
  phone,
  onMode,
  onClose,
  onHandover,
  onShowChat,
}: {
  browserId: string;
  /** How the pane is laid out right now. */
  mode: "split" | "full";
  /** On a phone the pane is a full-screen sheet: no layout buttons, a way back to the chat instead. */
  phone?: boolean;
  onMode: (mode: "split" | "full") => void;
  onClose: () => void;
  /** The user has finished, or skipped, what the agent asked them to do in the page. */
  onHandover: (answer: HandoverAnswer) => void;
  /** Bring the chat into view, when the pane covers it. */
  onShowChat?: () => void;
}) {
  const { state } = useBrowser(browserId);
  const [confirmForget, setConfirmForget] = React.useState(false);
  const [draft, setDraft] = React.useState<string | null>(null);

  // A narrow pane has no room for back, forward and reload in the toolbar: they move into the menu.
  // (The menu is drawn outside the pane, so it cannot ask the pane's width in CSS.)
  const section = React.useRef<HTMLElement>(null);
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const el = section.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 416));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const run = React.useCallback(
    (request: ControlRequest) => control(browserId, request).catch((err: unknown) => void toast.error(err instanceof Error ? err.message : "The browser did not respond.")),
    [browserId],
  );

  const live = state.status === "ready";
  const userControl = state.control === "user";
  const canDrive = live && userControl;
  const noBrowser = state.status === "idle" || state.status === "closed";

  return (
    <section ref={section} aria-label="Live browser" className="@container flex h-full min-h-0 w-full flex-col bg-surface">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background/85 px-2 backdrop-blur-xl">
        {phone ? (
          <button type="button" onClick={onClose} className="mr-0.5 flex h-9 shrink-0 items-center gap-0.5 rounded-full pr-2.5 pl-1.5 text-[0.82rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-[1.1rem]" />
            Chat
          </button>
        ) : null}
        <div className={cn("items-center", narrow ? "hidden" : "flex")}>
          <IconAction label="Back" disabled={!canDrive || !state.canGoBack} onClick={() => void run({ action: "back" })}>
            <ArrowLeft />
          </IconAction>
          <IconAction label="Forward" disabled={!canDrive || !state.canGoForward} onClick={() => void run({ action: "forward" })}>
            <ArrowRight />
          </IconAction>
          <IconAction label="Reload" disabled={!canDrive} onClick={() => void run({ action: "reload" })}>
            <RotateCw />
          </IconAction>
        </div>

        <Address
          state={state}
          editable={userControl}
          draft={draft}
          onDraft={setDraft}
          onNavigate={(url) => {
            setDraft(null);
            void run({ action: "navigate", url });
          }}
        />

        <StatusChip state={state} />

        {userControl && !state.handover ? (
          <button
            type="button"
            onClick={() => void run({ action: "release" })}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
            Hand back
          </button>
        ) : !userControl && live ? (
          <button
            type="button"
            onClick={() => void run({ action: "take" })}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[0.8rem] font-medium transition-colors hover:border-ring/50 hover:bg-muted"
          >
            <Hand className="size-3.5 text-muted-foreground" />
            <span className="hidden @[22rem]:inline">Take over</span>
          </button>
        ) : null}

        <div className="flex shrink-0 items-center">
          {phone ? null : mode === "split" ? (
            <IconAction label="Full screen" onClick={() => onMode("full")}>
              <Maximize2 />
            </IconAction>
          ) : (
            <IconAction label="Split view" onClick={() => onMode("split")}>
              <Columns2 />
            </IconAction>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconAction label="More">
                <MoreHorizontal />
              </IconAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {narrow ? (
                <div className="flex items-center gap-0.5 px-1 pb-1">
                  <MenuNav label="Back" disabled={!canDrive || !state.canGoBack} onClick={() => void run({ action: "back" })} icon={<ArrowLeft />} />
                  <MenuNav label="Forward" disabled={!canDrive || !state.canGoForward} onClick={() => void run({ action: "forward" })} icon={<ArrowRight />} />
                  <MenuNav label="Reload" disabled={!canDrive} onClick={() => void run({ action: "reload" })} icon={<RotateCw />} />
                </div>
              ) : null}
              <DropdownMenuItem disabled={noBrowser} onSelect={() => void run({ action: "close" })} className="gap-2.5 px-2 py-1.5">
                <Power className="text-muted-foreground" />
                <span className="flex-1">Close browser</span>
                <span className="text-[0.7rem] text-subtle">keeps sign-ins</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmForget(true)} className="gap-2.5 px-2 py-1.5">
                <Trash2 />
                Forget sign-ins
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {phone ? null : (
            <IconAction label="Hide the browser" onClick={onClose}>
              <X />
            </IconAction>
          )}
        </div>
      </div>

      {/* The moments that need the user */}
      <AnimatePresence initial={false}>
        {state.outside ? (
          <Banner key="outside" tone="brass">
            <BannerRow
              icon={<AppWindow />}
              title="Carry on in the Chrome window that opened"
              text={`It is an ordinary Chrome on this computer with nothing attached, so ${state.outside.site} accepts your sign-in, and what you type there never passes through ${APP_NAME}. Come back here when you are done.`}
              actions={
                <BannerButton primary onClick={() => void run({ action: "window-done" })}>
                  <Check className="size-3.5" strokeWidth={2.5} />I am done there
                </BannerButton>
              }
            />
          </Banner>
        ) : state.handover && userControl ? (
          <Banner key="handover" tone="brass">
            <HandoverBanner
              kind={state.handover.kind}
              reason={state.handover.reason}
              site={state.handover.site}
              onAnswer={onHandover}
              // Google refuses a sign-in typed into an assisted browser: the ordinary window is the way.
              window={state.canOpenWindow && state.handover.kind !== "payment" ? (ONLY_ORDINARY.test(domainOf(state.url)) ? "first" : "offer") : undefined}
              onWindow={() => void run({ action: "window" })}
            />
          </Banner>
        ) : state.paymentPage ? (
          <Banner key="payment" tone="brass">
            <BannerRow
              icon={<CreditCard />}
              title="This is a payment page"
              text={`${APP_NAME} never pays. You can pay here yourself: nothing you type is read by the agent or stored.`}
              actions={
                !userControl && live ? (
                  <BannerButton primary onClick={() => void run({ action: "take" })}>
                    Take over
                  </BannerButton>
                ) : null
              }
            />
          </Banner>
        ) : state.approval ? (
          <Banner key="approval" tone="brass">
            <BannerRow
              icon={<ShieldCheck />}
              title="Waiting for your approval in the chat"
              text={state.approval.label}
              actions={onShowChat ? <BannerButton onClick={onShowChat}>Show the chat</BannerButton> : null}
            />
          </Banner>
        ) : userControl && live ? (
          <Banner key="control" tone="quiet">
            <p className="flex items-center gap-2 text-[0.8rem] text-muted-foreground">
              <Hand className="size-3.5 shrink-0 text-brass" />
              <span>
                <span className="font-medium text-foreground">You are in control.</span> {APP_NAME} is paused until you hand the page back.
              </span>
              {state.canOpenWindow ? (
                <button
                  type="button"
                  onClick={() => void run({ action: "window" })}
                  title="For a sign-in the site will not accept here: an ordinary Chrome window opens on this computer"
                  className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[0.75rem] font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <AppWindow className="size-3.5 text-muted-foreground" />
                  Normal Chrome window
                </button>
              ) : null}
            </p>
          </Banner>
        ) : null}
      </AnimatePresence>

      {/* The page */}
      <div className="relative flex min-h-0 flex-1 p-2 @[26rem]:p-3">
        {state.outside ? (
          <div className="absolute inset-0 z-50 flex animate-fade flex-col items-center justify-center gap-3 bg-surface/90 px-6 text-center backdrop-blur-sm">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-card text-brass shadow-card hairline">
              <AppWindow className="size-5" />
            </span>
            <p className="max-w-[22rem] text-[0.9rem] leading-relaxed font-medium">The page is open in a Chrome window on this computer.</p>
            <p className="max-w-[24rem] text-[0.8rem] leading-relaxed text-muted-foreground">Do the step there, then come back and say you are done. Your sign-in is kept, and {APP_NAME} carries on from where it was.</p>
          </div>
        ) : null}
        <BrowserView
          browserId={browserId}
          empty={
            noBrowser ? (
              <button
                type="button"
                onClick={() => {
                  void run({ action: "take" });
                  setDraft("");
                }}
                className="mt-1 flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-[0.82rem] font-medium transition-colors hover:border-ring/50 hover:bg-muted"
              >
                <Globe className="size-4 text-muted-foreground" />
                Open a page yourself
              </button>
            ) : null
          }
        />
      </div>

      {/* Footer: the current step, and the tabs when there are several */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border bg-background/70 px-3 text-[0.75rem] text-muted-foreground">
        <span className={cn("size-1.5 shrink-0 rounded-full", state.busy ? "animate-pulse-dot bg-brand" : live && (userControl || state.approval) ? "bg-brass" : live ? "bg-up" : "bg-subtle")} />
        <span className={cn("min-w-0 flex-1 truncate", state.busy && "text-shimmer")} aria-live="polite">
          {footerText(state)}
        </span>
        {state.tabs.length > 1 ? <Tabs state={state} onPick={(tabId) => void run({ action: "tab", tabId })} /> : null}
      </div>

      <Dialog open={confirmForget} onOpenChange={setConfirmForget}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forget every sign-in?</DialogTitle>
            <DialogDescription>
              This closes the browser and wipes every sign-in, cookie and saved form entry it holds. You will need to sign in again on each site. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setConfirmForget(false)} className="h-9 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted">
              Keep them
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmForget(false);
                void run({ action: "forget" }).then((next) => {
                  if (next) toast.success("Sign-ins forgotten", { description: "The browser starts clean next time." });
                });
              }}
              className="h-9 rounded-full bg-destructive px-4 text-[0.85rem] font-medium text-white transition-opacity hover:opacity-90"
            >
              Forget sign-ins
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function footerText(state: BrowserState): string {
  if (state.activity) return state.activity;
  if (state.status === "starting") return "Starting the browser";
  if (state.status === "error") return "The browser could not start";
  if (state.status !== "ready") return "No page open";
  if (state.control === "user") return state.handover ? "Waiting for you" : "You are in control";
  if (state.approval) return "Waiting for your approval";
  if (state.busy) return "Working";
  return state.title || domainOf(state.url) || "Ready";
}

/* ───────────────────────── Toolbar parts ───────────────────────── */

function MenuNav({ label, icon, disabled, onClick }: { label: string; icon: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 flex-1 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
    >
      {icon}
    </button>
  );
}

/** Turn what the user typed into an address: a full link, a bare site name, or a search. */
function toUrl(input: string): string {
  const text = input.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

function Address({
  state,
  editable,
  draft,
  onDraft,
  onNavigate,
}: {
  state: BrowserState;
  /** The user is in control, so they may type an address. */
  editable: boolean;
  /** What is being typed, or null when the address is only being shown. */
  draft: string | null;
  onDraft: (value: string | null) => void;
  onNavigate: (url: string) => void;
}) {
  const [brokenIcon, setBrokenIcon] = React.useState<string | null>(null);
  const editing = editable && draft !== null;
  const host = state.url ? domainOf(state.url) : "";
  const rest = React.useMemo(() => {
    try {
      const url = new URL(state.url);
      const tail = `${url.pathname}${url.search}`;
      return tail === "/" ? "" : tail;
    } catch {
      return "";
    }
  }, [state.url]);
  const secure = state.url.startsWith("https://");
  const shell = "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted/70 px-3 text-[0.8rem] hairline";

  if (editing) {
    return (
      <form
        className={cn(shell, "bg-card ring-3 ring-ring/20")}
        onSubmit={(e) => {
          e.preventDefault();
          const url = toUrl(draft);
          if (url) onNavigate(url);
        }}
      >
        <Globe className="size-3.5 shrink-0 text-subtle" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => onDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDraft(null);
          }}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type an address or a search"
          aria-label="Address"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle sm:text-[0.8rem]"
        />
      </form>
    );
  }

  const content = (
    <>
      {host && brokenIcon !== host ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconOf(state.url)} alt="" className="size-3.5 shrink-0 rounded-sm" onError={() => setBrokenIcon(host)} />
      ) : (
        <Globe className="size-3.5 shrink-0 text-subtle" />
      )}
      {host ? (
        <span className="flex min-w-0 items-baseline">
          <span className="shrink-0 font-medium text-foreground">{host}</span>
          <span className="truncate text-subtle">{rest}</span>
        </span>
      ) : (
        <span className="truncate text-subtle">{editable ? "Type an address" : "No page open"}</span>
      )}
      {host && secure ? <Lock className="ml-auto size-3 shrink-0 text-subtle" aria-label="Secure connection" /> : null}
    </>
  );

  return editable ? (
    <button type="button" onClick={() => onDraft(state.url)} title="Type an address" className={cn(shell, "cursor-text text-left transition-colors hover:bg-muted")}>
      {content}
    </button>
  ) : (
    <div className={shell} title={state.url || undefined}>
      {content}
    </div>
  );
}

function StatusChip({ state }: { state: BrowserState }) {
  const live = state.status === "ready";
  const chip =
    state.status === "error"
      ? { label: "Problem", dot: "bg-destructive", text: "text-destructive", pulse: false }
      : state.status === "starting"
        ? { label: "Starting", dot: "bg-brand", text: "text-muted-foreground", pulse: true }
        : !live
          ? null
          : state.control === "user"
            ? { label: "Your turn", dot: "bg-brass", text: "text-foreground", pulse: false }
            : state.approval
              ? { label: "Needs approval", dot: "bg-brass", text: "text-foreground", pulse: true }
              : state.busy
                ? { label: "Working", dot: "bg-brand", text: "text-foreground", pulse: true }
                : { label: "Idle", dot: "bg-subtle", text: "text-muted-foreground", pulse: false };
  if (!chip) return null;
  return (
    <span className={cn("hidden h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[0.72rem] font-medium @[34rem]:flex", chip.text)} role="status">
      <span className={cn("size-1.5 rounded-full", chip.dot, chip.pulse && "animate-pulse-dot")} />
      {chip.label}
    </span>
  );
}

function Tabs({ state, onPick }: { state: BrowserState; onPick: (tabId: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="nums flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground" aria-label={`${state.tabs.length} tabs`}>
        <Layers className="size-3" />
        {state.tabs.length} tabs
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 gap-0.5 p-1">
        {state.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setOpen(false);
              if (!tab.active) onPick(tab.id);
            }}
            className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted", tab.active && "bg-accent")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={faviconOf(tab.url)} alt="" className="size-4 shrink-0 rounded-sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8rem] font-medium">{tab.title || domainOf(tab.url)}</span>
              <span className="block truncate text-[0.7rem] text-subtle">{domainOf(tab.url)}</span>
            </span>
            {tab.active ? <Check className="size-3.5 shrink-0 text-brand" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── Banners ───────────────────────── */

function Banner({ tone, children }: { tone: "brass" | "quiet"; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="shrink-0 overflow-hidden"
    >
      <div
        className={cn("border-b border-border px-3 py-2.5 @[26rem]:px-4", tone === "quiet" && "bg-background/60")}
        style={tone === "brass" ? { background: "color-mix(in oklch, var(--brass) 11%, var(--background))" } : undefined}
      >
        {children}
      </div>
    </motion.div>
  );
}

function BannerRow({ icon, title, text, actions }: { icon: React.ReactNode; title: string; text?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-card text-brass hairline [&_svg]:size-4">{icon}</span>
      <div className="min-w-[12rem] flex-1">
        <p className="text-[0.85rem] leading-5 font-medium">{title}</p>
        {text ? <p className="text-[0.78rem] leading-snug text-muted-foreground">{text}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

function BannerButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8rem] font-medium transition-[opacity,transform,background-color] active:scale-[0.98]",
        primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

const HANDOVER: Record<HandoverKind, { icon: React.ReactNode; title: string; help: string; done: string }> = {
  login: {
    icon: <LogIn />,
    title: "Your turn: sign in",
    help: "Type straight into the page. Your password goes to the site only: the agent never sees it.",
    done: "Done, continue",
  },
  captcha: {
    icon: <ShieldQuestion />,
    title: "Your turn: a quick check",
    help: "The site wants to make sure a person is here. Complete the check in the page.",
    done: "Done, continue",
  },
  verification: {
    icon: <KeyRound />,
    title: "Your turn: confirm it is you",
    help: "The site sent a code or asks for a second step. Complete it in the page.",
    done: "Done, continue",
  },
  payment: {
    icon: <CreditCard />,
    title: "Your turn: payment",
    help: `${APP_NAME} never pays. Pay here yourself if you want to go ahead: nothing you type is read by the agent or stored.`,
    done: "Done, continue",
  },
  other: {
    icon: <Hand />,
    title: "Your turn",
    help: "Do this step in the page, then hand it back.",
    done: "Done, continue",
  },
};

/** Sites that only accept a sign-in from an ordinary browser. */
const ONLY_ORDINARY = /(^|\.)accounts\.(google|youtube)\.com$/i;

function HandoverBanner({
  kind,
  reason,
  site,
  onAnswer,
  window: ordinary,
  onWindow,
}: {
  kind: HandoverKind;
  reason: string;
  site?: string;
  onAnswer: (answer: HandoverAnswer) => void;
  /** Whether to offer an ordinary Chrome window for this step: "first" when it is the only way that works. */
  window?: "offer" | "first";
  onWindow: () => void;
}) {
  const copy = HANDOVER[kind] ?? HANDOVER.other;
  const help = ordinary === "first" ? "This site only accepts sign-ins from an ordinary browser. Open one here, sign in, and come back: your sign-in is kept." : copy.help;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-brass hairline [&_svg]:size-[1.1rem]">{copy.icon}</span>
      <div className="min-w-[13rem] flex-1">
        <p className="text-[0.9rem] leading-5 font-medium">
          {copy.title}
          {site ? <span className="font-normal text-muted-foreground"> on {site}</span> : null}
        </p>
        {reason ? <p className="mt-0.5 text-[0.82rem] leading-snug text-foreground">{reason}</p> : null}
        <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground">{help}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <BannerButton onClick={() => onAnswer({ status: "skipped" })}>Skip</BannerButton>
        {ordinary ? (
          <BannerButton primary={ordinary === "first"} onClick={onWindow}>
            <AppWindow className="size-3.5" />
            Use a normal Chrome window
          </BannerButton>
        ) : null}
        <BannerButton primary={ordinary !== "first"} onClick={() => onAnswer({ status: "done" })}>
          <Check className="size-3.5" strokeWidth={2.5} />
          {copy.done}
        </BannerButton>
      </div>
    </div>
  );
}
