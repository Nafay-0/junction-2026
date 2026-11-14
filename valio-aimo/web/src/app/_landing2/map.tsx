import type { CSSProperties } from "react";

/**
 * How the agents connect, in one picture: drawn in SVG, built up by the scroll (nodes, then the lines toward the
 * gate, then one order travelling in and one offer travelling across). At rest it is the complete diagram.
 *
 * Every connection is one the code makes (checked 14 Nov):
 *   chef -> buying agent        typed, spoken (voice door), a photo (scan door): docs/doors.md
 *   buying agent -> menu, search the menu planner (server/agent/menu) and smart search (server/search) work for it
 *   watch -> buying agent       its findings land in the kitchen's thread (server/watch/thread.ts)
 *   watch -> gate               renewals and an agreed backup are placed through the one gate (server/watch/service.ts)
 *   selling agent -> buying     signed offers (W3C VC); accepting starts an ordinary order (docs/offers.md)
 *   outside agents -> gate      MCP and REST, the Aiven Managed Agent over MCP (docs/connect-an-agent.md)
 *   gate <-> approver's phone   sign-off with a passkey bound to the order (approve/, core/policy.ts)
 *   gate -> ledger              every decision is a hash-chained entry (core/ledger.ts)
 *   ledger -> records, emails   order timelines, scorecard, Time machine (server/ops); receipts and alerts (server/notify)
 *   records -> copilot          the copilot reads records only, as a read-only user (infra/AIVEN-JUDGES.md)
 */

type Box = { x: number; y: number; w: number; h: number };
type MapNode = { id: string; name: string; sub: string[]; short?: string; tsub?: string[]; href: string; dark?: boolean; gate?: boolean };
type Edge = { id: string; d: string; label?: string; lx?: number; ly?: number };

const NODES: MapNode[] = [
  { id: "chef", name: "The chef", sub: ["types, speaks or sends a photo"], href: "/k" },
  { id: "buying", name: "The kitchen's buying agent", sub: ["reads, remembers, asks only what matters"], tsub: ["reads, remembers, asks"], href: "#story" },
  { id: "menu", name: "Menu planner", sub: ["dishes to order lines"], tsub: ["dishes to lines"], href: "/docs/connect-an-agent" },
  { id: "search", name: "Smart search", sub: ["17,546 products"], href: "/docs/smart-search" },
  { id: "watch", name: "The watch", sub: ["stock-outs and drift;", "places renewals, backups"], href: "/docs/connect-an-agent" },
  { id: "outside", name: "Outside agents", sub: ["MCP, REST, the Aiven Managed Agent"], href: "/docs/connect-an-agent" },
  { id: "gate", name: "The gate", sub: [], href: "#gate", gate: true },
  { id: "ledger", name: "The ledger", sub: ["hash-chained, every step"], tsub: ["every step, chained"], href: "/docs/assumptions", dark: true },
  { id: "emails", name: "Emails", sub: ["to the kitchen"], href: "/docs/mail" },
  { id: "records", name: "Records", sub: ["timelines, scorecard,", "Time machine"], href: "/ops" },
  { id: "selling", name: "The wholesaler's selling agent", short: "Selling agent", sub: ["signed offers, never an order"], tsub: ["the wholesaler's;", "signed offers"], href: "/docs/offers" },
  { id: "phone", name: "The approver's phone", short: "Approver's phone", sub: ["a named person's passkey"], tsub: ["a person's passkey"], href: "/docs/assumptions" },
  { id: "copilot", name: "The operations copilot", short: "Ops copilot", sub: ["reads the records"], href: "/ops/platform" },
];

const GATE_ROWS = ["Mandate", "Signed fixed price", "Rules, in plain code", "A person's passkey, beyond the mandate"];

/** The wide picture (a desk): the kitchen left, the wholesaler right, the gate between. */
const WIDE: { box: Record<string, Box>; edges: Edge[]; order: [number, number][]; offer: [number, number][]; vb: [number, number] } = {
  vb: [1200, 670],
  box: {
    chef: { x: 40, y: 30, w: 300, h: 62 },
    buying: { x: 40, y: 150, w: 300, h: 76 },
    menu: { x: 40, y: 256, w: 140, h: 56 },
    search: { x: 200, y: 256, w: 140, h: 56 },
    watch: { x: 40, y: 350, w: 300, h: 76 },
    outside: { x: 40, y: 480, w: 300, h: 64 },
    gate: { x: 450, y: 110, w: 300, h: 300 },
    ledger: { x: 450, y: 460, w: 300, h: 62 },
    emails: { x: 450, y: 572, w: 140, h: 62 },
    records: { x: 610, y: 572, w: 140, h: 74 },
    selling: { x: 860, y: 150, w: 300, h: 76 },
    phone: { x: 860, y: 350, w: 300, h: 76 },
    copilot: { x: 860, y: 480, w: 300, h: 64 },
  },
  edges: [
    { id: "chef-buying", d: "M190 92 V150" },
    { id: "buying-menu", d: "M110 226 V256" },
    { id: "buying-search", d: "M270 226 V256" },
    { id: "watch-buying", d: "M40 388 H18 V188 H40", label: "findings", lx: 8, ly: 300 },
    { id: "buying-gate", d: "M340 196 H450", label: "orders", lx: 372, ly: 188 },
    { id: "watch-gate", d: "M340 388 H400 V340 H450", label: "renewals, backups", lx: 352, ly: 380 },
    { id: "outside-gate", d: "M340 512 H420 V380 H450", label: "MCP, REST", lx: 352, ly: 504 },
    { id: "selling-buying", d: "M860 172 H810 V76 H400 V170 H340", label: "signed offers", lx: 560, ly: 68 },
    { id: "gate-phone", d: "M750 330 H805 V388 H860", label: "sign-off", lx: 762, ly: 322 },
    { id: "gate-ledger", d: "M600 410 V460" },
    { id: "ledger-emails", d: "M520 522 V572" },
    { id: "ledger-records", d: "M680 522 V572" },
    { id: "records-copilot", d: "M750 610 H830 V512 H860", label: "reads", lx: 790, ly: 640 },
  ],
  order: [
    [190, 60],
    [190, 196],
    [450, 196],
    [600, 260],
    [600, 491],
  ],
  offer: [
    [860, 172],
    [810, 172],
    [810, 76],
    [400, 76],
    [400, 170],
    [340, 170],
  ],
};

/** The tall picture (a phone): the same nodes and the same connections, one column. */
const TALL: typeof WIDE = {
  vb: [360, 930],
  box: {
    chef: { x: 24, y: 12, w: 312, h: 54 },
    buying: { x: 24, y: 96, w: 312, h: 62 },
    menu: { x: 24, y: 182, w: 148, h: 52 },
    search: { x: 188, y: 182, w: 148, h: 52 },
    watch: { x: 24, y: 262, w: 148, h: 78 },
    selling: { x: 188, y: 262, w: 148, h: 78 },
    outside: { x: 24, y: 366, w: 312, h: 54 },
    gate: { x: 24, y: 448, w: 312, h: 206 },
    ledger: { x: 24, y: 686, w: 148, h: 58 },
    phone: { x: 188, y: 686, w: 148, h: 58 },
    emails: { x: 24, y: 774, w: 148, h: 58 },
    records: { x: 188, y: 774, w: 148, h: 70 },
    copilot: { x: 188, y: 868, w: 148, h: 54 },
  },
  edges: [
    { id: "chef-buying", d: "M180 66 V96" },
    { id: "buying-menu", d: "M98 158 V182" },
    { id: "buying-search", d: "M262 158 V182" },
    { id: "watch-buying", d: "M24 300 H10 V127 H24", label: "findings", lx: 2, ly: 222 },
    { id: "buying-gate", d: "M180 158 V448", label: "orders", lx: 140, ly: 254 },
    { id: "watch-gate", d: "M98 340 V352 H16 V560 H24", label: "renewals", lx: 2, ly: 440 },
    { id: "outside-gate", d: "M120 420 V448" },
    { id: "selling-buying", d: "M336 300 H350 V127 H336", label: "offers", lx: 318, ly: 222 },
    { id: "gate-phone", d: "M262 654 V686", label: "sign-off", lx: 270, ly: 674 },
    { id: "gate-ledger", d: "M98 654 V686" },
    { id: "ledger-emails", d: "M98 744 V774" },
    { id: "ledger-records", d: "M150 744 V760 H262 V774" },
    { id: "records-copilot", d: "M262 844 V868", label: "reads", lx: 270, ly: 860 },
  ],
  order: [
    [180, 40],
    [180, 127],
    [180, 448],
    [180, 550],
    [98, 715],
  ],
  offer: [
    [336, 300],
    [350, 300],
    [350, 127],
    [336, 127],
  ],
};

/** A token's journey as keyframe stops, in the picture's own units (SVG user space). */
function journey(points: [number, number][]) {
  const segs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let run = 0;
  return points.map((p, i) => {
    if (i > 0) run += segs[i - 1];
    return { at: Math.round((run / total) * 100), x: p[0], y: p[1] };
  });
}

function keyframes(name: string, points: [number, number][]) {
  return `@keyframes ${name} { ${journey(points)
    .map((s) => `${s.at}% { transform: translate(${s.x}px, ${s.y}px); }`)
    .join(" ")} }`;
}

function Picture({ layout, kind, compact }: { layout: typeof WIDE; kind: "wide" | "tall"; compact?: boolean }) {
  const [W, H] = layout.vb;
  const name = compact ? 13 : 15;
  const sub = compact ? 10.5 : 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`l2-map-svg l2-map-${kind}`} role="group" aria-label="How the agents connect">
      <style>{`${keyframes(`l2-order-${kind}`, layout.order)} ${keyframes(`l2-offer-${kind}`, layout.offer)}`}</style>
      <g className="l2-map-edges" aria-hidden="true">
        {layout.edges.map((e, i) => (
          <g key={e.id} style={{ "--i": i } as CSSProperties}>
            <path d={e.d} pathLength={1} className={`l2-edge ${e.id === "selling-buying" ? "l2-edge-offer" : ""}`} />
            {e.label && (
              <text x={e.lx} y={e.ly} className="l2-edge-label" fontSize={compact ? 9.5 : 11}>
                {e.label}
              </text>
            )}
          </g>
        ))}
      </g>
      {NODES.map((n, i) => {
        const b = layout.box[n.id];
        if (!b) return null;
        const label = [n.name, ...n.sub].join(", ");
        if (n.gate)
          return (
            <a key={n.id} href={n.href} aria-label={`The gate: ${GATE_ROWS.join(", then ")}. Plain code, no model.`} className="l2-mn l2-mn-gate" style={{ "--i": i } as CSSProperties}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={compact ? 16 : 22} className="l2-mn-gate-box" />
              <text x={b.x + 18} y={b.y + (compact ? 34 : 42)} fontSize={compact ? 18 : 24} className="l2-mn-gate-title">
                The gate
              </text>
              <text x={b.x + 18} y={b.y + (compact ? 52 : 64)} fontSize={sub} className="l2-mn-gate-sub">
                plain code, no model
              </text>
              {GATE_ROWS.map((r, k) => {
                const top = b.y + (compact ? 68 : 86) + k * (compact ? 34 : 50);
                return (
                  <g key={r}>
                    <rect x={b.x + 14} y={top} width={b.w - 28} height={compact ? 28 : 40} rx={compact ? 8 : 10} className={k === 3 ? "l2-mn-gate-row l2-mn-gate-person" : "l2-mn-gate-row"} />
                    <text x={b.x + 28} y={top + (compact ? 18.5 : 25)} fontSize={compact ? 11 : 13.5} className="l2-mn-gate-text">
                      {r}
                    </text>
                  </g>
                );
              })}
            </a>
          );
        return (
          <a key={n.id} href={n.href} aria-label={label} className={`l2-mn ${n.dark ? "l2-mn-dark" : ""}`} style={{ "--i": i } as CSSProperties}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={compact ? 12 : 16} className="l2-mn-box" />
            <text x={b.x + 14} y={b.y + (compact ? 22 : 27)} fontSize={name} className="l2-mn-name">
              {compact && b.w < 200 && n.short ? n.short : n.name}
            </text>
            {(compact && n.tsub ? n.tsub : n.sub).map((s, k) => (
              <text key={s} x={b.x + 14} y={b.y + (compact ? 38 : 47) + k * (compact ? 13 : 15)} fontSize={sub} className="l2-mn-sub">
                {s}
              </text>
            ))}
          </a>
        );
      })}
      <g className="l2-map-tokens" aria-hidden="true">
        <circle r={compact ? 7 : 9} className="l2-tok l2-tok-order" style={{ animationName: `l2-order-${kind}` }} />
        <rect x={compact ? -6 : -8} y={compact ? -6 : -8} width={compact ? 12 : 16} height={compact ? 12 : 16} rx={3} className="l2-tok l2-tok-offer" style={{ animationName: `l2-offer-${kind}` }} />
      </g>
    </svg>
  );
}

export const MAP_LINES = [
  "The two sides never talk directly: they exchange signed things each can verify.",
  "Every order, from any agent, goes through the same gate.",
  "One ledger records every step.",
];

export function AgentMap() {
  return (
    <figure className="l2-map" data-map>
      <Picture layout={WIDE} kind="wide" />
      <Picture layout={TALL} kind="tall" compact />
      <figcaption className="l2-map-lines">
        {MAP_LINES.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </figcaption>
    </figure>
  );
}
