"use client";

import type { ReactNode } from "react";
import { Button, Field as KitField, Plate, Tag, Working, type ButtonKind } from "../_ui/kit";

/**
 * Small building blocks of the plan sheet, kept in this folder so the planner can be mounted anywhere. They are thin
 * wrappers over the kit (src/app/_ui/kit.tsx): a white card for a document, lavender where the agent asks the buyer
 * to decide, and the hazard band only at the gate.
 */

export function Sheet({ children, safety = false, agent = false, className = "" }: { children: ReactNode; safety?: boolean; agent?: boolean; className?: string }) {
  return (
    <Plate as="section" tone={safety ? "gate" : agent ? "agent" : "paper"} className={className}>
      {children}
    </Plate>
  );
}

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; kind?: ButtonKind; size?: "sm" | "md" | "lg"; type?: "button" | "submit"; className?: string; title?: string };

export function Btn({ kind = "secondary", ...props }: ButtonProps) {
  return <Button kind={kind} {...props} />;
}

/**
 * A claim on a line: ok (a tick, good), warn (warm and calm, the notice colour: this looks off, never the gate's
 * yellow), muted, agent, plain.
 */
export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "ok" | "warn" | "muted" | "agent"; title?: string }) {
  if (tone === "warn")
    return (
      <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-notice-soft px-2.5 text-[0.78rem] font-medium leading-6 text-notice">
        {children}
      </span>
    );
  return (
    <Tag title={title} tone={tone === "ok" ? "good" : tone === "muted" ? "muted" : tone === "agent" ? "agent" : "plain"}>
      {children}
    </Tag>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <KitField label={label} className={className}>
      {children}
    </KitField>
  );
}

export function Spinner({ label }: { label: string }) {
  return <Working>{label}</Working>;
}
