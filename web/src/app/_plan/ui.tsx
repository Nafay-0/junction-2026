"use client";

import type { ReactNode } from "react";
import { Button, Field as KitField, Plate, Tag, Working, type ButtonKind } from "../_ui/kit";

/**
 * Small building blocks of the plan sheet, kept in this folder so the planner can be mounted anywhere. They are thin
 * wrappers over Dock's kit (src/app/_ui/kit.tsx): paper with a petrol rule for documents, lavender where the agent
 * asks the buyer to decide, and the hazard band only at the gate.
 */

export function Sheet({ children, safety = false, agent = false, className = "" }: { children: ReactNode; safety?: boolean; agent?: boolean; className?: string }) {
  return (
    <Plate as="section" tone={safety ? "gate" : agent ? "agent" : "paper"} className={className}>
      {children}
    </Plate>
  );
}

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; kind?: ButtonKind; type?: "button" | "submit"; className?: string; title?: string };

export function Btn({ kind = "secondary", ...props }: ButtonProps) {
  return <Button kind={kind} {...props} />;
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "ok" | "warn" | "muted" | "agent"; title?: string }) {
  return (
    <Tag title={title} tone={tone === "warn" ? "safety" : tone === "ok" ? "petrol" : tone === "muted" ? "muted" : tone === "agent" ? "agent" : "plain"}>
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
