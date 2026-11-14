import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Aiven } from "./scenes/Aiven";
import { ApprovePage, T as FLOW } from "./scenes/Flow";
import { C, display, sans } from "./theme";
import { PhoneFrame } from "./ui";
import { Block, Card, GateObject, NodeCard, OrderCard, rnd, Space } from "./world";

/** Style frames for "one order, one journey": four stills that show the world before it is animated. */

const N = 17546;
const PICK = (i: number) => i % 351 === 7;
const dot = (i: number) => {
  const d = rnd(i, 2);
  return { x: -60 + rnd(i, 1) * 1500, y: 170 + rnd(i, 3) * 760 + (d - 0.5) * 60, d };
};
const HUB = { x: 1085, y: 520 };

/** Every product as one dot: 17 546 of them, drawn once on a canvas; the recalled fifty pulled toward the hub. */
const Field = ({ pull }: { pull: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 1920, 1080);
    for (let i = 0; i < N; i++) {
      if (PICK(i)) continue;
      const p = dot(i);
      g.fillStyle = `rgba(255,255,255,${0.1 + 0.42 * p.d})`;
      const r = 1 + 2.2 * p.d;
      g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    for (let i = 0; i < N; i++) {
      if (!PICK(i)) continue;
      const p = dot(i);
      const a = rnd(i, 5) * Math.PI * 2;
      const tx = HUB.x + Math.cos(a) * 150 * Math.sqrt(rnd(i, 6));
      const ty = HUB.y + Math.sin(a) * 150 * Math.sqrt(rnd(i, 6));
      const x = p.x + (tx - p.x) * pull;
      const y = p.y + (ty - p.y) * pull;
      const grad = g.createLinearGradient(p.x, p.y, x, y);
      grad.addColorStop(0, "rgba(192,224,33,0)");
      grad.addColorStop(1, "rgba(192,224,33,0.55)");
      g.strokeStyle = grad;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.quadraticCurveTo((p.x + x) / 2, (p.y + y) / 2 - 40, x, y);
      g.stroke();
      g.shadowColor = "rgba(192,224,33,0.9)";
      g.shadowBlur = 16;
      g.fillStyle = C.lime;
      g.beginPath();
      g.arc(x, y, 6.5, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  }, [pull]);
  return <canvas ref={ref} width={1920} height={1080} style={{ position: "absolute", inset: 0 }} />;
};

const Line = ({ children, top = 930 }: { children: string; top?: number }) => <div style={{ position: "absolute", left: 100, top, ...display, fontSize: 84, color: C.paper }}>{children}</div>;

export const StyleSearch = () => (
  <AbsoluteFill>
    <Space>
      <Field pull={0.72} />
      <div style={{ position: "absolute", left: 1286, top: 250, width: 8, height: 560, borderRadius: 4, background: C.safety, boxShadow: "0 0 34px rgb(255 194 14 / 0.8)" }} />
      <div style={{ position: "absolute", left: 1196, top: 196, width: 190, textAlign: "center", ...sans, fontSize: 26, fontWeight: 700, color: C.safety }}>kitchen&apos;s rules</div>
      <div style={{ position: "absolute", inset: 0, perspective: 2200 }}>
        <OrderCard lit={1} tilt={[6, 16]} style={{ position: "absolute", left: 90, top: 96 }} />
        <NodeCard name="Decision model" sub="judges the fifty" lit={1} style={{ position: "absolute", left: 1360, top: 260 }} />
        {[
          { n: "Valio Eila, 1 l", p: "1,01 €/l" },
          { n: "Valio UHT, 1 l", p: "1,56 €/l" },
          { n: "Arla and Valio Eila", p: "2,48 €/l" },
        ].map((x, i) => (
          <Card key={x.n} w={420} lit={i === 0 ? 1 : 0} tilt={[0, -12]} style={{ position: "absolute", left: 1400 + i * 22, top: 470 + i * 132, padding: "18px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ ...display, fontSize: 34 }}>{x.n}</span>
              <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{x.p}</span>
            </div>
            <div style={{ fontSize: 22, color: C.good, fontWeight: 700, marginTop: 4 }}>live price, arrives Monday</div>
          </Card>
        ))}
      </div>
      <div style={{ position: "absolute", left: 100, top: 880, display: "flex", alignItems: "baseline", gap: 24 }}>
        <span style={{ ...display, fontSize: 150, color: C.lime, fontVariantNumeric: "tabular-nums" }}>17 546</span>
        <span style={{ ...display, fontSize: 84, color: C.paper }}>products. Fifty recalled.</span>
      </div>
    </Space>
  </AbsoluteFill>
);

export const StyleGate = () => (
  <AbsoluteFill>
    <Space>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, height: 3, background: "linear-gradient(to right, transparent, rgb(192 224 33 / 0.5) 20%, rgb(192 224 33 / 0.5) 36%, transparent 40%)" }} />
      <div style={{ position: "absolute", inset: 0, perspective: 2400 }}>
        <div style={{ position: "absolute", left: 720, top: 150 }}>
          <GateObject passed={3} failed={3} barrier={1} scale={1.12} />
        </div>
        <OrderCard stop={1} tilt={[4, 14]} style={{ position: "absolute", left: 250, top: 520 }} />
        <div style={{ position: "absolute", left: 250, top: 452, height: 52, padding: "0 22px", borderRadius: 26, background: C.safety, color: C.slab, display: "inline-flex", alignItems: "center", ...sans, fontSize: 26, fontWeight: 800 }}>over the 500 € it may spend alone</div>
        <div style={{ position: "absolute", left: 1290, top: 40, transform: "rotateY(-16deg) rotateX(3deg)", transformOrigin: "0 50%" }}>
          <PhoneFrame scale={1.16}>
            <Sequence from={-(FLOW.tap - 3)}>
              <ApprovePage />
            </Sequence>
          </PhoneFrame>
        </div>
      </div>
      <Line>The gate stops it. A person signs.</Line>
    </Space>
  </AbsoluteFill>
);

const SIX = [
  { name: "Buying agent", sub: "text or hands-free voice", x: 150, y: 190 },
  { name: "Menu planner", sub: "dishes, checked against rules", x: 90, y: 440 },
  { name: "The watch", sub: "sees a stock-out first", x: 150, y: 690 },
  { name: "Selling agent", sub: "signed offers, never a purchase", x: 1380, y: 190 },
  { name: "Any outside agent", sub: "over MCP or REST", x: 1440, y: 440 },
  { name: "Operations copilot", sub: "answers from rows", x: 1380, y: 690 },
];
export const StyleAgents = () => (
  <AbsoluteFill>
    <Space>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {SIX.map((a, i) => {
          const left = a.x < 960;
          const x0 = left ? a.x + 400 : a.x;
          const y0 = a.y + 64;
          const x1 = left ? 800 : 1120;
          const d = `M ${x0} ${y0} C ${left ? x0 + 130 : x0 - 130} ${y0}, ${left ? x1 - 130 : x1 + 130} 520, ${x1} 520`;
          const t = 0.35 + 0.1 * i;
          const u = 1 - t;
          const px = u * u * u * x0 + 3 * u * u * t * (left ? x0 + 130 : x0 - 130) + 3 * u * t * t * (left ? x1 - 130 : x1 + 130) + t * t * t * x1;
          const py = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * 520 + t * t * t * 520;
          return (
            <g key={a.name}>
              <path d={d} fill="none" stroke={C.lime} strokeOpacity={0.55} strokeWidth={3} />
              <circle cx={px} cy={py} r={9} fill={C.lime} />
              <circle cx={px} cy={py} r={20} fill={C.lime} opacity={0.2} />
            </g>
          );
        })}
        <path d="M 960 800 C 960 860, 960 860, 960 900" fill="none" stroke={C.lime} strokeOpacity={0.7} strokeWidth={3} />
      </svg>
      {SIX.map((a) => (
        <NodeCard key={a.name} name={a.name} sub={a.sub} w={400} lit={0.7} style={{ position: "absolute", left: a.x, top: a.y }} />
      ))}
      <div style={{ position: "absolute", left: 960 - 160, top: 230 }}>
        <GateObject passed={4} scale={0.89} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 900, display: "flex", justifyContent: "center", gap: 18 }}>
        {[
          { l: "quote signed", h: "96a5c12f…b17f" },
          { l: "sign-off", h: "469b5e71…0fa3" },
          { l: "order placed", h: "fa63b6cc…535d" },
        ].map((b, i) => (
          <Block key={b.h} label={b.l} hash={b.h} style={{ opacity: 0.55 + 0.225 * i }} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center", ...display, fontSize: 84, color: C.paper }}>Six agents. They only meet at the gate.</div>
    </Space>
  </AbsoluteFill>
);

export const StyleAiven = () => (
  <AbsoluteFill>
    <Sequence from={-598}>
      <Aiven />
    </Sequence>
  </AbsoluteFill>
);
