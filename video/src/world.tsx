import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { C, display, sans, SHADOW } from "./theme";
import { GateMark, IconCheck } from "./ui";

/**
 * The shared kit for "one order, one journey": the things the film's world is made of. Each is a plain component
 * driven by numbers (0 to 1), so a scene animates it with the film's own easing.
 */

/** A deterministic random number in [0, 1) from an index: the same field every render. */
export const rnd = (i: number, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Deep petrol space with a little depth fog. */
export const Space = ({ children, tone = "petrol" }: { children: ReactNode; tone?: "petrol" | "floor" }) => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: tone === "petrol" ? `radial-gradient(90% 70% at 50% 42%, #0a586e 0%, ${C.petrolDeep} 48%, #01212b 100%)` : `radial-gradient(100% 80% at 50% 30%, #073f50 0%, #012733 55%, #00161d 100%)` }}>
    {children}
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgb(0 12 16 / 0.55) 100%)", pointerEvents: "none" }} />
  </div>
);

/** The card: paper, soft shadow, a lit lime edge when live, amber when stopped. Tilts in space. */
export const Card = ({ children, w, h, lit = 0, stop = 0, tilt = [0, 0], style }: { children: ReactNode; w: number; h?: number; lit?: number; stop?: number; tilt?: [number, number]; style?: CSSProperties }) => (
  <div style={{ width: w, height: h, boxSizing: "border-box", borderRadius: 26, background: C.paper, padding: "22px 26px", ...sans, color: C.ink, boxShadow: `${SHADOW.xl}, 0 0 0 ${3 * Math.max(lit, stop)}px ${stop > lit ? C.safety : C.lime}, 0 0 ${60 * Math.max(lit, stop)}px -6px ${stop > lit ? "rgb(255 194 14 / 0.7)" : "rgb(192 224 33 / 0.7)"}`, transform: `rotateX(${tilt[0]}deg) rotateY(${tilt[1]}deg)`, ...style }}>{children}</div>
);

/** The order as a card: what, how much, its total. */
export const OrderCard = ({ lit = 0, stop = 0, tilt, style }: { lit?: number; stop?: number; tilt?: [number, number]; style?: CSSProperties }) => (
  <Card w={400} lit={lit} stop={stop} tilt={tilt} style={style}>
    <div style={{ fontSize: 22, color: C.inkSoft }}>Order, Hotel Lumo kitchen</div>
    <div style={{ ...display, fontSize: 56, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>1 010,00 €</div>
    <div style={{ fontSize: 24, color: C.inkSoft, marginTop: 6 }}>1 000 × lactose-free milk, 1 l</div>
  </Card>
);

/** The gate: four checks that light one by one, and a hazard-striped barrier that comes down on a stop. */
export const CHECKS = ["Mandate", "Signed price", "Rules", "Limit"];
export const GateObject = ({ passed = 0, failed = -1, barrier = 0, scale = 1 }: { passed?: number; failed?: number; barrier?: number; scale?: number }) => (
  <div style={{ width: 360 * scale, height: 640 * scale }}>
    <div style={{ width: 360, height: 640, scale: String(scale), transformOrigin: "0 0", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 44, background: C.slab, border: `3px solid ${failed >= 0 ? C.safety : "rgb(255 255 255 / 0.22)"}`, boxShadow: `${SHADOW.xl}, 0 0 ${failed >= 0 ? 90 : 0}px -10px rgb(255 194 14 / 0.8)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <GateMark size={96} />
        <div style={{ ...display, fontSize: 44, color: C.paper, marginTop: 14 }}>The gate</div>
        <div style={{ ...sans, fontSize: 24, color: C.chalkSoft, marginTop: 2 }}>plain code, 20 rules</div>
      </div>
      <div style={{ position: "absolute", left: 34, right: 34, top: 262 }}>
        {CHECKS.map((name, i) => {
          const ok = i < passed;
          const no = i === failed;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 18, height: 64, borderTop: i ? "1px solid rgb(255 255 255 / 0.1)" : "none", ...sans, fontSize: 30, color: ok || no ? C.paper : "rgb(255 255 255 / 0.45)" }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: no ? C.safety : ok ? C.lime : "rgb(255 255 255 / 0.14)", boxShadow: no ? "0 0 22px rgb(255 194 14 / 0.9)" : ok ? "0 0 22px rgb(192 224 33 / 0.8)" : "none", display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 24, color: C.slab }}>{ok ? <IconCheck size={22} color={C.slab} /> : no ? "!" : null}</span>
              {name}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: -70, right: -70, top: 548 - 300 * (1 - barrier), height: 46, borderRadius: 12, background: `repeating-linear-gradient(135deg, ${C.safety} 0 26px, ${C.slab} 26px 52px)`, opacity: barrier, boxShadow: "0 16px 30px -10px rgb(0 0 0 / 0.6)" }} />
    </div>
  </div>
);

/** A node in a workflow diagram: an agent, a service, a model. */
export const NodeCard = ({ name, sub, w = 330, lit = 0, style, children }: { name: string; sub?: string; w?: number; lit?: number; style?: CSSProperties; children?: ReactNode }) => (
  <div style={{ width: w, boxSizing: "border-box", borderRadius: 26, padding: "20px 24px", background: `rgb(255 255 255 / ${0.06 + 0.07 * lit})`, border: `2.5px solid rgb(192 224 33 / ${0.2 + 0.8 * lit})`, boxShadow: `0 20px 50px -24px rgb(0 0 0 / 0.7), 0 0 ${50 * lit}px -12px rgb(192 224 33 / ${0.7 * lit})`, backdropFilter: "blur(6px)", ...style }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {children}
      <div style={{ ...display, fontSize: 38, color: C.paper, whiteSpace: "nowrap" }}>{name}</div>
    </div>
    {sub && <div style={{ ...sans, fontSize: 24, color: "rgb(255 255 255 / 0.76)", marginTop: 6, whiteSpace: "nowrap" }}>{sub}</div>}
  </div>
);

/** A ledger block: what happened and the hash it carries. Blocks chain. */
export const Block = ({ label, hash, ok = true, style }: { label: string; hash: string; ok?: boolean; style?: CSSProperties }) => (
  <div style={{ width: 380, height: 70, boxSizing: "border-box", borderRadius: 16, background: "rgb(255 255 255 / 0.08)", border: `2px solid ${ok ? C.lime : C.safety}`, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", ...sans, ...style }}>
    <span style={{ width: 14, height: 14, borderRadius: "50%", background: ok ? C.lime : C.safety }} />
    <span style={{ fontSize: 24, color: C.paper, flex: 1, whiteSpace: "nowrap" }}>{label}</span>
    <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 17, color: "rgb(255 255 255 / 0.62)", whiteSpace: "nowrap" }}>{hash}</span>
  </div>
);

/**
 * The catalogue as a material: 17 546 round, soft dots in three depth layers, one per product, drawn on a canvas.
 * `pull` moves the recalled fifty toward the hub along curved paths with a glowing strand each; `rules` dims the
 * products the kitchen's rules exclude and lets them fall away.
 */
export const FIELD_N = 17546;
const picked = (i: number) => i % 351 === 7;
export const Field = ({ appear = 1, pull = 0, rules = 0, pulse = 0, top = 170, height = 760, hub = [1085, 520] }: { appear?: number; pull?: number; rules?: number; pulse?: number; top?: number; height?: number; hub?: [number, number] }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 1920, 1080);
    for (let i = 0; i < FIELD_N; i++) {
      if (picked(i)) continue;
      const d = rnd(i, 2);
      const fails = rnd(i, 7) < 0.42;
      const x = -60 + rnd(i, 1) * 1500;
      const y = top + rnd(i, 3) * height + (d - 0.5) * 60 + (fails ? 90 * rules * rules : 0);
      const r = d < 0.4 ? 1.2 : d < 0.75 ? 1.9 : 2.9;
      const a = (d < 0.4 ? 0.16 : d < 0.75 ? 0.3 : 0.5) * appear * (fails ? 1 - 0.88 * rules : 1) * (0.7 + 0.3 * Math.min(1, Math.max(0, appear * 2 - rnd(i, 4))));
      if (a < 0.01) continue;
      g.fillStyle = `rgba(226,238,241,${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
    let k = 0;
    for (let i = 0; i < FIELD_N; i++) {
      if (!picked(i)) continue;
      const d = rnd(i, 2);
      const hx = -60 + rnd(i, 1) * 1500;
      const hy = top + rnd(i, 3) * height + (d - 0.5) * 60;
      const ang = rnd(i, 5) * 6.2832;
      const rad = 150 * Math.sqrt(rnd(i, 6));
      const tx = hub[0] + Math.cos(ang) * rad;
      const ty = hub[1] + Math.sin(ang) * rad;
      const t = Math.min(1, Math.max(0, pull * 1.5 - (k++ / 50) * 0.5));
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const cx = (hx + tx) / 2;
      const cy = (hy + ty) / 2 - 70;
      const u = 1 - e;
      const x = u * u * hx + 2 * u * e * cx + e * e * tx;
      const y = u * u * hy + 2 * u * e * cy + e * e * ty;
      if (e > 0.01) {
        const grad = g.createLinearGradient(hx, hy, x, y);
        grad.addColorStop(0, "rgba(192,224,33,0)");
        grad.addColorStop(1, `rgba(192,224,33,${0.5 * appear})`);
        g.strokeStyle = grad;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(hx, hy);
        g.quadraticCurveTo(hx + (cx - hx) * e, hy + (cy - hy) * e, x, y);
        g.stroke();
      }
      g.shadowColor = "rgba(192,224,33,0.9)";
      g.shadowBlur = 8 + 12 * e + 14 * pulse;
      g.fillStyle = e > 0.02 ? `rgba(192,224,33,${appear})` : `rgba(226,238,241,${0.5 * appear})`;
      g.beginPath();
      g.arc(x, y, 3 + 3.5 * e + 1.5 * pulse, 0, 6.2832);
      g.fill();
      g.shadowBlur = 0;
    }
  }, [appear, pull, rules, pulse, top, height, hub]);
  return <canvas ref={ref} width={1920} height={1080} style={{ position: "absolute", inset: 0 }} />;
};

/**
 * The gate, large: the object the film keeps coming back to. A slab with the twenty rules as a ring of lights around
 * its mark, the four checks every order passes, and a hazard barrier that drops when something is refused. Drawn at
 * 400 × 700 and scaled to `w`; every state is a number so scenes animate it with the film's easing.
 * - lit: how many of the twenty rule lights are on (fractional: the next one is fading in).
 * - checks: how many of the four checks have passed (fractional likewise); fail: the check that just failed.
 * - barrier: 0 up, 1 down. glow: the lime aura of a pass. knock: the amber flash of a refusal.
 */
export const GATE_W = 400;
export const GATE_H = 700;
const LIGHT = (on: number, flash: number) => {
  const a = Math.min(1, on + flash);
  return { background: `rgb(${Math.round(255 + (192 - 255) * a)} ${Math.round(255 + (224 - 255) * a)} ${Math.round(255 + (33 - 255) * a)} / ${0.18 + 0.82 * a})`, boxShadow: a > 0.05 ? `0 0 ${14 * a}px rgb(192 224 33 / ${0.8 * a})` : "none" };
};
export const TheGate = ({ w = GATE_W, lit = 0, checks = 0, fail = -1, barrier = 0, glow = 0, knock = 0, flash = 0, label = true }: { w?: number; lit?: number; checks?: number; fail?: number; barrier?: number; glow?: number; knock?: number; flash?: number; label?: boolean }) => {
  const k = w / GATE_W;
  return (
    <div style={{ width: w, height: GATE_H * k, position: "relative" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: GATE_W, height: GATE_H, transformOrigin: "0 0", transform: `scale(${k})` }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 48, background: `linear-gradient(180deg, #232a31 0%, ${C.slab} 60%)`, border: `3px solid ${knock > 0.02 ? `rgb(255 194 14 / ${0.4 + 0.6 * knock})` : `rgb(${Math.round(255 - 63 * glow)} ${Math.round(255 - 31 * glow)} ${Math.round(255 - 222 * glow)} / ${0.2 + 0.7 * glow})`}`, boxShadow: `${SHADOW.xl}, 0 0 ${110 * Math.max(glow, knock)}px -14px ${knock > glow ? "rgb(255 194 14 / 0.85)" : "rgb(192 224 33 / 0.75)"}` }} />
        <div style={{ position: "absolute", left: 70, top: 34, width: 260, height: 260 }}>
          {Array.from({ length: 20 }, (_, i) => {
            const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
            const on = Math.max(0, Math.min(1, lit - i));
            return <span key={i} style={{ position: "absolute", left: 130 + Math.cos(a) * 116 - 5, top: 130 + Math.sin(a) * 116 - 14, width: 10, height: 28, borderRadius: 5, rotate: `${(a * 180) / Math.PI + 90}deg`, ...LIGHT(on, flash) }} />;
          })}
          <div style={{ position: "absolute", left: 66, top: 66 }}>
            <GateMark size={128} />
          </div>
        </div>
        {label && (
          <div style={{ position: "absolute", left: 0, right: 0, top: 304, textAlign: "center" }}>
            <div style={{ ...display, fontSize: 46, color: C.paper }}>The gate</div>
            <div style={{ ...sans, fontSize: 23, color: C.chalkSoft, marginTop: 4 }}>plain code, 20 rules</div>
          </div>
        )}
        <div style={{ position: "absolute", left: 44, right: 44, top: 404 }}>
          {CHECKS.map((name, i) => {
            const on = Math.max(0, Math.min(1, checks - i));
            const no = i === fail;
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 18, height: 58, borderTop: i ? "1px solid rgb(255 255 255 / 0.09)" : "none", ...sans, fontSize: 28, color: `rgb(255 255 255 / ${no ? 1 : 0.45 + 0.55 * on})` }}>
                <span style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", background: no ? C.safety : "rgb(255 255 255 / 0.13)", boxShadow: no ? "0 0 22px rgb(255 194 14 / 0.9)" : "none", display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 24, color: C.slab }}>
                  {!no && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: C.lime, scale: String(0.4 + 0.6 * on), opacity: on, boxShadow: `0 0 ${22 * on}px rgb(192 224 33 / 0.8)` }} />}
                  {no ? "!" : on > 0.5 ? <IconCheck size={22} color={C.slab} style={{ position: "relative", opacity: (on - 0.5) * 2 }} /> : null}
                </span>
                {name}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: -64, right: -64, top: 640 - 260 * (1 - barrier), height: 44, borderRadius: 12, background: `repeating-linear-gradient(135deg, ${C.safety} 0 26px, ${C.slab} 26px 52px)`, opacity: Math.min(1, barrier * 1.6), boxShadow: "0 16px 30px -10px rgb(0 0 0 / 0.6)" }} />
      </div>
    </div>
  );
};

/** An agent in the ring: its lamp, its name, what it is for. `lit` 0 is a ghost slot, 1 a live agent. */
export const AGENT_W = 400;
export const AgentNode = ({ name, sub, lit = 1, ghost = 0, w = AGENT_W, style }: { name: string; sub: string; lit?: number; ghost?: number; w?: number; style?: CSSProperties }) => {
  const k = w / AGENT_W;
  return (
    <div style={{ width: w, height: 118 * k, ...style }}>
      <div style={{ width: AGENT_W, height: 118, transformOrigin: "0 0", transform: `scale(${k})`, boxSizing: "border-box", borderRadius: 26, padding: "20px 24px", background: `rgb(255 255 255 / ${0.05 * ghost + 0.08 * lit})`, border: `2.5px ${lit > 0.02 ? "solid" : "dashed"} rgb(192 224 33 / ${0.4 * ghost * (1 - lit) + lit})`, opacity: Math.max(ghost, lit), boxShadow: lit > 0.02 ? `0 20px 50px -24px rgb(0 0 0 / 0.7), 0 0 ${56 * lit}px -12px rgb(192 224 33 / ${0.7 * lit})` : "none", display: "flex", alignItems: "center", gap: 18 }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: lit > 0.02 ? C.lime : "rgb(255 255 255 / 0.2)", opacity: Math.max(ghost * 0.5, lit), boxShadow: `0 0 ${18 * lit}px rgb(192 224 33 / 0.9)` }} />
        <div style={{ opacity: lit, minWidth: 0 }}>
          <div style={{ ...display, fontSize: 38, color: C.paper, whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ ...sans, fontSize: 23, color: "rgb(255 255 255 / 0.74)", marginTop: 3, whiteSpace: "nowrap" }}>{sub}</div>
        </div>
      </div>
    </div>
  );
};
