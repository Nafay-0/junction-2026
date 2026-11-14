"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  Copy,
  Compass,
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
import { useStored } from "@/lib/use-client";
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
  const { state, connected } = useBrowser(browserId);
  const [confirmForget, setConfirmForget] = React.useState(false);
  /** The steps for letting the app work in the user's own Chrome. `reopen` carries the open page over. */
  const [setup, setSetup] = React.useState<{ reopen: boolean } | null>(null);
  const [storedKind, setStoredKind] = useStored("hovi.browser.kind", "assisted");
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

  /* Which browser: the user's own Chrome, or the app's hidden one. */
  const ownAvailable = state.own !== "unavailable";
  const switchToOwnChrome = (reopen: boolean) => {
    if (state.own !== "ready") {
      setSetup({ reopen });
      return;
    }
    setStoredKind("own");
    void run({ action: "kind", kind: "own", reopen });
  };
  const switchToBuiltIn = () => {
    setStoredKind("assisted");
    void run({ action: "kind", kind: "assisted" });
  };
  // The choice is remembered in this browser. After the server restarts it has forgotten: remind it, once.
  const reminded = React.useRef(false);
  React.useEffect(() => {
    if (reminded.current || !connected) return;
    reminded.current = true;
    if (storedKind === "own" && state.kind === "assisted" && state.own === "ready" && state.status !== "ready" && state.status !== "starting") {
      void run({ action: "kind", kind: "own" });
    }
  }, [connected, storedKind, state.kind, state.own, state.status, run]);

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

        {state.kind === "own" ? (
          <span className="hidden h-7 shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 text-[0.7rem] font-medium text-brand @[34rem]:flex" title="The agent is working in a window of your own Chrome">
            <AppWindow className="size-3" />
            Your Chrome
          </span>
        ) : null}
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
              {ownAvailable ? (
                state.kind === "own" ? (
                  <DropdownMenuItem onSelect={switchToBuiltIn} className="gap-2.5 px-2 py-1.5">
                    <Compass className="text-muted-foreground" />
                    <span className="flex-1">Use the built-in browser</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => switchToOwnChrome(live)} className="gap-2.5 px-2 py-1.5">
                    <AppWindow className="text-muted-foreground" />
                    <span className="flex-1">Use my own Chrome</span>
                    <span className="text-[0.7rem] text-subtle">signed in</span>
                  </DropdownMenuItem>
                )
              ) : null}
              <DropdownMenuItem disabled={noBrowser} onSelect={() => void run({ action: "close" })} className="gap-2.5 px-2 py-1.5">
                <Power className="text-muted-foreground" />
                <span className="flex-1">{state.kind === "own" ? "Close this window" : "Close browser"}</span>
                {state.kind === "own" ? null : <span className="text-[0.7rem] text-subtle">keeps sign-ins</span>}
              </DropdownMenuItem>
              {state.kind === "own" ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmForget(true)} className="gap-2.5 px-2 py-1.5">
                    <Trash2 />
                    Forget sign-ins
                  </DropdownMenuItem>
                </>
              )}
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
        {state.handover && userControl ? (
          <Banner key="handover" tone="brass">
            <HandoverBanner
              kind={state.handover.kind}
              reason={state.handover.reason}
              site={state.handover.site}
              onAnswer={onHandover}
              // Google refuses a sign-in typed into the app's browser. In the user's own Chrome they are already signed in.
              own={state.kind === "assisted" && ownAvailable && state.handover.kind !== "payment" ? (NOT_TYPED_HERE.test(domainOf(state.url)) ? "first" : "offer") : undefined}
              onOwn={() => switchToOwnChrome(true)}
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
            </p>
          </Banner>
        ) : null}
      </AnimatePresence>

      {/* The page */}
      <div className="relative flex min-h-0 flex-1 p-2 @[26rem]:p-3">
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

      <OwnChromeSetup
        open={setup !== null}
        onClose={() => setSetup(null)}
        check={async () => (await control(browserId, { action: "kind", kind: state.kind })).own}
        onReady={() => {
          const reopen = setup?.reopen ?? false;
          setSetup(null);
          setStoredKind("own");
          void run({ action: "kind", kind: "own", reopen });
        }}
      />

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

/** Sites that do not accept a sign-in typed into the app's browser. */
const NOT_TYPED_HERE = /(^|\.)accounts\.(google|youtube)\.com$/i;

function HandoverBanner({
  kind,
  reason,
  site,
  onAnswer,
  own,
  onOwn,
}: {
  kind: HandoverKind;
  reason: string;
  site?: string;
  onAnswer: (answer: HandoverAnswer) => void;
  /** Whether to offer the user's own Chrome for this step: "first" when signing in here will not work. */
  own?: "offer" | "first";
  onOwn: () => void;
}) {
  const copy = HANDOVER[kind] ?? HANDOVER.other;
  const help = own === "first" ? "This site does not accept sign-ins typed here. Carry on in your own Chrome instead, where you are already signed in: the page moves there." : copy.help;
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
        {own ? (
          <BannerButton primary={own === "first"} onClick={onOwn}>
            <AppWindow className="size-3.5" />
            Use my own Chrome
          </BannerButton>
        ) : null}
        <BannerButton primary={own !== "first"} onClick={() => onAnswer({ status: "done" })}>
          <Check className="size-3.5" strokeWidth={2.5} />
          {copy.done}
        </BannerButton>
      </div>
    </div>
  );
}

/* ───────────────────────── Working in the user's own Chrome ───────────────────────── */

const INSPECT_ADDRESS = "chrome://inspect/#remote-debugging";

/**
 * The one-time step for working in the user's own Chrome. Only the user can take it: Chrome's
 * settings are theirs, and a web page may not open a chrome:// address, so the address is copied.
 */
function OwnChromeSetup({ open, onClose, check, onReady }: { open: boolean; onClose: () => void; check: () => Promise<BrowserState["own"]>; onReady: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const [problem, setProblem] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const connect = async () => {
    setChecking(true);
    setProblem("");
    try {
      const own = await check();
      if (own === "ready") onReady();
      else setProblem(own === "setup" ? "Chrome has not turned it on yet. Tick the box in Chrome, then press Connect again." : "Your Chrome is not on the computer that runs this app, so it cannot be used here.");
    } catch {
      setProblem("The app did not answer. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use your own Chrome</DialogTitle>
          <DialogDescription>
            {APP_NAME} can work in a window of the Chrome you already use, where you are signed in to your accounts. There is then nothing to sign in to. It takes one setting in Chrome, once.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-[0.88rem] leading-relaxed">
          <li className="flex gap-3">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              In Chrome, open this address:
              <div className="mt-1.5 flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.8rem]">{INSPECT_ADDRESS}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(INSPECT_ADDRESS).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    });
                  }}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[0.78rem] font-medium transition-colors hover:bg-muted"
                >
                  {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5 text-muted-foreground" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <StepNumber n={2} />
            <span>Turn on &ldquo;Allow remote debugging for this browser instance&rdquo;.</span>
          </li>
          <li className="flex gap-3">
            <StepNumber n={3} />
            <span>Come back and press Connect. Chrome asks whether to allow it: press Allow.</span>
          </li>
        </ol>
        <p className="rounded-xl border border-border bg-surface/70 px-3 py-2.5 text-[0.78rem] leading-relaxed text-muted-foreground">
          {APP_NAME} opens a window of its own in your Chrome and works only there; your other tabs are left alone. Chrome shows that it is being controlled. The same rules hold as before: it never pays, never types passwords, and asks before
          anything that commits you. Turn the setting off in the same place whenever you like.
        </p>
        {problem ? <p className="text-[0.82rem] text-destructive">{problem}</p> : null}
        <DialogFooter>
          <button type="button" onClick={onClose} className="h-9 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted">
            Not now
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={checking}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <AppWindow className="size-4" />
            {checking ? "Checking" : "Connect"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepNumber({ n }: { n: number }) {
  return <span className="nums mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.72rem] font-semibold text-brand">{n}</span>;
}
