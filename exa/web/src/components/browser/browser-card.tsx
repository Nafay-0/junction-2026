"use client";

import * as React from "react";
import { ArrowUpRight, Globe, Hand, Maximize2, MonitorPlay, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrowser } from "@/lib/browser/client";
import type { BrowserState } from "@/lib/browser/protocol";
import { useMediaQuery } from "@/lib/use-client";
import { domainOf, faviconOf } from "@/lib/widgets/types";
import { LiveDot } from "@/components/widgets/frame";
import { BrowserThumbnail } from "./browser-view";
import { useBrowserLayout } from "./workspace";

/**
 * The live browser as a card in the conversation: a small live picture of the page, where it is,
 * what the agent is doing, and the way into the full view. On a phone this is how the user gets
 * to the browser. While the full view is open the card says so rather than showing the page twice.
 */
export function BrowserCard({ browserId, className }: { browserId: string; className?: string }) {
  const { state } = useBrowser(browserId);
  const layout = useBrowserLayout();
  const wide = useMediaQuery("(min-width: 768px)");
  const [brokenIcon, setBrokenIcon] = React.useState<string | null>(null);

  const live = state.status === "ready";
  const open = layout.mode !== "closed";
  const host = state.url ? domainOf(state.url) : "";
  const needsUser = live && (state.control === "user" || Boolean(state.approval));
  const line = statusLine(state);

  return (
    <section
      className={cn(
        "flex w-full animate-rise items-stretch gap-3 overflow-hidden rounded-2xl border bg-card p-2.5 shadow-card transition-colors sm:gap-4 sm:p-3",
        needsUser ? "border-brass/50" : "border-border",
        className,
      )}
      aria-label="Live browser"
    >
      {/* The picture: live while the full view is closed. With it open, a small mark is enough. */}
      {open ? (
        <span className="flex size-10 shrink-0 items-center justify-center self-start rounded-xl bg-brand-soft text-brand">
          <MonitorPlay className="size-[1.15rem]" />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => layout.open("split")}
          aria-label="Open the live browser"
          className="group/thumb relative w-[7.5rem] shrink-0 self-start overflow-hidden rounded-xl bg-surface hairline transition-shadow hover:shadow-card sm:w-[11rem]"
        >
          {live ? (
            <>
              <BrowserThumbnail browserId={browserId} className="w-full" />
              <span className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-[opacity,background-color] duration-200 group-hover/thumb:bg-foreground/25 group-hover/thumb:opacity-100">
                <span className="flex size-8 items-center justify-center rounded-full bg-card text-foreground shadow-float">
                  <Maximize2 className="size-3.5" />
                </span>
              </span>
            </>
          ) : (
            <span className="flex aspect-[16/10] w-full items-center justify-center text-subtle">
              <MonitorPlay className="size-6" strokeWidth={1.5} />
            </span>
          )}
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {host && brokenIcon !== host ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={faviconOf(state.url)} alt="" className="size-4 shrink-0 rounded-sm" onError={() => setBrokenIcon(host)} />
            ) : (
              <Globe className="size-4 shrink-0 text-subtle" />
            )}
            <span className="min-w-0 truncate text-[0.9rem] leading-5 font-medium">{host || "Live browser"}</span>
            {live && state.control === "agent" && !state.approval ? <LiveDot className="ml-auto shrink-0" /> : null}
          </div>
          <p className={cn("mt-1 flex items-center gap-1.5 text-[0.8rem] leading-snug", needsUser ? "text-foreground" : "text-muted-foreground")} aria-live="polite">
            {state.approval ? <ShieldCheck className="size-3.5 shrink-0 text-brass" /> : state.control === "user" && live ? <Hand className="size-3.5 shrink-0 text-brass" /> : null}
            <span className={cn("line-clamp-2", state.busy && !needsUser && "text-shimmer")}>{line}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {open ? (
            <span className="text-[0.75rem] text-subtle">{layout.mode === "split" && wide ? "Showing in the live view beside the chat" : "Showing in the live view"}</span>
          ) : (
            <button
              type="button"
              onClick={() => layout.open("split")}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8rem] font-medium transition-[opacity,transform,background-color] active:scale-[0.98]",
                needsUser ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:border-ring/50 hover:bg-muted",
              )}
            >
              {needsUser ? "Open the page" : "Watch live"}
              <ArrowUpRight className="size-3.5" />
            </button>
          )}
          {!open && wide ? (
            <button
              type="button"
              onClick={() => layout.open("full")}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="size-3.5" />
              Full screen
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function statusLine(state: BrowserState): string {
  if (state.status === "idle") return "The agent opens a browser when a task needs one.";
  if (state.status === "starting") return "Starting the browser";
  if (state.status === "closed") return "The browser is closed. Your sign-ins are kept.";
  if (state.status === "error") return state.error || "The browser could not start.";
  if (state.handover) return `Your turn: ${state.handover.reason}`;
  if (state.control === "user") return "You are in control. The agent is paused.";
  if (state.approval) return `Waiting for your approval: ${state.approval.label}`;
  if (state.paymentPage) return "Payment page. The agent stops here.";
  if (state.activity) return state.activity;
  if (state.busy) return "Working";
  return state.title || "Ready";
}
