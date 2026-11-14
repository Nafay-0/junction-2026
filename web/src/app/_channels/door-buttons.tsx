"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useText } from "../_i18n/provider";
import { CallScreen } from "./call-screen";
import { DOORS_TEXT } from "./doors.text";
import { ScanDoor } from "./scan-door";

/**
 * The two doors as small square buttons for the portal's assistant panel (its ChannelSlot): a microphone that
 * opens the call with the kitchen's agent, and a camera that opens "add a photo or document". Each opens over
 * the page (in a portal on <body>, so it is outside the panel's form) and runs the same flow as typing; nothing is
 * handed back to the text field, so nothing is read twice.
 */
export function DoorButtons({
  kitchen,
  disabled,
}: {
  kitchen: string;
  disabled?: boolean;
}) {
  const tx = useText(DOORS_TEXT);
  const [open, setOpen] = useState<"call" | "scan" | null>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) =>
      e.key === "Escape" && open === "scan" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const btn =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:opacity-50";
  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => setOpen("call")}
        aria-label={tx.callButton}
        title={tx.callTitle}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" />
        </svg>
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => setOpen("scan")}
        aria-label={tx.scan}
        title={tx.scan}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-mist"
            role="dialog"
            aria-modal="true"
            aria-label={open === "call" ? tx.callDialog : tx.scan}
          >
            {open === "call" ? (
              <CallScreen
                kitchen={kitchen}
                onClose={() => setOpen(null)}
                signOffHref={(o) =>
                  o.approval
                    ? `/approve/${encodeURIComponent(o.approval.approvalId)}`
                    : undefined
                }
              />
            ) : (
              <div className="mx-auto max-w-5xl px-4 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="display min-w-0 text-[2rem] hyphens-auto [overflow-wrap:anywhere]">{tx.scan}</h2>
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="min-h-11 border-2 border-petrol px-3 font-semibold text-petrol"
                  >
                    {tx.close}
                  </button>
                </div>
                <ScanDoor
                  kitchen={kitchen}
                  renderSignOff={(o) =>
                    o.approval ? (
                      <a
                        className="font-semibold underline"
                        href={`/approve/${encodeURIComponent(o.approval.approvalId)}`}
                      >
                        {tx.openSignOff}
                      </a>
                    ) : null
                  }
                />
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
