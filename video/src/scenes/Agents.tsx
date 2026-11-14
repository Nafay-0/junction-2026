import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, EASE, EASE_IO, M, prog, Q, Rise, Wire } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Agent, B, BrowserFrame, Buyer, DishRow, GateMark, Ground, IconMic, PhoneFrame, Say, ThreadLine } from "../ui";
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

/** The whole frame: six agents, their lines converging on the gate, one order through it, its entry in the ledger. */
const Meet = () => {
  const frame = useCurrentFrame();
  if (frame < T.meet - 1) return null;
  const p = prog(frame, T.meet, M);
  const gate = { x: 790, y: 360, w: 340, h: 300 };
  const through = interpolate(frame, [T.meet + 34, T.meet + 58], [0, 1], { ...clamp, easing: EASE_IO });
  const entry = prog(frame, T.meet + 56, M);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: p }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {SIX.map((s, k) => {
          const y = 196 + k * 116;
          return <Wire key={s.short} at={T.meet + 4 + k * 3} dur={M + 6} pts={[[470, y], [650, y], [640, 510], [gate.x, 510]]} rest={0.6} />;
        })}
        <Wire at={T.meet + 52} dur={Q} pts={[[gate.x + gate.w, 510], [gate.x + gate.w + 80, 510], [1310, 510], [1390, 510]]} rest={0.6} />
      </svg>
      {SIX.map((s, k) => {
        const q = prog(frame, T.meet + k * 3, M);
        return (
          <div key={s.short} style={{ position: "absolute", left: 110, top: 196 + k * 116 - 40, width: 360, height: 80, boxSizing: "border-box", borderRadius: 40, background: "rgb(255 255 255 / 0.09)", border: "2px solid rgb(255 255 255 / 0.24)", color: C.paper, display: "flex", alignItems: "center", padding: "0 30px", ...sans, fontSize: 34, fontWeight: 600, opacity: q, translate: `${(1 - q) * -30}px 0px` }}>{s.short}</div>
        );
      })}
      <div style={{ position: "absolute", left: gate.x, top: gate.y, width: gate.w, height: gate.h, boxSizing: "border-box", borderRadius: 34, background: C.slab, boxShadow: SHADOW.xl, border: `2.5px solid ${C.safety}`, padding: 34, scale: String(0.92 + 0.08 * EASE(p)) }}>
        <GateMark size={72} />
        <div style={{ ...display, fontSize: 68, color: C.safety, marginTop: 20 }}>The gate</div>
        <div style={{ ...sans, fontSize: 28, color: C.chalkSoft, marginTop: 6 }}>plain code, 20 rules</div>
      </div>
      <div style={{ position: "absolute", left: 640 + (1390 - 640) * through, top: 510, translate: "-50% -50%", height: 46, padding: "0 20px", borderRadius: 23, background: C.lime, color: C.ink, display: "flex", alignItems: "center", ...sans, fontSize: 24, fontWeight: 700, opacity: Math.sin(Math.min(1, Math.max(0, through)) * Math.PI) ** 0.3 }}>order</div>
      <div style={{ position: "absolute", left: 1390, top: 430, width: 440, opacity: entry, translate: `${(1 - entry) * 24}px 0px` }}>
        <div style={{ ...sans, fontSize: 28, color: "rgb(255 255 255 / 0.74)", marginBottom: 12 }}>One hash-chained ledger</div>
        <div style={{ ...sans, display: "flex", alignItems: "center", gap: 16, height: 76, padding: "0 24px", borderRadius: 18, background: "rgb(255 255 255 / 0.09)", border: `2px solid ${C.lime}` }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: C.lime }} />
          <span style={{ fontSize: 30, color: C.paper, flex: 1, whiteSpace: "nowrap" }}>order placed</span>
          <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 20, color: "rgb(255 255 255 / 0.66)" }}>fa63b6cc…535d</span>
        </div>
      </div>
      <Rise at={T.meet + 8} style={{ position: "absolute", left: 0, right: 0, top: 880, textAlign: "center", ...display, fontSize: 84, color: C.paper }}>
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
