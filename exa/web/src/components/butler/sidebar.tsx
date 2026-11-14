"use client";

import * as React from "react";
import { Globe, MessageSquareDashed, Monitor, MoreHorizontal, PanelLeftClose, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientKind } from "@/lib/client-kind";
import type { ConversationMeta } from "@/lib/conversations";
import { readOnlyHint } from "@/lib/db/origin";
import { useClientValue } from "@/lib/use-client";
import { AccountMenu } from "@/components/account/account-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DAY = 86_400_000;

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

function groupOf(updatedAt: number, startOfToday: number): string {
  if (updatedAt >= startOfToday) return "Today";
  if (updatedAt >= startOfToday - DAY) return "Yesterday";
  if (updatedAt >= startOfToday - 7 * DAY) return "Previous 7 days";
  return "Earlier";
}

/**
 * The list of saved conversations, with the account at the bottom. On wide screens it is a column
 * that slides shut; on narrow screens it is a drawer over the chat. Conversations are saved to the
 * account, so the same list is there on every device. One started in the other kind of client
 * (the desktop app, seen from the web, or the other way round) carries a small mark: it can be
 * read here, but not continued.
 */
export function Sidebar({
  open,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  running,
  waiting,
}: {
  /** Conversations with a task running in them right now, here or left running in the background. */
  running?: string[];
  /** Conversations whose task cannot go on until the user does something: approve a step, finish on a page. */
  waiting?: string[];
  open: boolean;
  onClose: () => void;
  conversations: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);

  // Midnight today, read in the browser (the server does not know the user's day).
  const today = useClientValue(startOfToday, 0);
  // The web or the desktop app: only the browser knows.
  const here = useClientValue(clientKind, "web");
  const groups = React.useMemo(() => {
    const out: Array<{ label: string; items: ConversationMeta[] }> = [];
    for (const c of conversations) {
      const label = groupOf(c.updatedAt, today);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [conversations, today]);

  // Close the drawer with Escape on narrow screens.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.matchMedia("(max-width: 767px)").matches) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop for the drawer on narrow screens */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn("fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[2px] transition-opacity duration-200 md:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        aria-label="Conversations"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          // Above the page as a drawer on phones; an ordinary column on wide screens, so the full-screen browser can cover it.
          "z-50 flex h-dvh shrink-0 flex-col overflow-hidden border-sidebar-border bg-sidebar text-sidebar-foreground md:z-auto",
          // Drawer below md, column from md up.
          "fixed inset-y-0 left-0 w-[86vw] max-w-[19rem] border-r shadow-float transition-transform duration-250 ease-out md:static md:max-w-none md:shadow-none md:transition-[width,border-color] md:duration-250",
          open ? "translate-x-0 md:w-[17.5rem]" : "-translate-x-full md:w-0 md:translate-x-0 md:border-r-transparent",
        )}
      >
        <div className="flex w-[86vw] max-w-[19rem] flex-1 flex-col overflow-hidden md:w-[17.5rem]">
          <div className="flex h-14 shrink-0 items-center gap-2 px-3">
            <button
              type="button"
              onClick={onNew}
              className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-sidebar-border bg-card px-3 text-[0.85rem] font-medium shadow-card transition-colors hover:border-ring/50"
            >
              <Plus className="size-4 text-brand" />
              New chat
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the conversation list"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <PanelLeftClose className="size-[1.1rem]" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 pt-16 text-center">
                <MessageSquareDashed className="size-6 text-subtle" />
                <p className="text-[0.85rem] font-medium">No chats yet</p>
                <p className="text-[0.78rem] leading-snug text-muted-foreground">Everything you ask is saved to your account, so you can come back to it on any device.</p>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.label} className="mt-3 first:mt-1">
                  <h2 className="px-2.5 pb-1 text-[0.68rem] font-medium tracking-wider text-subtle uppercase">{group.label}</h2>
                  <ul className="space-y-0.5">
                    {group.items.map((c) => (
                      <li key={c.id}>
                        <Row
                          conversation={c}
                          elsewhere={c.origin !== here}
                          running={running?.includes(c.id) ?? false}
                          waiting={waiting?.includes(c.id) ?? false}
                          active={c.id === activeId}
                          editing={editing === c.id}
                          onSelect={() => onSelect(c.id)}
                          onStartRename={() => setEditing(c.id)}
                          onRename={(title) => {
                            setEditing(null);
                            if (title.trim() && title.trim() !== c.title) onRename(c.id, title);
                          }}
                          onDelete={() => onDelete(c.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </nav>

          {/* The account: who is signed in, and the same menu the bar at the top has. */}
          <div className="safe-bottom shrink-0 border-t border-sidebar-border px-2 pt-2">
            <AccountMenu />
          </div>
        </div>
      </aside>
    </>
  );
}

function Row({
  running,
  waiting,
  conversation,
  elsewhere,
  active,
  editing,
  onSelect,
  onStartRename,
  onRename,
  onDelete,
}: {
  conversation: ConversationMeta;
  /** Started in the other kind of client: it can be read here, not continued. */
  elsewhere: boolean;
  /** A task is running in this conversation. */
  running: boolean;
  /** Its task is waiting for the user. Said instead of "running". */
  waiting: boolean;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = React.useState(conversation.title);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRename(draft);
        }}
        className="px-1"
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onRename(conversation.title);
          }}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Rename conversation"
          className="h-9 w-full rounded-lg border border-ring/60 bg-card px-2.5 text-[0.85rem] outline-none ring-3 ring-ring/15"
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group/row relative flex items-center rounded-lg transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-foreground/85 hover:bg-sidebar-accent/60",
      )}
    >
      {active ? <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brand" /> : null}
      <button type="button" onClick={onSelect} aria-current={active ? "page" : undefined} title={conversation.title} className="min-w-0 flex-1 truncate py-2 pr-1 pl-2.5 text-left text-[0.85rem] leading-5 outline-none focus-visible:underline">
        {conversation.title}
      </button>
      {waiting ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} role="img" aria-label="This chat is waiting for you" className="flex size-6 shrink-0 items-center justify-center outline-none">
              <span className="size-2 rounded-full bg-brass ring-2 ring-brass/25" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Waiting for you. Open it to carry on.</TooltipContent>
        </Tooltip>
      ) : running ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} role="img" aria-label="This chat is still working" className="flex size-6 shrink-0 items-center justify-center outline-none">
              <span className="size-2 animate-pulse-dot rounded-full bg-brand" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Working on it. Open it to follow along.</TooltipContent>
        </Tooltip>
      ) : null}
      {elsewhere ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} role="img" aria-label={readOnlyHint(conversation.origin)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle outline-none focus-visible:text-foreground">
              {conversation.origin === "desktop" ? <Monitor className="size-3.5" /> : <Globe className="size-3.5" />}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{readOnlyHint(conversation.origin)}</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu
        onOpenChange={(next) => {
          if (next) setDraft(conversation.title);
        }}
      >
        <DropdownMenuTrigger
          aria-label={`Options for ${conversation.title}`}
          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none group-hover/row:opacity-100 hover:bg-card hover:text-foreground focus-visible:opacity-100 data-[state=open]:bg-card data-[state=open]:opacity-100 max-md:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem onSelect={onStartRename}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
