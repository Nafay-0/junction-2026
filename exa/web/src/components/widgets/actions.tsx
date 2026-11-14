"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarPlus,
  Check,
  Copy,
  Download,
  Link2,
  Mail,
  Navigation,
  Phone,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { domainOf, type ActionItem, type ActionsData, type WidgetProps } from "@/lib/widgets/types";
import { Shimmer, WidgetError, WidgetFrame } from "./frame";

const ICONS: Record<ActionItem["type"], LucideIcon> = {
  link: Link2,
  book: CalendarCheck,
  call: Phone,
  email: Mail,
  directions: Navigation,
  calendar: CalendarPlus,
  download: Download,
};

function isInPlace(href: string) {
  return /^(tel|mailto|sms):/i.test(href);
}

/** What the copy button puts on the clipboard: the number or address for tel:/mailto:, the URL otherwise. */
function copyValueOf(href: string) {
  const m = href.match(/^(tel|mailto|sms):([^?]*)/i);
  return m ? decodeURIComponent(m[2]) : href;
}

/** A quiet line under the label when the action has no description. */
function metaOf(action: ActionItem) {
  if (isInPlace(action.href)) return copyValueOf(action.href);
  return domainOf(action.href);
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function Actions({ data, loading }: WidgetProps<ActionsData>) {
  const actions = React.useMemo(() => {
    const list = (data.actions ?? []).filter((a) => a && a.href && a.label);
    // The primary action leads; the rest keep their order.
    const primary = list.findIndex((a) => a.primary);
    if (primary > 0) list.unshift(list.splice(primary, 1)[0]);
    return list;
  }, [data.actions]);

  const showSkeleton = loading && actions.length === 0;

  return (
    <WidgetFrame
      icon={<Zap />}
      title={data.title || "Get it done"}
      subtitle={actions.length > 0 ? `${actions.length} ${actions.length === 1 ? "action" : "actions"}` : undefined}
      sources={data.sources}
      loading={loading}
      stage={data.stage}
    >
      {data.error ? (
        <WidgetError message={data.error} />
      ) : showSkeleton ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={cn("flex items-center gap-3 rounded-xl p-3 hairline", i === 0 && "sm:col-span-2")}>
              <Shimmer className="size-9 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Shimmer className="h-3 w-1/2" />
                <Shimmer className="h-2.5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {actions.map((action, i) => (
            <ActionTile
              key={`${action.href}-${i}`}
              action={action}
              index={i}
              wide={Boolean(action.primary) || (i === actions.length - 1 && (actions.length - (actions[0]?.primary ? 1 : 0)) % 2 === 1)}
            />
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function ActionTile({ action, index, wide }: { action: ActionItem; index: number; wide: boolean }) {
  const Icon = ICONS[action.type] ?? Link2;
  const inPlace = isInPlace(action.href);
  const primary = Boolean(action.primary);
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await writeClipboard(copyValueOf(action.href));
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const copyLabel = action.type === "call" ? "Copy number" : action.type === "email" ? "Copy address" : "Copy link";
  const Arrow = inPlace ? ArrowRight : ArrowUpRight;

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.05, ease: "easeOut" }}
      className={cn("group/action relative", wide && "sm:col-span-2")}
    >
      <a
        href={action.href}
        {...(inPlace ? {} : { target: "_blank", rel: "noreferrer" })}
        className={cn(
          "flex min-h-14 items-center gap-3 rounded-xl py-2.5 pr-20 pl-2.5 transition-[background-color,border-color,box-shadow,transform] duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px",
          primary
            ? "bg-primary text-primary-foreground shadow-card hover:bg-primary/90 hover:shadow-float"
            : "border border-border bg-card hover:border-ring/40 hover:bg-surface",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-[1.05rem]",
            primary ? "bg-primary-foreground/15 text-primary-foreground" : "bg-brand-soft text-brand",
          )}
        >
          <Icon aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.88rem] leading-5 font-medium">{action.label}</span>
          <span
            className={cn(
              "block truncate text-[0.76rem] leading-4",
              primary ? "text-primary-foreground/75" : "text-muted-foreground",
            )}
          >
            {action.description || metaOf(action)}
          </span>
        </span>
        <Arrow
          aria-hidden
          className={cn(
            "absolute top-1/2 right-3.5 size-4 -translate-y-1/2 transition-transform duration-200",
            inPlace ? "group-hover/action:translate-x-0.5" : "group-hover/action:translate-x-0.5 group-hover/action:-translate-y-[calc(50%+2px)]",
            primary ? "text-primary-foreground/80" : "text-subtle group-hover/action:text-foreground",
          )}
        />
        {!inPlace ? <span className="sr-only">(opens in a new tab)</span> : null}
      </a>

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : copyLabel}
        title={copied ? "Copied" : copyLabel}
        className={cn(
          "absolute top-1/2 right-10 flex h-8 -translate-y-1/2 items-center gap-1 rounded-lg px-2 text-[0.72rem] font-medium transition-[opacity,background-color,color] duration-200 outline-none focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50",
          "opacity-0 group-focus-within/action:opacity-100 group-hover/action:opacity-100 [@media(hover:none)]:opacity-100",
          copied && "opacity-100",
          primary
            ? "text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            : "text-subtle hover:bg-muted hover:text-foreground",
        )}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span className={cn("overflow-hidden transition-[max-width] duration-200", copied ? "max-w-14" : "max-w-0")}>
          Copied
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </motion.li>
  );
}
