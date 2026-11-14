import type { Known } from "../support/a11y-kit";

/**
 * Serious and critical axe violations (and unnamed controls) that exist today. The audit passes while only these
 * appear, and fails on anything new (another page, another node, a new rule). Each entry is a finding to fix, not a
 * waiver: remove it once fixed. Page ids: TARGETS in support/a11y-kit.ts plus "order-options" and "approve-done".
 * Fixed in design v2 (removed): the unnamed agent button in the kitchen portal header (button-name, control-name).
 */
export const KNOWN: Known[] = [
  {
    pages: ["orders"],
    rule: "color-contrast",
    match: "opacity-70",
    maxCount: 4,
    severity: "cosmetic",
    where: "src/app/k/[kitchen]/orders.tsx:44",
    reason: "The count beside an inactive tab ('Earlier history 18') is opacity-70 petrol on mist: 3.76:1, under 4.5:1.",
  },
  {
    pages: ["agent"],
    rule: "scrollable-region-focusable",
    match: "<pre",
    maxCount: 2,
    severity: "cosmetic",
    where: "src/app/k/[kitchen]/agent-rules.tsx:311,320",
    reason: "The MCP config and CLI snippets are horizontally scrollable <pre> blocks a keyboard user cannot focus to scroll (needs tabIndex=0 and a label).",
  },
  {
    pages: ["ops-safeguards"],
    rule: "definition-list",
    maxCount: 1,
    severity: "cosmetic",
    where: "src/app/ops/(desk)/safeguards/safeguards.tsx:87",
    reason: "<dl> whose children are <div><p> (Figure), not <dt>/<dd>: screen readers announce a broken list.",
  },
  {
    pages: ["ops-agents"],
    rule: "definition-list",
    severity: "cosmetic",
    where: "src/app/ops/(desk)/agents/agents.tsx:127",
    reason: "<dl> whose children are <div><p> (Stat), one per agent card, not <dt>/<dd>.",
  },
];
