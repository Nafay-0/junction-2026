"use client";

import { usePathname } from "next/navigation";
import { useText } from "../../_i18n/provider";
import { ThreadDock } from "../../_ui/thread";
import { CallAgent } from "./call-agent";
import { AgentIcon, usePortal } from "./portal";
import { PORTAL_TEXT } from "./portal.text";
import { StartOver, ThreadComposer, ThreadLog } from "./thread";
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
  const pathname = usePathname() ?? base;
  if (pathname === `${base}/order`) return null;
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
      <ThreadDock
        open={open}
        onClose={() => agent.setPanelOpen(false)}
        name={kitchen.agentName}
        sub={tx.buysFor(kitchen.name)}
        label={tx.panel}
        banner={ptx.demoShort}
        aside={(thread.thread?.turns.length ?? 0) > 0 ? <StartOver /> : undefined}
        footer={
          <>
            <ThreadComposer />
            <div className="mt-2.5 border-t border-lavender-mid/70 pt-2.5">
              <CallAgent compact />
            </div>
          </>
        }
      >
        <ThreadLog />
      </ThreadDock>
    </>
  );
}
