import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, EASE, EASE_IO, prog } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { IconCheck } from "../ui";
import { cue } from "../vo";
import { TheGate } from "../world";

const c = (phrase: string, shift = 0) => cue("gate", phrase, shift);

/** Where the gate stands in this scene, and how far the scene's camera has pushed in by its end (for the move out). */
export const GATE_SCENE = { x: 900, y: 540, w: 440, push: 0.035 };
const GW = GATE_SCENE.w;
const GH = (GW * 700) / 400;
const GL = GATE_SCENE.x - GW / 2;
const GT = GATE_SCENE.y - GH / 2;
const LANE = 560;
const CW = 400;
const CH = 196;
const DOCK = GL - 30 - CW;

/**
 * The ledger: one hash-chained column, each block carrying the SHA-256 of the one before and its own label (computed,
 * not invented). Two blocks of this order's earlier steps are already there; the order and the refusals join them.
 */
const CHAIN = [
  { label: "quote signed", hash: "54d70709…159c", ok: true },
  { label: "sign-off", hash: "ac07f545…fc40", ok: true },
  { label: "order placed", hash: "5dee283e…eaae", ok: true },
  { label: "mandate_signature", hash: "799afec0…bb62", ok: false },
  { label: "quote_replay", hash: "6041a7fd…7dd1", ok: false },
  { label: "approver_identity", hash: "c01340eb…6774", ok: false },
];
const BX = 1262;
const BW = 540;
const BH = 76;
const BSTEP = 112;
const BTOP = GATE_SCENE.y - (CHAIN.length * BSTEP - (BSTEP - BH)) / 2;
const by = (i: number) => BTOP + i * BSTEP;

/** Three of the seven recorded attempts (web/src/server/show/recordings/attacks.json), each with the check it fails. */
const ATTEMPTS = [
  { word: "forged", name: "Forged mandate", code: "mandate_signature", fails: 0, dy: -46, tilt: -5 },
  { word: "replayed", name: "Replayed quote", code: "quote_replay", fails: 1, dy: 34, tilt: 4 },
  { word: "approving", name: "Self-approval", code: "approver_identity", fails: 2, dy: -12, tilt: -3 },
];

const useT = () => {
  const P = c("order", 8);
  return {
    dock: c("never", 6),
    ring: [c("Twenty", -4), c("code", 8)] as const,
    checks: [c("check"), c("order", 8)] as const,
    pass: P,
    block: P + 24,
    hits: ATTEMPTS.map((a) => c(a.word, 6)),
    tally: c("All stopped"),
    chain: c("tamper-evident"),
  };
};

const Order = ({ k }: { k: number }) => (
  <div style={{ position: "absolute", inset: 0, padding: "22px 28px", ...sans, opacity: 1 - k }}>
    <div style={{ fontSize: 22, color: C.inkSoft }}>Order, Hotel Lumo kitchen</div>
    <div style={{ ...display, fontSize: 60, marginTop: 6, color: C.ink, fontVariantNumeric: "tabular-nums" }}>1 010,00 €</div>
    <div style={{ fontSize: 24, color: C.inkSoft, marginTop: 6 }}>1 000 × lactose-free milk, 1 l</div>
  </div>
);

const BlockFace = ({ b, k = 1, live = 0 }: { b: (typeof CHAIN)[number]; k?: number; live?: number }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 16, padding: "0 22px", ...sans, opacity: k }}>
    <span style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: b.ok ? C.lime : C.safety, display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 24, color: C.slab }}>{b.ok ? <IconCheck size={22} color={C.slab} /> : "×"}</span>
    <span style={{ fontSize: b.ok ? 29 : 25, color: C.paper, flex: 1, whiteSpace: "nowrap", fontFamily: b.ok ? undefined : 'ui-monospace, "SF Mono", Menlo, monospace' }}>{b.label}</span>
    <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 20, whiteSpace: "nowrap", color: `rgb(255 255 255 / ${0.5 + 0.5 * live})` }}>{b.hash}</span>
  </div>
);
const blockBox = (ok: boolean, live: number) => ({ borderRadius: 18, background: `rgb(255 255 255 / ${0.07 + 0.06 * live})`, border: `2.5px solid ${ok ? C.lime : C.safety}`, boxShadow: `0 0 ${40 * live}px -8px ${ok ? "rgb(192 224 33 / 0.8)" : "rgb(255 194 14 / 0.8)"}` });

/** An attempt: flies at the gate, is refused with the rule that caught it, and is thrown back out of the frame. */
const Attempt = ({ a, hit }: { a: (typeof ATTEMPTS)[number]; hit: number }) => {
  const frame = useCurrentFrame();
  const t0 = hit - 16;
  if (frame < t0 || frame > hit + 44) return null;
  const inP = interpolate(frame, [t0, hit], [0, 1], { ...clamp, easing: (x) => x * x * (3 - 2 * x) * 0.4 + x * x * 0.6 });
  const u = interpolate(frame, [hit + 5, hit + 44], [0, 1], clamp);
  const x = -460 + (DOCK + 460) * inP - 520 * EASE(u);
  const y = LANE - CH / 2 + a.dy + 330 * u * u;
  const stamp = prog(frame, hit, 9);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: CW, height: CH, rotate: `${a.tilt * (1 - inP) - 16 * EASE(u)}deg`, opacity: 1 - interpolate(u, [0.45, 1], [0, 1], clamp) }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 26, background: C.paper, boxShadow: `${SHADOW.xl}, 0 0 0 ${3 * stamp}px ${C.safety}`, borderTop: `8px solid ${C.bad}`, padding: "18px 26px", boxSizing: "border-box", ...sans }}>
        <div style={{ fontSize: 22, color: C.inkSoft }}>Attempt</div>
        <div style={{ ...display, fontSize: 52, color: C.ink, marginTop: 4, whiteSpace: "nowrap" }}>{a.name}</div>
        <div style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 21, color: C.bad, marginTop: 8, opacity: stamp }}>{a.code}</div>
      </div>
      <div style={{ position: "absolute", right: -22, top: -26, height: 64, padding: "0 28px", borderRadius: 32, background: C.safety, color: C.slab, display: "flex", alignItems: "center", ...sans, fontSize: 32, fontWeight: 800, rotate: "7deg", opacity: stamp, scale: String(1.45 - 0.45 * stamp), boxShadow: SHADOW.md }}>Refused</div>
    </div>
  );
};

/**
 * The gate at full scale. The signed order docks against it; the twenty rule lights come on around its mark; its four
 * checks tick; the order passes through and folds into a block on the hash-chained ledger. Three recorded attempts
 * fly at it and are thrown back, each refusal a block of its own. At the end only the gate is left, for the camera
 * to pull back to the six agents around it.
 */
export const Gate = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const T = useT();
  const dock = interpolate(frame, [0, T.dock], [0, 1], { ...clamp, easing: EASE });
  const lit = interpolate(frame, T.ring, [0, 20], { ...clamp, easing: EASE_IO });
  const checks = interpolate(frame, T.checks, [0, 4], clamp);
  const pass = interpolate(frame, [T.pass, T.pass + 26], [0, 1], { ...clamp, easing: EASE_IO });
  const fold = interpolate(frame, [T.block - 6, T.block + 18], [0, 1], { ...clamp, easing: EASE_IO });
  const glow = interpolate(frame, [T.checks[1] - 4, T.checks[1] + 4, T.pass + 30], [0, 1, 0], clamp);
  const knock = T.hits.reduce((s, h) => s + interpolate(frame, [h - 1, h + 1, h + 22], [0, 1, 0], clamp), 0);
  const barrier = T.hits.reduce((s, h) => s + interpolate(frame, [h - 2, h + 4, h + 26, h + 38], [0, 1, 1, 0], { ...clamp, easing: EASE_IO }), 0);
  const failing = T.hits.findIndex((h) => frame >= h && frame < h + 30);
  const shake = T.hits.reduce((s, h) => s + (frame >= h && frame < h + 14 ? Math.sin((frame - h) * 2.4) * 7 * (1 - (frame - h) / 14) : 0), 0);
  const end = interpolate(frame, [durationInFrames - 46, durationInFrames - 26], [1, 0], { ...clamp, easing: EASE_IO });
  const tamper = frame - T.chain;
  const cam = 1 + GATE_SCENE.push * EASE_IO(frame / durationInFrames);

  // The order card: docks, slides behind the gate and out of its far side, then folds into the third block.
  const card = (() => {
    const x0 = DOCK - 260 * (1 - dock);
    const xs = x0 + (BX - 20 - x0) * pass;
    const r = {
      x: xs + (BX - xs) * fold,
      y: LANE - CH / 2 + (by(2) - (LANE - CH / 2)) * fold,
      w: CW + (BW - CW) * fold,
      h: CH + (BH - CH) * fold,
    };
    return r;
  })();
  const blockAt = (i: number) => (i < 2 ? 0 : i === 2 ? T.block + 12 : T.hits[i - 3] + 10);
  const live = (i: number) => interpolate(tamper, [i * 5, i * 5 + 6, i * 5 + 22], [0, 1, 0.25], clamp) * (frame >= T.chain ? 1 : 0);

  return (
    <AbsoluteFill style={{ transformOrigin: `${GATE_SCENE.x}px ${GATE_SCENE.y}px`, transform: `scale(${cam.toFixed(5)})` }}>
      {/* the lane the order arrives on, drawn faint across the floor */}
      <div style={{ position: "absolute", left: -100, width: GL + 140, top: LANE + CH / 2 + 26, height: 2, background: "linear-gradient(90deg, transparent, rgb(192 224 33 / 0.3))", opacity: end }} />

      {/* the ledger column and its links */}
      <div style={{ opacity: end }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {CHAIN.slice(1).map((b, j) => {
            const i = j + 1;
            const at = blockAt(i);
            const p = prog(frame, at + 4, 12);
            const y0 = by(i - 1) + BH;
            const y1 = by(i);
            const hot = live(i);
            return p > 0 ? <line key={b.hash} x1={BX + 40} x2={BX + 40} y1={y0} y2={y0 + (y1 - y0) * p} stroke={hot > 0.3 ? C.lime : b.ok ? C.lime : C.safety} strokeOpacity={0.55 + 0.45 * hot} strokeWidth={4 + 3 * hot} strokeLinecap="round" /> : null;
          })}
        </svg>
        {CHAIN.map((b, i) => {
          if (i === 2) return null;
          const at = blockAt(i);
          const p = i < 2 ? prog(frame, 4 + i * 4, 18) : prog(frame, at, 16);
          if (p <= 0) return null;
          return (
            <div key={b.hash} style={{ position: "absolute", left: BX, top: by(i), width: BW, height: BH, boxSizing: "border-box", ...blockBox(b.ok, live(i)), opacity: (i < 2 ? 0.6 : 1) * p + (i < 2 ? 0.4 * live(i) : 0), translate: `${(1 - p) * -60}px 0px` }}>
              <BlockFace b={b} live={live(i)} />
            </div>
          );
        })}
      </div>

      {/* the order: beneath the gate in depth, so it goes through it */}
      {fold < 1 || end > 0 ? (
        <div style={{ position: "absolute", left: card.x, top: card.y, width: card.w, height: card.h, boxSizing: "border-box", borderRadius: 26 - 8 * fold, background: `rgb(255 255 255 / ${1 - 0.93 * fold})`, border: fold > 0 ? `2.5px solid rgb(192 224 33 / ${fold})` : undefined, boxShadow: fold < 1 ? SHADOW.xl : `0 0 ${40 * live(2)}px -8px rgb(192 224 33 / 0.8)`, overflow: "hidden", opacity: end }}>
          <Order k={Math.min(1, fold * 2)} />
          <BlockFace b={CHAIN[2]} k={Math.max(0, fold * 2 - 1)} live={live(2)} />
        </div>
      ) : null}

      <div style={{ position: "absolute", left: GL + shake, top: GT }}>
        <TheGate w={GW} lit={lit} checks={checks} fail={failing >= 0 ? ATTEMPTS[failing].fails : -1} barrier={Math.min(1, barrier)} glow={glow} knock={Math.min(1, knock)} />
      </div>

      {ATTEMPTS.map((a, i) => (
        <Attempt key={a.code} a={a} hit={T.hits[i]} />
      ))}

      <div style={{ position: "absolute", left: GL - 200, width: GW + 400, top: GT + GH + 34, textAlign: "center", ...display, fontSize: 60, color: C.lime, fontVariantNumeric: "tabular-nums", opacity: prog(frame, T.tally, 16) * end, translate: `0px ${(1 - prog(frame, T.tally, 16)) * 20}px` }}>7 of 7 stopped</div>
    </AbsoluteFill>
  );
};
