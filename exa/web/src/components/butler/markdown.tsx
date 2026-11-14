"use client";

import * as React from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { domainOf, faviconOf } from "@/lib/widgets/types";

/**
 * Markdown for agent text and reports. Handles text that is still streaming.
 * Links render as small source pills (favicon + site name) so a reader sees where a claim comes from
 * without clicking.
 */
export function Markdown({
  children,
  streaming,
  className,
}: {
  children: string;
  /** True while the text is still arriving. */
  streaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      isAnimating={streaming}
      className={cn("butler-prose", className)}
      components={COMPONENTS}
    >
      {children}
    </Streamdown>
  );
}

// Streamdown types its overrides loosely; the anchor override only reads `href` and `children`.
const COMPONENTS = { a: SourceLink } as unknown as React.ComponentProps<typeof Streamdown>["components"];

function SourceLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <span>{children}</span>;
  const isWeb = /^https?:\/\//i.test(href);
  if (!isWeb) {
    return (
      <a href={href} className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand">
        {children}
      </a>
    );
  }
  const domain = domainOf(href);
  const label = textOf(children);
  // A link whose text is just the site name (or a number) is a citation: show it as a pill.
  const isCitation = !label || /^\[?\d+\]?$/.test(label) || label.replace(/^www\./, "").toLowerCase() === domain.toLowerCase() || label.length <= 28;
  if (!isCitation) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand"
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="mx-0.5 inline-flex max-w-[14rem] translate-y-[-1px] items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-px align-middle text-[0.72em] leading-5 font-medium text-muted-foreground no-underline transition-colors hover:border-ring/60 hover:bg-accent hover:text-foreground"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={faviconOf(href)} alt="" className="size-3 shrink-0 rounded-full" loading="lazy" />
      <span className="truncate">{/^\[?\d+\]?$/.test(label) || !label ? domain : label}</span>
    </a>
  );
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}
