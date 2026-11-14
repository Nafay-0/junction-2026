"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/export";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A small, quiet icon button with a tooltip: the actions under a message and on a report. */
export function IconAction({
  label,
  onClick,
  disabled,
  className,
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  /** What the button does. Shown as the tooltip and read by screen readers. */
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[0.95rem]",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Flips to a tick for a moment after something was copied. */
export function useCopied(): [copied: boolean, mark: (ok: boolean) => void] {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const mark = React.useCallback((ok: boolean) => {
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, []);
  return [copied, mark];
}

/** Copy button. `text` may be a function so the content is only put together when asked for. */
export function CopyAction({
  text,
  html,
  label = "Copy",
  className,
}: {
  text: string | (() => string);
  /** A formatted version, for pasting into documents and email. */
  html?: () => string | undefined;
  label?: string;
  className?: string;
}) {
  const [copied, mark] = useCopied();
  return (
    <>
      <IconAction
        label={copied ? "Copied" : label}
        className={className}
        onClick={() => void copyText(typeof text === "function" ? text() : text, html?.()).then(mark)}
      >
        {copied ? <Check className="text-brand" /> : <Copy />}
      </IconAction>
      <span className="sr-only" role="status">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
