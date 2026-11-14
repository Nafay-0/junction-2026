"use client";

import * as React from "react";
import { LoaderCircle, Lock, Mail, RotateCw } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { useUser } from "@/lib/auth/client";
import { refreshCap, useCap } from "@/lib/usage-cap-client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtUsd } from "./usage";

/*
 * The usage limit, as the user meets it. When the account has used what its admin allowed,
 * whatever was running stops, a dialog says so once, and the message box gives way to a short
 * note. Both say the same thing: nothing is broken, the limit is the admin's to raise.
 */

function useCheckAgain() {
  const [checking, setChecking] = React.useState(false);
  const check = React.useCallback(async () => {
    setChecking(true);
    const status = await refreshCap();
    setChecking(false);
    return status;
  }, []);
  return { checking, check };
}

const mailto = (email: string, name: string) =>
  `mailto:${email}?subject=${encodeURIComponent(`${APP_NAME}: usage limit reached`)}&body=${encodeURIComponent(`Hello,\n\nMy ${APP_NAME} account (${name}) has reached its usage limit. Could you raise it?\n\nThank you`)}`;

/** Said once, when the limit is reached: why everything stopped and who can change it. */
export function CapDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const cap = useCap();
  const user = useUser();
  const { checking, check } = useCheckAgain();
  // The amounts are only known here for an account that may see its usage.
  const amounts = cap.capUsd !== null && cap.spentUsd !== null ? ` (${fmtUsd(cap.spentUsd)} used of ${fmtUsd(cap.capUsd)})` : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[27rem]">
        <div className="p-5 sm:p-6">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brass/15 text-brass">
            <Lock className="size-5" />
          </span>
          <DialogHeader className="mt-4 gap-2 text-left">
            <DialogTitle className="text-[1.15rem] leading-tight font-semibold tracking-tight">You have reached your usage limit</DialogTitle>
            <DialogDescription className="text-[0.88rem] leading-relaxed text-muted-foreground">
              Your administrator set a limit on how much this account can use, and it has been reached{amounts}. Whatever was running has stopped, and nothing more can run until they raise it. Your conversations are still here to read.
            </DialogDescription>
          </DialogHeader>
        </div>
        {/* On a phone the two buttons stack, the way to the administrator on top; with room they sit side by side. */}
        <DialogFooter className="mx-0 mb-0 gap-2 rounded-none border-t border-border bg-surface/60 p-4 whitespace-nowrap sm:px-6">
          <button
            type="button"
            onClick={() => void check().then((status) => (status.reached ? undefined : onOpenChange(false)))}
            disabled={checking}
            className="flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {checking ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            Check again
          </button>
          {cap.adminEmail ? (
            <a
              href={mailto(cap.adminEmail, user.email)}
              className="flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Mail className="size-4" />
              Contact your administrator
            </a>
          ) : (
            <button type="button" onClick={() => onOpenChange(false)} className="flex h-10 items-center justify-center rounded-full bg-primary px-5 text-[0.85rem] font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Close
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** In place of the message box while the account is at its limit. */
export function CapNote({ onDetails }: { onDetails: () => void }) {
  const { checking, check } = useCheckAgain();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-3xl border border-border bg-card px-4 py-3.5 shadow-card sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brass/15 text-brass">
        <Lock className="size-[1.05rem]" />
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="text-[0.9rem] leading-5 font-medium">Usage limit reached</p>
        <p className="mt-0.5 text-[0.8rem] leading-snug text-muted-foreground">Nothing more can run on this account until your administrator raises its limit.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          aria-label="Check again"
          title="Check again"
          className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          {checking ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
        </button>
        <button type="button" onClick={onDetails} className="flex h-9 items-center rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]">
          What now
        </button>
      </div>
    </div>
  );
}
