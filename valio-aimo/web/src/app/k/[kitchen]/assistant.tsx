"use client";

import { usePathname } from "next/navigation";
import { useText } from "../../_i18n/provider";
import { X } from "lucide-react";
import { AgentIcon, usePortal } from "./portal";
import { PORTAL_TEXT } from "./portal.text";
import { StartOver, ThreadComposer } from "./thread";
import { ThreadLine } from "./thread-line";
import { THREAD_LINE_TEXT } from "./thread-line.text";
import { THREAD_PAGE_TEXT } from "./thread.text";

/**
 * The kitchen's purchasing agent, on every page: the one conversation (docs/agent-thread.md) in the store's dock. A
 * phone's primary screen, a side sheet on a tablet, a column beside the shop on a desk. The Order page shows the
 * same thread full width, so there the dock stays closed.
 */
export function AssistantPanel() {
  const { agent, base, kitchen, thread } = usePortal();
  const tx = useText(THREAD_PAGE_TEXT);
  const ptx = useText(PORTAL_TEXT);
  const tl = useText(THREAD_LINE_TEXT);
  const pathname = usePathname() ?? base;
  // The agent's own page (the landing screen, and /order) shows the thread full width: no dock beside it.
  if (pathname === base || pathname === `${base}/order`) return null;
  const open = agent.panelOpen;
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={agent.open}
          aria-keyshortcuts="Control+K Meta+K"
          className="fixed bottom-6 right-6 z-30 hidden min-h-13 items-center gap-2.5 rounded-full bg-lavender-deep pl-4 pr-5 text-[0.95rem] font-semibold text-paper shadow-lg transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:inline-flex"
        >
          <AgentIcon size={20} />
          {tx.open}
        </button>
      )}
      {/* The Thread design, docked: the agent's line beside the store, its composer at the foot. */}
      <aside id="assistant" aria-label={tx.panel} className={`${open ? "flex" : "hidden"} thread-dock fixed inset-x-0 top-0 z-40 flex-col bg-mist sm:inset-x-auto sm:right-0 sm:z-50 sm:w-[min(32rem,92vw)] sm:shadow-lg xl:z-40 xl:w-[34rem] xl:border-l xl:border-line xl:shadow-none 2xl:w-[38rem]`}>
        <p className="on-dark bg-petrol-deep px-4 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] text-center text-[0.75rem] leading-snug text-paper/80 sm:hidden">{ptx.demoShort}</p>
        <header className="flex items-center gap-2.5 px-5 pb-2 pt-3.5 text-ink-soft">
          <span aria-hidden className="size-2.5 rounded-full bg-petrol" />
          {/* One line on a phone: the label is for screen readers there, the kitchen's name stays readable, and
              "Start over" is its icon (with its name). */}
          <h2 className="sr-only whitespace-nowrap text-[0.86rem] font-medium sm:not-sr-only">{tl.name}</h2>
          <span className="ml-auto min-w-0 truncate text-[0.82rem] font-medium text-ink sm:text-[0.76rem] sm:font-normal sm:text-ink-soft">{kitchen.name}</span>
          {(thread.thread?.turns.length ?? 0) > 1 && <StartOver compact />}
          <button type="button" onClick={() => agent.setPanelOpen(false)} aria-label={tl.close} className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-ink">
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
          <ThreadLine landing className="flex min-h-full flex-col justify-end" />
        </div>
        <footer className="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
          <ThreadComposer hint={false} placeholder={tl.placeholder} />
        </footer>
      </aside>
    </>
  );
}
