import type { Known } from "../support/a11y-kit";

/**
 * Serious and critical axe violations (and unnamed controls) that exist today. The audit passes while only these
 * appear, and fails on anything new (another page, another node, a new rule). Each entry is a finding to fix, not a
 * waiver: remove it once fixed. Page ids: TARGETS in support/a11y-kit.ts plus "order-options" and "approve-done".
 */
const STORE = ["kaari", "order", "order-options", "catalogue", "product", "basket", "orders", "agent"];

export const KNOWN: Known[] = [
  {
    pages: STORE,
    rule: "button-name",
    match: 'aria-controls="assistant"',
    maxCount: 1,
    severity: "would lose points",
    where: "src/app/k/[kitchen]/portal.tsx:389-401",
    reason:
      "The purchasing-agent button in the kitchen portal header has only an icon below the sm breakpoint (its label is `hidden sm:inline`, no aria-label), so on a phone it is announced as just 'button'.",
  },
  {
    pages: STORE,
    rule: "control-name",
    match: 'aria-controls="assistant"',
    maxCount: 1,
    severity: "would lose points",
    where: "src/app/k/[kitchen]/portal.tsx:389-401",
    reason: "The same button, seen in Chromium's accessibility tree: no accessible name on a phone.",
  },
  {
    pages: ["orders"],
    rule: "color-contrast",
    match: "opacity-70",
    maxCount: 4,
    severity: "cosmetic",
    where: "src/app/k/[kitchen]/orders.tsx:42",
    reason: "The count beside an inactive tab ('Earlier history 18') is opacity-70 petrol on mist: 3.77:1, under 4.5:1.",
  },
  {
    pages: ["agent"],
    rule: "scrollable-region-focusable",
    match: "<pre",
    maxCount: 2,
    severity: "cosmetic",
    where: "src/app/k/[kitchen]/agent-rules.tsx:276,285",
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
    where: "src/app/ops/(desk)/agents/agents.tsx:126",
    reason: "<dl> whose children are <div><p> (Stat), one per agent card, not <dt>/<dd>.",
  },
];
