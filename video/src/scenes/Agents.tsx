import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, EASE, EASE_IO, prog, Q, Rise, Wire } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Agent, B, BrowserFrame, Buyer, DishRow, IconMic, PhoneFrame, Say, ThreadLine } from "../ui";
import { AGENT_W, AgentNode, TheGate } from "../world";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("agents", phrase, shift);
const T = {
  ghosts: c("Six agents", -6),
  tech: c("AI SDK", -4),
  buyer: c("the buyer"),
  menu: c("a menu planner"),
  watch: c("a stock-out watch"),
  seller: c("the wholesaler's seller"),
  outside: c("any outside agent"),
  ops: c("an operations copilot"),
  meet: c("None can order"),
};

/** The ring: the gate at the centre, the six around it. Exported for the camera moves in and out of this scene. */
export const RING_GATE = { x: 960, y: 452, w: 250 };
const GH = (RING_GATE.w * 700) / 400;
const NODE_H = 118;
const LX = 96;
const RX = 1920 - 96 - AGENT_W;
const ROWS = [196, 452, 708];
/** The product's own six (web/src/app/_landing2: "Six agents, one gate"). Voice is how you talk to the first. */
const SIX = [
  { at: T.buyer, name: "Buying agent", sub: "text or hands-free voice", x: LX, y: ROWS[0] },
  { at: T.menu, name: "Menu planner", sub: "dishes within the rules", x: LX, y: ROWS[1] },
  { at: T.watch, name: "The watch", sub: "sees a stock-out first", x: LX, y: ROWS[2] },
  { at: T.seller, name: "Selling agent", sub: "signed offers, never a purchase", x: RX, y: ROWS[0] },
  { at: T.outside, name: "Any outside agent", sub: "over MCP or REST", x: RX, y: ROWS[1] },
  { at: T.ops, name: "Operations copilot", sub: "answers from rows", x: RX, y: ROWS[2] },
];
export const BUYER_NODE = { x: LX + AGENT_W / 2, y: ROWS[0], w: AGENT_W };

const Card = ({ children, width = 1320, dark = false }: { children: ReactNode; width?: number; dark?: boolean }) => (
  <div style={{ width, boxSizing: "border-box", borderRadius: 34, background: dark ? C.slab : C.mist, boxShadow: SHADOW.xl, padding: "40px 48px", ...sans }}>{children}</div>
);

const Voice = () => {
  const frame = useCurrentFrame();
  const t = frame - T.buyer;
  const speaking = prog(frame, T.buyer + 34, Q);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 30 }}>
        <div style={{ height: 76, padding: "0 30px", borderRadius: 38, background: C.lavenderDeep, color: C.paper, display: "flex", alignItems: "center", gap: 16, fontSize: 32, fontWeight: 600, whiteSpace: "nowrap" }}>
          <IconMic size={32} />
          {speaking < 0.5 ? "Hearing you" : "Agent speaking"}
        </div>
        <div style={{ flex: 1, height: 76, display: "flex", alignItems: "center", gap: 8 }}>
          {Array.from({ length: 40 }, (_, k) => (
            <span key={k} style={{ flex: 1, height: 12 + 56 * Math.abs(Math.sin(t * 0.33 + k * 0.7) * Math.sin(t * 0.13 + k * 0.31)), borderRadius: 4, background: speaking < 0.5 ? C.petrol : C.lavenderDeep, opacity: 0.85 }} />
          ))}
        </div>
      </div>
      <ThreadLine style={{ fontSize: 36 }}>
        <Buyer spoken>Ten litres of lactose-free whipping cream for Thursday</Buyer>
        <Rise at={T.buyer + 34} dur={Q} y={14}>
          <Agent>
            <Say style={{ maxWidth: "none" }}>
              10 Valio Eila lactose-free whipping cream, that&apos;s 10 litres, for Thursday: <B>52 euros</B>. Shall I order it?
            </Say>
          </Agent>
        </Rise>
      </ThreadLine>
    </Card>
  );
};

const Planner = () => (
  <Card>
    <ThreadLine style={{ fontSize: 35 }}>
      <Buyer>I have a big lunch next week: a dish for 20 people</Buyer>
      <Agent>
        <div style={{ ...display, fontSize: "1.2em", color: C.ink }}>Savoury cheese and bread bake</div>
        <Rise at={T.menu + 6} dur={Q} y={12}>
          <DishRow label="You have">ground nutmeg, salt, black pepper, wheat flour</DishRow>
        </Rise>
        <Rise at={T.menu + 10} dur={Q} y={12}>
          <DishRow label="I'll order">hard cheese 1,2 kg, cream 800 ml, eggs 1,25 kg, butter 160 g, mustard 80 g</DishRow>
        </Rise>
        <Rise at={T.menu + 14} dur={Q} y={12}>
          <DishRow label="Can't get">
            white bread, whole milk <span style={{ color: C.notice, fontStyle: "italic" }}>(cannot arrive by Tue 17 Nov)</span>
          </DishRow>
        </Rise>
      </Agent>
    </ThreadLine>
  </Card>
);

const PhonePic = ({ src }: { src: string }) => (
  <PhoneFrame>
    <Img src={staticFile(src)} style={{ width: 390, height: 844 }} />
  </PhoneFrame>
);

const OpsPic = () => (
  <BrowserFrame width={1320} height={760} url="aimopilot.zeroanomaly.tech/ops/agents">
    <Img src={staticFile("shots/ops-agents.webp")} style={{ width: 1320 }} />
  </BrowserFrame>
);

const CALLS = [
  { dir: "→", text: "POST /api/mcp", note: "a signed mandate" },
  { dir: "→", text: "find_products", note: "" },
  { dir: "→", text: "request_quote", note: "fixed price, signed" },
  { dir: "→", text: "place_order", note: "" },
  { dir: "←", text: "waiting for a person's sign-off", note: "" },
];
const Outside = () => {
  const frame = useCurrentFrame();
  return (
    <Card dark>
      {CALLS.map((l, k) => {
        const p = prog(frame, T.outside + 4 + k * 3, Q);
        const back = l.dir === "←";
        return (
          <div key={l.text} style={{ display: "flex", alignItems: "baseline", gap: 22, padding: "13px 0", opacity: p, translate: `${(1 - p) * 26}px 0px`, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 44 }}>
            <span style={{ color: back ? C.safety : C.lime, width: 40 }}>{l.dir}</span>
            <span style={{ color: back ? C.safety : C.paper }}>{l.text}</span>
            <span style={{ ...sans, fontSize: 30, color: C.chalkSoft }}>{l.note}</span>
          </div>
        );
      })}
    </Card>
  );
};

/** Each agent's picture: its native size, and the component. */
const PICS: { w: number; h: number; el: ReactNode }[] = [
  { w: 1320, h: 430, el: <Voice /> },
  { w: 1320, h: 470, el: <Planner /> },
  { w: 412, h: 866, el: <PhonePic src="shots/agent-watch.webp" /> },
  { w: 412, h: 866, el: <PhonePic src="shots/agent-seller-phone.webp" /> },
  { w: 1320, h: 470, el: <Outside /> },
  { w: 1320, h: 804, el: <OpsPic /> },
];

/** A picture opens out of its agent's node to the middle of the frame, holds, and folds back into the node. */
const Opened = ({ i }: { i: number }) => {
  const frame = useCurrentFrame();
  const a = SIX[i];
  const open = a.at;
  const shut = (SIX[i + 1]?.at ?? T.meet) - 8;
  if (frame < open || frame > shut + 12) return null;
  const o = interpolate(frame, [open, open + 14], [0, 1], { ...clamp, easing: EASE });
  const q = interpolate(frame, [shut, shut + 12], [0, 1], { ...clamp, easing: EASE_IO });
  const v = o * (1 - q);
  const P = PICS[i];
  const k1 = Math.min(1240 / P.w, 780 / P.h);
  const k0 = Math.min(AGENT_W / P.w, NODE_H / P.h);
  const k = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * v);
  const nx = a.x + AGENT_W / 2;
  const cx = nx + (960 - nx) * v;
  const cy = a.y + (548 - a.y) * v;
  return (
    <div style={{ position: "absolute", left: cx - (P.w * k) / 2, top: cy - (P.h * k) / 2, width: P.w, height: P.h, transformOrigin: "0 0", transform: `scale(${k.toFixed(5)})`, opacity: interpolate(v, [0, 0.45], [0, 1], clamp) }}>{P.el}</div>
  );
};

/**
 * The six agents and the one gate. The ring is there from the first frame (the camera has just pulled back to it from
 * the gate). As each agent is named its node lights, its line draws to the gate and a pulse runs down it; its picture
 * opens out of the node and folds back before the next. At the end every agent pulses at once, and the ledger chains
 * under the gate: none of them can order past it.
 */
export const Agents = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const dim = SIX.reduce((m, a, i) => {
    const shut = (SIX[i + 1]?.at ?? T.meet) - 8;
    return Math.max(m, interpolate(frame, [a.at, a.at + 12, shut, shut + 12], [0, 1, 1, 0], clamp));
  }, 0);
  const pulses = SIX.reduce((s, a) => s + interpolate(frame, [a.at + 6, a.at + 10, a.at + 30], [0, 1, 0], clamp), 0) + interpolate(frame, [T.meet + 14, T.meet + 18, T.meet + 44], [0, 1, 0], clamp);
  const meet = prog(frame, T.meet, 18);
  const gx = RING_GATE.x - RING_GATE.w / 2;
  const gy = RING_GATE.y - GH / 2;
  const CH = [
    { l: "quote signed", h: "54d70709…159c" },
    { l: "sign-off", h: "ac07f545…fc40" },
    { l: "order placed", h: "5dee283e…eaae" },
  ];
  // The buying agent lights again as the camera pushes into it at the end.
  const toBuyer = interpolate(frame, [durationInFrames - 30, durationInFrames - 12], [0, 1], { ...clamp, easing: EASE_IO });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - 0.62 * dim, filter: dim > 0.02 ? `blur(${(5 * dim).toFixed(2)}px)` : undefined }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {SIX.map((a, k) => {
            const left = a.x < 960;
            const x0 = left ? a.x + AGENT_W : a.x;
            const x1 = left ? gx : gx + RING_GATE.w;
            const y1 = RING_GATE.y - 40 + (a.y - RING_GATE.y) * 0.32;
            const pts = [[x0, a.y], [left ? x0 + 150 : x0 - 150, a.y], [left ? x1 - 150 : x1 + 150, y1], [x1, y1]];
            return (
              <g key={a.name}>
                <path d={`M ${pts[0]} C ${pts[1]}, ${pts[2]}, ${pts[3]}`} fill="none" stroke="rgb(192 224 33 / 0.28)" strokeWidth={2} strokeDasharray="6 10" opacity={prog(frame, T.ghosts + 10 + k * 4, 16)} />
                <Wire pts={pts} at={a.at - 4} dur={14} every={54} offset={k * 9} rest={0.6} />
                {frame >= T.meet + 2 && <Wire pts={pts} at={T.meet + 2} dur={14} rest={0} width={5} />}
              </g>
            );
          })}
          {[0, 1, 2].map((i) => {
            const y0 = gy + GH + 8 + i * 92;
            return frame >= T.meet + 20 + i * 8 ? <Wire key={i} pts={[[960, y0], [960, y0 + 10], [960, y0 + 20], [960, y0 + 30]]} at={T.meet + 20 + i * 8} dur={10} rest={0.8} width={4} /> : null;
          })}
        </svg>
        {SIX.map((a, i) => {
          const lit = prog(frame, a.at - 6, 12);
          const glow = i === 0 ? Math.max(lit, 0.6 + 0.4 * toBuyer) * lit : lit * (1 - 0.35 * toBuyer);
          const g = prog(frame, T.ghosts + i * 4, 16);
          return <AgentNode key={a.name} name={a.name} sub={a.sub} lit={glow} ghost={g} style={{ position: "absolute", left: a.x, top: a.y - NODE_H / 2, scale: String(0.96 + 0.04 * lit) }} />;
        })}
        <div style={{ position: "absolute", left: gx, top: gy }}>
          <TheGate w={RING_GATE.w} lit={20} checks={4} flash={Math.min(1, pulses)} glow={Math.min(1, pulses * 0.6 + meet * 0.25)} />
        </div>
        <div style={{ position: "absolute", left: 960 - 300, width: 600, top: gy + GH + 34, textAlign: "center", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 30, color: C.lime, opacity: prog(frame, T.tech, 16) * (1 - prog(frame, T.meet + 12, 12)), translate: `0px ${(1 - prog(frame, T.tech, 16)) * 16}px` }}>AI SDK · MCP · OpenAPI</div>
        {CH.map((b, i) => {
          const p = prog(frame, T.meet + 26 + i * 8, 16);
          return (
            <div key={b.h} style={{ position: "absolute", left: 960 - 190, top: gy + GH + 38 + i * 92, width: 380, height: 62, boxSizing: "border-box", borderRadius: 16, background: "rgb(255 255 255 / 0.08)", border: `2px solid ${C.lime}`, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", ...sans, opacity: p * (1 - toBuyer), translate: `0px ${(1 - p) * -24}px` }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: C.lime }} />
              <span style={{ fontSize: 24, color: C.paper, flex: 1, whiteSpace: "nowrap" }}>{b.l}</span>
              <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 17, color: "rgb(255 255 255 / 0.62)", whiteSpace: "nowrap" }}>{b.h}</span>
            </div>
          );
        })}
      </div>
      {SIX.map((_, i) => (
        <Opened key={i} i={i} />
      ))}
    </AbsoluteFill>
  );
};
