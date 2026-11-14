"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Globe, Moon, PanelLeft, Plus, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";
import { useHydrated } from "@/lib/use-client";
import { useBrowser } from "@/lib/browser/client";
import { useBrowserLayout } from "@/components/browser/workspace";
import { NO_USAGE, addSummaries, exaCallCount, hasFigures, summarise, totalSpend, type RunStats, type UsageSummary } from "@/lib/agent/stats";
import { useUser } from "@/lib/auth/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "@/components/account/account-menu";
import { NotificationBell } from "@/components/notifications/bell";
import { UsageBreakdown, fmtUsd } from "./usage";

/** What every finished answer in the conversation used, added up. Null when there are no figures to show. */
export function sumUsage(all: Array<RunStats | undefined>): UsageSummary | null {
  const done = all.filter((s): s is RunStats => !!s && s.durationMs !== undefined && hasFigures(s));
  if (done.length === 0) return null;
  return done.reduce<UsageSummary>((sum, stats) => addSummaries(sum, summarise(stats)), NO_USAGE);
}

/**
 * The bar above a conversation: the list button, the logo, the conversation's name, what it has
 * used (for an account that may see that), and the few things always within reach.
 *
 * It is sized to the chat column, not to the window: beside the live browser the column can be
 * 380 pixels wide on a large screen, and on a phone it is the whole screen. Nothing wraps and
 * nothing overlaps. The name takes whatever room is left and is cut with an ellipsis. As the
 * column narrows, things step out in this order: the Exa count, the token count, the "New chat"
 * label, the product's name beside the logo (the conversation's name matters more), and under
 * 420 pixels the "New chat" button itself (the logo starts a new chat too). The logo, the
 * cost, the bell, the theme switch, the account badge and the list button always stay.
 */
export function TopBar({
  usage,
  title,
  onNewChat,
  onOpenChat,
  showNew,
  sidebarOpen,
  onToggleSidebar,
}: {
  /** Open another chat: what a notification about one does. */
  onOpenChat: (conversationId: string) => void;
  /** What the conversation has used so far, or null when there is nothing to show. */
  usage: UsageSummary | null;
  /** The open conversation's name, once it has one. */
  title?: string;
  onNewChat: () => void;
  showNew: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const { showUsage } = useUser();
  const name = title?.trim();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-transparent bg-background/80 px-3 whitespace-nowrap backdrop-blur-xl @min-[480px]/chat:px-4">
      {/* When the list is open it carries its own close button; on phones it is a drawer, so the toggle stays. */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Close the conversation list" : "Open the conversation list"}
        aria-expanded={sidebarOpen}
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", sidebarOpen && "md:hidden")}
      >
        <PanelLeft className="size-[1.1rem]" />
      </button>
      <button type="button" onClick={onNewChat} className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-1 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}: start over`}>
        <Logo size={32} className="rounded-[0.6rem] shadow-card" />
        {/* With a conversation open, its name has the room first; the product's name returns where there is space for both. */}
        <span className={cn("font-display text-[1.3rem] leading-none", name ? "hidden @min-[700px]/chat:inline" : "hidden @min-[300px]/chat:inline")}>{APP_NAME}</span>
      </button>

      {name ? (
        <>
          <span aria-hidden className="hidden shrink-0 pl-0.5 text-[1.05rem] text-border @min-[700px]/chat:inline">
            /
          </span>
          <h1 className="min-w-0 flex-1 truncate pl-1 text-[0.92rem] leading-6 font-medium tracking-tight text-foreground" title={name}>
            {name}
          </h1>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex shrink-0 items-center gap-1">
        {usage && showUsage ? <UsageMeter usage={usage} /> : null}
        <BrowserButton />
        <NotificationBell onOpenChat={onOpenChat} />
        {showNew ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNewChat}
                aria-label="New chat"
                // On the narrowest screens it steps out: the logo starts a new chat too, and the list has the button.
                className="hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @min-[420px]/chat:flex"
              >
                <Plus className="size-4" />
                <span className="hidden @min-[560px]/chat:inline">New chat</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Start a new chat</TooltipContent>
          </Tooltip>
        ) : null}
        <ThemeToggle />
        {/* The same account menu as at the foot of the list, within reach when the list is closed. */}
        <AccountMenu variant="badge" />
      </div>
    </header>
  );
}

/** A browser is running but its pane is put away: one press brings it back. */
function BrowserButton() {
  const { state } = useBrowser();
  const layout = useBrowserLayout();
  const running = state.status === "starting" || state.status === "ready";
  if (!running || layout.mode !== "closed") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => layout.open("split")}
          aria-label="Show the browser"
          className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Globe className="size-[1.05rem]" />
          <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand ring-2 ring-background" />
        </button>
      </TooltipTrigger>
      <TooltipContent>The browser is still open. Show it</TooltipContent>
    </Tooltip>
  );
}

/** What the conversation has cost so far; the breakdown by kind is one press away. Only for accounts that may see usage. */
function UsageMeter({ usage }: { usage: UsageSummary }) {
  const tokens = usage.llmTokens.in + usage.llmTokens.out + usage.voiceTokens.in + usage.voiceTokens.out;
  const calls = exaCallCount(usage.exaCalls);
  return (
    <Popover>
      <PopoverTrigger
        className="nums flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-[0.75rem] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
        aria-label="Usage for this conversation"
      >
        <span className="font-medium text-foreground">{fmtUsd(totalSpend(usage.spend))}</span>
        <span className="hidden text-border @min-[660px]/chat:inline">|</span>
        <span className="hidden @min-[660px]/chat:inline">{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens</span>
        <span className="hidden text-border @min-[740px]/chat:inline">|</span>
        <span className="hidden @min-[740px]/chat:inline">{calls} Exa</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 text-[0.8rem]">
        <UsageBreakdown usage={usage} title="This conversation" />
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = useHydrated() && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {dark ? <Sun className="size-[1.05rem]" /> : <Moon className="size-[1.05rem]" />}
    </button>
  );
}
