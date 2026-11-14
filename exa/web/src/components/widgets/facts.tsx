"use client";

import * as React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainOf, faviconOf, type KeyFactsData, type WidgetProps } from "@/lib/widgets/types";
import { Favicon, Shimmer, WidgetError, WidgetFrame } from "./frame";

type Fact = KeyFactsData["facts"][number];

/** short: a number-like headline in the display type; medium: a phrase; long: a sentence that gets its own row. */
function sizeOf(value: string): "short" | "medium" | "long" {
  const v = value.trim();
  if (v.length <= 11) return "short";
  if (v.length <= 30) return "medium";
  return "long";
}

export function KeyFacts({ data, loading }: WidgetProps<KeyFactsData>) {
  const facts = data.facts ?? [];
  const placeholders = loading ? Math.max(0, Math.min(6, 6 - facts.length)) : 0;

  return (
    <WidgetFrame
      icon={<Hash />}
      title={data.title || "Key facts"}
      subtitle={facts.length > 0 ? `${facts.length} ${facts.length === 1 ? "fact" : "facts"}` : undefined}
      sources={data.sources}
      loading={loading}
      stage={data.stage}
    >
      {data.error ? (
        <WidgetError message={data.error} />
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
          {facts.map((fact, i) => (
            <FactTile key={`${fact.label}-${i}`} fact={fact} index={i} />
          ))}
          {Array.from({ length: placeholders }, (_, i) => (
            <div key={`ph-${i}`} aria-hidden className="flex min-h-[6.5rem] flex-col gap-2.5 rounded-xl bg-surface p-3.5 hairline">
              <Shimmer className="h-2.5 w-20" />
              <Shimmer className="h-7 w-16" />
              <Shimmer className="mt-auto h-2.5 w-3/4" />
            </div>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

function FactTile({ fact, index }: { fact: Fact; index: number }) {
  const value = fact.value ?? "";
  const size = sizeOf(value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "group/fact relative flex min-w-0 flex-col rounded-xl bg-surface p-3.5 hairline transition-colors hover:bg-surface-raised",
        size === "long" && "col-span-full",
      )}
    >
      <span className="text-[0.74rem] leading-4 font-medium text-muted-foreground">{fact.label}</span>

      <motion.span
        initial={{ opacity: 0, filter: "blur(3px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.06 + 0.08, ease: "easeOut" }}
        className={cn(
          "mt-1.5 block break-words text-foreground",
          size === "short" && "nums font-display text-[1.35rem] leading-[1.15] sm:text-[1.5rem]",
          size === "medium" && "nums text-[1.02rem] leading-snug font-medium tracking-tight",
          size === "long" && "text-[0.9rem] leading-relaxed",
        )}
      >
        {value}
      </motion.span>

      {fact.detail ? (
        <span className="mt-1.5 text-[0.76rem] leading-snug text-muted-foreground">{fact.detail}</span>
      ) : null}

      {fact.sourceUrl ? (
        <span className="mt-auto pt-2.5">
          <SourcePill url={fact.sourceUrl} />
        </span>
      ) : null}
    </motion.div>
  );
}

function SourcePill({ url }: { url: string }) {
  const domain = domainOf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-1 text-[0.7rem] text-muted-foreground transition-colors outline-none hover:border-ring/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Favicon source={{ favicon: faviconOf(url), domain }} className="size-3.5" />
      <span className="truncate">{domain}</span>
      <ArrowUpRight className="size-3 shrink-0 text-subtle transition-transform group-hover/fact:translate-x-px group-hover/fact:-translate-y-px" aria-hidden />
    </a>
  );
}
