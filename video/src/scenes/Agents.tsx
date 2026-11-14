import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, EASE, EASE_IO, M, prog, Q, Rise, Wire } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Agent, B, BrowserFrame, Buyer, DishRow, Ground, IconMic, PhoneFrame, Say, ThreadLine } from "../ui";
import { Block, GateObject, NodeCard } from "../world";
import { cue } from "../vo";

const c = (phrase: string) => cue("agents", phrase);
/** The beat at or just before a spoken word: the music's beats fall on frames 6, 24, 42… of this scene. */
const onBeat = (f: number) => 6 + 18 * Math.round((f - 6) / 18);
const T = {
  tech: c("AI SDK") - 6,
  buyer: onBeat(c("the buyer")),
  menu: onBeat(c("a menu planner")),
  watch: onBeat(c("a stock-out watch")),
  seller: onBeat(c("the wholesaler's seller")),
  outside: onBeat(c("any outside agent")),
  ops: onBeat(c("an operations copilot") - 6),
  meet: onBeat(c("None can order")),
};

/** The product's own six (web/src/app/_landing2: "Six agents, one gate"). Voice is how you talk to the first. */
const SIX = [
  { at: T.buyer, name: "The buying agent", short: "Buyer" },
  { at: T.menu, name: "The menu planner", short: "Menu planner" },
  { at: T.watch, name: "The watch", short: "Watch" },
  { at: T.seller, name: "The selling agent", short: "Seller" },
  { at: T.outside, name: "Any outside agent", short: "Outside agent" },
  { at: T.ops, name: "The operations copilot", short: "Ops copilot" },
];
/** One agent's picture: in on its beat with a short travel, out before the next arrives. */
const Stage = ({ i, children, tall = false }: { i: number; children: ReactNode; tall?: boolean }) => {
  const frame = useCurrentFrame();
  const at = SIX[i].at;
  const exit = (SIX[i + 1]?.at ?? T.meet) - Q;
  if (frame < at - 1 || frame > exit + Q) return null;
  const p = prog(frame, at, M);
  const q = interpolate(frame, [exit, exit + Q], [0, 1], { ...clamp, easing: EASE_IO });
  const mask = tall ? "linear-gradient(to bottom, #000 80%, transparent 99%)" : undefined;
  return (
    <div style={{ position: "absolute", left: 80, top: 236, width: 1420, height: 800, display: "flex", alignItems: tall ? "flex-start" : "center", justifyContent: "flex-start", overflow: tall ? "hidden" : "visible", maskImage: mask, WebkitMaskImage: mask, opacity: p * (1 - q), translate: `${(1 - p) * 60 - q * 40}px 0px`, scale: String(0.97 + 0.03 * p), transformOrigin: "0 50%" }}>{children}</div>
  );
};

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

const Phone = ({ src, line }: { src: string; line: string }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 90 }}>
    <PhoneFrame scale={1.5} style={{ marginTop: 6 }}>
      <Img src={staticFile(src)} style={{ width: 390, height: 844 }} />
    </PhoneFrame>
    <div style={{ ...display, fontSize: 92, color: C.paper, width: 640, marginTop: 190, textWrap: "balance" }}>{line}</div>
  </div>
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

/** The whole frame: the gate at the centre, six agents around it, a pulse from each, the ledger chaining below. */
const RING = [
  { name: "Buying agent", sub: "text or hands-free voice", x: 150, y: 150 },
  { name: "Menu planner", sub: "dishes, checked against rules", x: 90, y: 390 },
  { name: "The watch", sub: "sees a stock-out first", x: 150, y: 630 },
  { name: "Selling agent", sub: "signed offers, never a purchase", x: 1370, y: 150 },
  { name: "Any outside agent", sub: "over MCP or REST", x: 1430, y: 390 },
  { name: "Operations copilot", sub: "answers from rows", x: 1370, y: 630 },
];
const CHAIN = [
  { l: "quote signed", h: "96a5c12f…b17f" },
  { l: "sign-off", h: "469b5e71…0fa3" },
  { l: "order placed", h: "fa63b6cc…535d" },
];
const Meet = () => {
  const frame = useCurrentFrame();
  if (frame < T.meet - 1) return null;
  const p = prog(frame, T.meet, M);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: p }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {RING.map((a, k) => {
          const left = a.x < 960;
          const x0 = left ? a.x + 400 : a.x;
          const x1 = left ? 800 : 1120;
          return <Wire key={a.name} at={T.meet + 8 + k * 4} dur={M + 6} every={44} offset={k * 7} pts={[[x0, a.y + 64], [left ? x0 + 130 : x0 - 130, a.y + 64], [left ? x1 - 130 : x1 + 130, 480], [x1, 480]]} rest={0.55} />;
        })}
        <Wire at={T.meet + 40} dur={Q} pts={[[960, 762], [960, 790], [960, 800], [960, 830]]} rest={0.7} />
      </svg>
      {RING.map((a, k) => {
        const q = prog(frame, T.meet + 2 + k * 4, M);
        const left = a.x < 960;
        return <NodeCard key={a.name} name={a.name} sub={a.sub} w={400} lit={0.25 + 0.75 * q} style={{ position: "absolute", left: a.x, top: a.y, opacity: q, translate: `${(1 - q) * (left ? -40 : 40)}px 0px` }} />;
      })}
      <div style={{ position: "absolute", left: 960 - 160, top: 192, scale: String(0.94 + 0.06 * EASE(p)), transformOrigin: "50% 50%" }}>
        <GateObject passed={Math.floor(interpolate(frame, [T.meet + 14, T.meet + 44], [0, 4.99], clamp))} scale={0.89} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 832, display: "flex", justifyContent: "center", gap: 18 }}>
        {CHAIN.map((b, i) => {
          const q = prog(frame, T.meet + 44 + i * 6, M);
          return <Block key={b.h} label={b.l} hash={b.h} style={{ opacity: q, translate: `0px ${(1 - q) * 18}px` }} />;
        })}
      </div>
      <Rise at={T.meet + 10} style={{ position: "absolute", left: 0, right: 0, top: 934, textAlign: "center", ...display, fontSize: 80, color: C.paper }}>
        Six agents. None can order past the gate.
      </Rise>
    </div>
  );
};

export const Agents = () => {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [T.buyer - Q, T.buyer], [1, 0], { ...clamp, easing: EASE_IO });
  const body = 1 - interpolate(frame, [T.meet - Q, T.meet], [0, 1], { ...clamp, easing: EASE_IO });
  const active = SIX.reduce((a, s, i) => (frame >= s.at ? i : a), -1);
  return (
    <AbsoluteFill>
      <Ground>
        {intro > 0 && (
          <div style={{ position: "absolute", inset: 0, opacity: intro, translate: `0px ${(1 - intro) * -30}px` }}>
            <Rise at={8} style={{ position: "absolute", left: 110, top: 300, ...display, fontSize: 190, color: C.paper }}>
              Six agents. One gate.
            </Rise>
            <Rise at={T.tech} style={{ position: "absolute", left: 116, top: 560, ...sans, fontSize: 52, color: C.lime, fontWeight: 600 }}>
              Built on the Vercel AI SDK, MCP and OpenAPI.
            </Rise>
          </div>
        )}

        <div style={{ position: "absolute", inset: 0, opacity: body }}>
          {SIX.map((s, i) => {
            const exit = (SIX[i + 1]?.at ?? T.meet) - Q;
            return (
              <Rise key={s.name} at={s.at} dur={M} y={0} x={40} exit={exit} style={{ position: "absolute", left: 80, top: 70, ...display, fontSize: 116, color: C.paper, whiteSpace: "nowrap" }}>
                {s.name}
              </Rise>
            );
          })}
          <div style={{ position: "absolute", right: 80, top: 96, display: "flex", gap: 14, opacity: prog(frame, T.buyer, M) }}>
            {SIX.map((s, i) => (
              <span key={s.short} style={{ width: i === active ? 54 : 18, height: 18, borderRadius: 9, background: i <= active ? C.lime : "rgb(255 255 255 / 0.25)", opacity: i === active ? 1 : 0.7 }} />
            ))}
          </div>
          <Stage i={0}>
            <Voice />
          </Stage>
          <Stage i={1}>
            <Planner />
          </Stage>
          <Stage i={2} tall>
            <Phone src="shots/agent-watch.webp" line="Sees the stock-out first." />
          </Stage>
          <Stage i={3} tall>
            <Phone src="shots/agent-seller-phone.webp" line="Signed offers. Never a purchase." />
          </Stage>
          <Stage i={4}>
            <Outside />
          </Stage>
          <Stage i={5} tall>
            <BrowserFrame width={1320} height={760} url="aimopilot.zeroanomaly.tech/ops/agents">
              <Img src={staticFile("shots/ops-agents.webp")} style={{ width: 1320 }} />
            </BrowserFrame>
          </Stage>
        </div>
        <Meet />
      </Ground>
    </AbsoluteFill>
  );
};
