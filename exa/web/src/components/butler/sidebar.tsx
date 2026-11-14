"use client";

import * as React from "react";
import { MessageSquareDashed, MoreHorizontal, PanelLeftClose, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationMeta } from "@/lib/conversations";
import { useClientValue } from "@/lib/use-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const DAY = 86_400_000;

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

function groupOf(updatedAt: number, startOfToday: number): string {
  if (updatedAt >= startOfToday) return "Today";
  if (updatedAt >= startOfToday - DAY) return "Yesterday";
  if (updatedAt >= startOfToday - 7 * DAY) return "Previous 7 days";
  return "Earlier";
}

/**
 * The list of saved conversations. On wide screens it is a column that slides shut; on narrow
 * screens it is a drawer over the chat. Conversations are saved in this browser only.
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
  onDeleteAll,
}: {
  open: boolean;
  onClose: () => void;
  conversations: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  // Midnight today, read in the browser (the server does not know the user's day).
  const today = useClientValue(startOfToday, 0);
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
          "z-50 flex h-dvh shrink-0 flex-col overflow-hidden border-sidebar-border bg-sidebar text-sidebar-foreground",
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
              New task
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
                <p className="text-[0.85rem] font-medium">No saved tasks yet</p>
                <p className="text-[0.78rem] leading-snug text-muted-foreground">Everything you ask is saved here, in this browser, so you can come back to it.</p>
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

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2.5 text-[0.72rem] text-muted-foreground">
            <span>Saved in this browser only</span>
            {conversations.length > 0 ? (
              confirmClear ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmClear(false);
                      onDeleteAll();
                    }}
                    className="rounded-md px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Delete all
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-sidebar-accent">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-sidebar-accent hover:text-foreground">
                  Clear
                </button>
              )
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

function Row({
  conversation,
  active,
  editing,
  onSelect,
  onStartRename,
  onRename,
  onDelete,
}: {
  conversation: ConversationMeta;
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
