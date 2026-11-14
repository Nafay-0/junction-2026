"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MODES, MODE_IDS, type ModeId } from "@/lib/agent/modes";
import { AccountChange, capFromText, firstProblem } from "@/lib/auth/validation";
import type { Account } from "@/lib/db/admin";
import { ModeIcon } from "@/components/butler/mode-icon";
import { share, usd } from "./format";
import { Meter } from "./usage-parts";

/*
 * What the admin decides for each account: which modes it may use, whether it sees what its
 * conversations cost, and the most it may spend. The same controls sit in every account's row and
 * in the form that adds an account.
 */

/** The three things the admin sets per account. */
export type Permissions = Pick<Account, "modes" | "showUsage" | "usageCapUsd">;

/** True when the account has used up what it may spend: nothing more runs for it until the limit is raised or removed. */
export const limitReached = (account: Pick<Account, "costUsd" | "usageCapUsd">) => account.usageCapUsd !== null && account.costUsd >= account.usageCapUsd;

const LIMIT_PROBLEM = "Give the limit as an amount in US dollars, or leave it empty for no limit.";

/** The modes as chips that switch on and off. One always stays on: an account with no mode could not ask for anything. */
export function ModeChips({ value, onChange, who }: { value: ModeId[]; onChange: (next: ModeId[]) => void; who: string }) {
  const toggle = (id: ModeId) => {
    const on = value.includes(id);
    if (on && value.length === 1) {
      toast.info("An account needs at least one mode. Switch another on first.");
      return;
    }
    onChange(MODE_IDS.filter((mode) => (mode === id ? !on : value.includes(mode))));
  };
  return (
    <div role="group" aria-label={`Modes ${who} may use`} className="flex flex-wrap gap-1.5">
      {MODES.map((mode) => {
        const on = value.includes(mode.id);
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={on}
            title={mode.blurb}
            onClick={() => toggle(mode.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[0.78rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 md:h-7",
              on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted-foreground hover:border-ring/40 hover:text-foreground",
            )}
          >
            <ModeIcon mode={mode.id} className="size-3.5" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

/** An on-off switch with its words beside it. */
export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[0.8rem] select-none md:min-h-7">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30", checked ? "bg-brand" : "bg-input")}
      >
        <span className={cn("block size-4 rounded-full bg-background shadow-sm transition-transform duration-200", checked ? "translate-x-[1.125rem]" : "translate-x-0.5")} />
      </button>
      <span className={checked ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </label>
  );
}

/** The amount field of a limit: dollars, empty for none. */
export function LimitInput({ id, value, onChange, onCommit, onCancel, label }: { id?: string; value: string; onChange: (text: string) => void; onCommit?: () => void; onCancel?: () => void; label: string }) {
  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden className="pointer-events-none absolute left-2.5 text-[0.8rem] text-subtle">
        $
      </span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onCommit) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
            e.currentTarget.blur();
          }
        }}
        placeholder="No limit"
        aria-label={label}
        className="nums h-8 w-[6.75rem] rounded-full border border-input bg-background pr-2.5 pl-6 text-[0.8rem] outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 md:h-7"
      />
    </span>
  );
}

/** An account's limit, saved when the field is left or Enter is pressed. Escape puts back what was there. */
function LimitField({ account, onSave }: { account: Account; onSave: (next: number | null) => void }) {
  const saved = account.usageCapUsd;
  const shown = saved === null ? "" : String(saved);
  const [text, setText] = React.useState(shown);
  // The saved limit changed under the field (it was saved, or the list was read again): show it.
  const [seen, setSeen] = React.useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setText(shown);
  }
  const cancelled = React.useRef(false);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setText(shown);
      return;
    }
    const next = capFromText(text);
    const parsed = next === undefined ? null : AccountChange.safeParse({ usageCapUsd: next });
    if (next === undefined || !parsed?.success) {
      toast.error(parsed && !parsed.success ? firstProblem(parsed.error) : LIMIT_PROBLEM);
      setText(shown);
      return;
    }
    if (next === saved) {
      setText(shown);
      return;
    }
    onSave(next);
  };

  return <LimitInput value={text} onChange={setText} onCommit={commit} onCancel={() => (cancelled.current = true)} label={`Usage limit for ${account.name}, in US dollars. Empty for no limit`} />;
}

/** What the account has used, against its limit when it has one. */
export function LimitUse({ account }: { account: Pick<Account, "costUsd" | "usageCapUsd"> }) {
  const cap = account.usageCapUsd;
  if (cap === null) return <span className="nums text-[0.76rem] whitespace-nowrap text-muted-foreground">{usd(account.costUsd)} used so far</span>;
  const over = limitReached(account);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-16 shrink-0">
        <Meter value={share(account.costUsd, cap)} tone={over ? "danger" : "brand"} />
      </span>
      <span className={cn("nums text-[0.76rem] whitespace-nowrap", over ? "font-medium text-destructive" : "text-muted-foreground")}>
        {usd(account.costUsd)} of {usd(cap)} used
      </span>
      {over ? <LimitReached /> : null}
    </span>
  );
}

export function LimitReached() {
  return (
    <span title="Nothing more runs for this account until you raise or remove the limit." className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[0.72rem] font-medium whitespace-nowrap text-destructive">
      <span className="size-1.5 rounded-full bg-destructive" />
      Limit reached
    </span>
  );
}

const Sep = () => (
  <span aria-hidden className="text-border">
    ·
  </span>
);

/**
 * One account's permissions, as controls that save the moment they are changed. The admin's own
 * are fixed, so they are only said: every mode, usage in view, no limit.
 */
export function PermissionControls({ account, onChange }: { account: Account; onChange: (change: Partial<Permissions>) => void }) {
  if (account.role === "admin") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78rem] text-muted-foreground" title="The admin account always has every mode, sees usage and has no limit.">
        <span className="inline-flex items-center gap-1 text-brand">
          {MODES.map((mode) => (
            <ModeIcon key={mode.id} mode={mode.id} className="size-3.5" />
          ))}
        </span>
        <span>All modes</span>
        <Sep />
        <span>Sees usage</span>
        <Sep />
        <span>No limit</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
      <ModeChips value={account.modes} onChange={(modes) => onChange({ modes })} who={account.name} />
      <Toggle checked={account.showUsage} onChange={(showUsage) => onChange({ showUsage })}>
        Sees usage and cost
      </Toggle>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[0.8rem] text-muted-foreground">Usage limit</span>
        <LimitField account={account} onSave={(usageCapUsd) => onChange({ usageCapUsd })} />
        <LimitUse account={account} />
      </div>
    </div>
  );
}
