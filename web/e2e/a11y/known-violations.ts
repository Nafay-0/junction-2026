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
    match: ["text-ink-faint", "opacity-80"],
    maxCount: 80,
    severity: "cosmetic",
    where: "src/app/_ui/kit.tsx:511 (tab count), src/app/k/[kitchen]/orders.tsx:151 (time on each order's date tile)",
    reason:
      "New kit: the count on an inactive orders tab is text-ink-faint on mist, 2.61:1 at 12.5 px; the time under each order's date (opacity-80, 11.2 px) is 3.53:1. One node per order row, so the count grows with history.",
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
  {
    pages: ["order", "order-options", "order-chosen"],
    rule: "listitem",
    match: "<li",
    maxCount: 80,
    severity: "cosmetic",
    where: "src/app/_ui/thread.tsx:73 (Thread: <ol role=\"log\">), BuyerTurn/AgentTurn render <li>",
    reason:
      "Triaged after main b9f934e (the conversation thread): role=\"log\" on the <ol> replaces its list role, so every turn's <li> is a list item outside a list. A screen reader still reads the log live, but not as a list of turns (no 'item 3 of 8'). One node per turn, so the count grows with the conversation. Fix: a <div role=\"log\"> holding the <ol>, or role=\"listitem\"-free <div> turns.",
  },
  {
    pages: ["ops", "ops-agents"],
    rule: "color-contrast",
    match: "text-ink-faint",
    maxCount: 6,
    severity: "cosmetic",
    where: "src/app/ops/_ui/filters.tsx:95 (count on an inactive filter chip)",
    reason: "Triaged after the operations desk redesign (0a1c3db): the count on an inactive filter chip is text-ink-faint on surface, 2.61:1 at 12.5 px (needs 4.5:1). The same token as the orders tab count above.",
  },
  {
    pages: ["ops-safeguards"],
    rule: "scrollable-region-focusable",
    match: "max-h-[70vh]",
    maxCount: 1,
    severity: "cosmetic",
    where: "src/app/ops/(desk)/safeguards/safeguards.tsx:108 (Refused attempts)",
    reason: "Triaged after the operations desk redesign: the refused-attempts list scrolls inside a 70vh box but nothing in it can take focus, so a keyboard user cannot scroll it (needs tabIndex=0 and a label on the <ol>).",
  },
  {
    pages: ["order-chosen"],
    rule: "color-contrast",
    match: "",
    maxCount: 40,
    severity: "cosmetic",
    where: "src/app/_ui/thread.tsx:318 (options card: the options not chosen get opacity-55)",
    reason:
      "Triaged after main b9f934e: once an option is chosen, the others stay on screen at 55 % opacity, which takes their small grey text (rank chip, delivery, product names) below 4.5:1. They are history, still readable for the record; a muted colour instead of opacity would keep contrast.",
  },
];
