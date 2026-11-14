import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, EASE_IO, M, prog, Q, Rise, Wire } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { GateMark, Ground, IconCheck } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("gate", phrase, shift);
const T = {
  order: c("Twenty rules", -8),
  rules: c("rules"),
  rulesEnd: c("order", 6),
  pass: c("order", 10),
  attacks: [c("forged", -10), c("replayed", -10), c("an agent approving", -10)],
  tally: c("All stopped", -2),
  chain: c("tamper-evident", -14),
};
/** Three of the seven recorded attempts (web/src/server/show/recordings/attacks.json); all seven were stopped. */
const ATTACKS = ["Forged mandate", "Replayed quote", "Self-approval"];
/** A real SHA-256 chain over these labels: each block carries the hash of the one before. */
const BLOCKS = [
  { at: T.pass + M, label: "order placed", hash: "fa63b6cc…535d", ok: true },
  { at: T.attacks[0] + 30, label: "refused", hash: "8259a448…7281", ok: false },
  { at: T.attacks[1] + 30, label: "refused", hash: "96a5c12f…b17f", ok: false },
  { at: T.attacks[2] + 30, label: "refused", hash: "4448bec4…bc69", ok: false },
];
const GATE = { x: 800, y: 230, w: 320, h: 620 };
const LANE = 540;
const CARD = { w: 380, h: 200 };

const OrderCard = ({ title, big, sub, bad = false }: { title: string; big: string; sub: string; bad?: boolean }) => (
  <div style={{ width: CARD.w, height: CARD.h, boxSizing: "border-box", borderRadius: 26, background: C.paper, boxShadow: SHADOW.xl, borderTop: `8px solid ${bad ? C.bad : C.lime}`, padding: "20px 26px", ...sans }}>
    <div style={{ fontSize: 24, color: C.inkSoft }}>{title}</div>
    <div style={{ ...display, fontSize: 52, color: C.ink, marginTop: 6, whiteSpace: "nowrap" }}>{big}</div>
    <div style={{ fontSize: 24, color: C.inkSoft, marginTop: 6, whiteSpace: "nowrap" }}>{sub}</div>
  </div>
);

/** An attempt: flies in, hits the gate, is stamped, and falls back. */
const Attack = ({ at, name }: { at: number; name: string }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > at + 70) return null;
  const inP = interpolate(frame, [at, at + M], [0, 1], { ...clamp, easing: EASE });
  const hit = at + M;
  const back = interpolate(frame, [hit + 8, hit + 8 + 30], [0, 1], { ...clamp, easing: EASE_IO });
  const stamp = prog(frame, hit, Q);
  const x = -420 + (GATE.x - CARD.w - 14 + 420) * inP - 300 * back;
  return (
    <div style={{ position: "absolute", left: x, top: LANE - CARD.h / 2 + 120 * back, rotate: `${-9 * back}deg`, opacity: 1 - back }}>
      <OrderCard title="Attempt" big={name} sub="tries to get past" bad />
      <div style={{ position: "absolute", right: -16, top: -22, height: 62, padding: "0 26px", borderRadius: 31, background: C.safety, color: C.slab, display: "flex", alignItems: "center", ...sans, fontSize: 32, fontWeight: 800, rotate: "6deg", opacity: stamp, scale: String(1.5 - 0.5 * stamp), boxShadow: SHADOW.md }}>Refused</div>
    </div>
  );
};

/** The gate as a world: a signed order passes its twenty rules and becomes a ledger block; attempts bounce off. */
export const Gate = () => {
  const frame = useCurrentFrame();
  const gate = prog(frame, 6, M);
  const inP = interpolate(frame, [T.order, T.order + 30], [0, 1], { ...clamp, easing: EASE });
  const pass = interpolate(frame, [T.pass, T.pass + M], [0, 1], { ...clamp, easing: EASE_IO });
  const lit = interpolate(frame, [T.rules, T.rulesEnd], [0, 20], clamp);
  const knock = T.attacks.reduce((s, at) => s + interpolate(frame, [at + M - 2, at + M + 2, at + M + 14], [0, 1, 0], clamp), 0);
  const cx = GATE.x + GATE.w / 2;
  return (
    <AbsoluteFill>
      <Ground tone="slab">
        <Rise at={6} style={{ position: "absolute", left: 100, top: 72, ...display, fontSize: 104, color: C.paper }}>
          The model is never trusted.
        </Rise>

        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <Wire at={T.pass + 4} dur={M} pts={[[GATE.x + GATE.w, LANE], [1240, LANE], [1220, 292], [1330, 292]]} rest={0.5} />
          {BLOCKS.slice(1).map((b, i) => (
            <Wire key={b.hash} at={Math.max(b.at, T.chain + i * 6)} dur={Q} pts={[[1380, 334 + i * 126], [1380, 350 + i * 126], [1380, 360 + i * 126], [1380, 376 + i * 126]]} width={4} rest={0.9} />
          ))}
        </svg>

        <div style={{ position: "absolute", left: GATE.x + 6 * knock, top: GATE.y, width: GATE.w, height: GATE.h, boxSizing: "border-box", borderRadius: 40, overflow: "hidden", background: C.slab, border: `3px solid ${C.safety}`, boxShadow: `${SHADOW.xl}, 0 0 ${70 * knock}px -6px rgb(255 194 14 / ${0.7 * knock})`, opacity: gate, scale: String(0.94 + 0.06 * gate) }}>
          <div style={{ height: 22, background: `repeating-linear-gradient(135deg, ${C.safety} 0 22px, ${C.slab} 22px 44px)` }} />
          <div style={{ position: "relative", width: 260, height: 260, margin: "62px auto 0" }}>
            {Array.from({ length: 20 }, (_, i) => {
              const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
              const on = interpolate(lit, [i, i + 1], [0, 1], clamp);
              return <span key={i} style={{ position: "absolute", left: 130 + Math.cos(a) * 118 - 5, top: 130 + Math.sin(a) * 118 - 13, width: 10, height: 26, borderRadius: 5, rotate: `${(a * 180) / Math.PI + 90}deg`, background: on > 0.5 ? C.lime : "rgb(255 255 255 / 0.2)", boxShadow: on > 0.5 ? "0 0 14px rgb(192 224 33 / 0.8)" : "none" }} />;
            })}
            <div style={{ position: "absolute", left: 60, top: 60 }}>
              <GateMark size={140} />
            </div>
          </div>
          <div style={{ ...display, fontSize: 64, color: C.safety, textAlign: "center", marginTop: 34 }}>20 rules</div>
          <div style={{ ...sans, fontSize: 30, color: C.chalkSoft, textAlign: "center", marginTop: 6 }}>plain code</div>
        </div>

        {frame >= T.order && pass < 1 && (
          <div style={{ position: "absolute", left: -420 + (GATE.x - CARD.w - 14 + 420) * inP + (cx - GATE.x + 40) * pass, top: LANE - CARD.h / 2, opacity: 1 - pass, scale: String(1 - 0.5 * pass) }}>
            <OrderCard title="Order" big="1 010,00 €" sub="signed mandate, signed quote" />
          </div>
        )}
        {T.attacks.map((at, i) => (
          <Attack key={at} at={at} name={ATTACKS[i]} />
        ))}

        <Rise at={T.pass + M - 4} dur={Q} y={0} style={{ position: "absolute", left: 1330, top: 196, ...sans, fontSize: 30, color: "rgb(255 255 255 / 0.74)" }}>
          One hash-chained ledger
        </Rise>
        {BLOCKS.map((b, i) => {
          const p = prog(frame, b.at, M);
          const linked = prog(frame, T.chain + i * 6, Q);
          return (
            <div key={b.hash} style={{ position: "absolute", left: 1330, top: 250 + i * 126, width: 500, height: 84, boxSizing: "border-box", borderRadius: 20, background: "rgb(255 255 255 / 0.08)", border: `2.5px solid ${b.ok ? C.lime : `rgb(255 194 14 / ${0.5 + 0.5 * linked})`}`, display: "flex", alignItems: "center", gap: 18, padding: "0 24px", ...sans, opacity: p, translate: `${(1 - p) * 40}px 0px` }}>
              <span style={{ width: 40, height: 40, borderRadius: "50%", background: b.ok ? C.lime : C.safety, display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 26, color: C.slab }}>{b.ok ? <IconCheck size={24} color={C.slab} /> : "×"}</span>
              <span style={{ fontSize: 32, color: C.paper, flex: 1 }}>{b.label}</span>
              <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 23, color: "rgb(255 255 255 / 0.66)", opacity: 0.4 + 0.6 * linked }}>{b.hash}</span>
            </div>
          );
        })}

        <Rise at={T.tally} style={{ position: "absolute", left: 100, top: 880, ...display, fontSize: 112, color: C.lime, whiteSpace: "nowrap" }}>
          7 of 7 attempts stopped.
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
