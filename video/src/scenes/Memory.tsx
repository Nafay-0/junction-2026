import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, EASE, EASE_IO, prog } from "../anim";
import { PAN } from "../camera";
import { C, display, sans, SHADOW } from "../theme";
import { cue } from "../vo";
import { AGENT_W, AgentNode } from "../world";

const c = (phrase: string, shift = 0) => cue("memory", phrase, shift);

/** The buying agent's node, nearer: the camera has pushed into it from the ring. */
export const MEMORY_NODE = { x: 960, y: 330, w: 660 };
const NK = MEMORY_NODE.w / AGENT_W;
const NH = 118 * NK;

/** What the kitchen's agent remembers, in the product's own words (reel-thread.json, attacks.json). */
const NOTES = ["Always lactose-free", "Semi-skimmed 1.5 %, as usual", "Milk: about 400 L an order"];

/**
 * The scene's own clock. It runs with the film until the Time machine's scrubber drags it back one beat and plays the
 * correction again, a little faster, so the whole scene visibly rewinds.
 */
const clock = (f: number, r0: number) => {
  const BACK = 54;
  if (f < r0) return f;
  if (f < r0 + 16) return r0 - BACK * EASE_IO((f - r0) / 16);
  if (f < r0 + 22) return r0 - BACK;
  return r0 - BACK + 1.5 * (f - r0 - 22);
};

/**
 * Memory, moving: the notes the agent keeps about this kitchen orbit its node. A request for 4 000 L arrives and
 * wobbles against what the kitchen usually buys; the agent asks the one question that matters, a tap answers it, the
 * corrected order passes on and its receipt flies to the inbox. Then the Time machine rewinds the scene a beat and
 * replays it.
 */
export const Memory = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const T = {
    notes: c("remembers", -2),
    req: c("So it catches", -14),
    wobble: c("four thousand"),
    ask: c("instead", -4),
    tap: c("four hundred", 6),
    fix: c("four hundred", 12),
    receipt: c("and asks", -2),
    pass: c("and asks", 10),
    scrub: c("and asks", 2),
    rewind: c("matters", -4),
  };
  const t = clock(frame, T.rewind);
  const rewinding = frame >= T.rewind && frame < T.rewind + 22 ? 1 - Math.abs((frame - T.rewind - 11) / 11) : 0;

  // The orbit: three notes on a tilted ellipse round the node; behind it at the top of their path, in front below.
  const notes = NOTES.map((n, i) => {
    const p = prog(t, T.notes + i * 7, 22);
    const ang = -Math.PI / 2 + (i / 3) * Math.PI * 2 + t * 0.012 + 0.6;
    const rx = 650 * (0.55 + 0.45 * p);
    const ry = 178 * (0.55 + 0.45 * p);
    const x = MEMORY_NODE.x + Math.cos(ang) * rx;
    const y = MEMORY_NODE.y + 12 + Math.sin(ang) * ry;
    const depth = (Math.sin(ang) + 1) / 2;
    return { n, i, p, x, y, depth };
  });
  const usual = notes[2];
  const caught = interpolate(t, [T.wobble, T.wobble + 6, T.fix, T.fix + 10], [0, 1, 1, 0], clamp);

  // The request card.
  const inP = interpolate(t, [T.req, T.wobble], [0, 1], { ...clamp, easing: EASE });
  const pass = interpolate(t, [T.pass, T.pass + 40], [0, 1], { ...clamp, easing: EASE_IO });
  // As the camera moves on to the search, the corrected order rides with it and dissolves into the catalogue.
  const exit = interpolate(frame, [durationInFrames - 30, durationInFrames], [0, 1], clamp);
  const ride = PAN(exit);
  const wob = t >= T.wobble && t < T.wobble + 26 ? Math.sin((t - T.wobble) * 1.3) * 5 * (1 - (t - T.wobble) / 26) : 0;
  const fixed = prog(t, T.fix, 12);
  const cardX = -540 + (470 + 540) * inP + 560 * pass + 2260 * ride;
  const cardY = 640;
  const cardFade = 1 - interpolate(exit, [0.55, 1], [0, 1], clamp);
  const ask = prog(t, T.ask, 14) * (1 - prog(t, T.fix + 4, 12));
  const tap = interpolate(t, [T.tap - 2, T.tap + 2, T.tap + 14], [0, 1, 0], clamp);
  const cursor = interpolate(t, [T.ask + 6, T.tap - 2], [0, 1], { ...clamp, easing: EASE_IO });

  // The receipt: out of the node, along an arc, into the inbox.
  const r = interpolate(t, [T.receipt, T.receipt + 26], [0, 1], { ...clamp, easing: EASE_IO });
  const inbox = { x: 1720, y: 130 };
  const rx = MEMORY_NODE.x + (inbox.x - MEMORY_NODE.x) * r;
  const ry = MEMORY_NODE.y + (inbox.y - MEMORY_NODE.y) * r - 180 * Math.sin(r * Math.PI);
  const landed = t >= T.receipt + 26;
  const bump = interpolate(t, [T.receipt + 24, T.receipt + 28, T.receipt + 40], [0, 1, 0], clamp);
  const inboxIn = prog(t, T.receipt - 8, 14);

  // The scrubber.
  const bar = prog(frame, T.scrub, 16) * (1 - prog(frame, durationInFrames - 30, 16));
  const head = interpolate(t, [T.scrub, durationInFrames], [0.55, 0.95], clamp);

  const Note = ({ o }: { o: (typeof notes)[number] }) => {
    const hot = o.i === 2 ? caught : 0;
    return (
      <div style={{ position: "absolute", left: o.x, top: o.y, translate: "-50% -50%", scale: String((0.82 + 0.22 * o.depth) * (0.6 + 0.4 * o.p)), opacity: o.p * (0.55 + 0.45 * o.depth), whiteSpace: "nowrap", padding: "14px 24px", borderRadius: 999, background: hot > 0.02 ? `color-mix(in srgb, ${C.safetySoft} ${hot * 100}%, ${C.lavender})` : C.lavender, color: C.lavenderDeep, ...sans, fontSize: 32, fontWeight: 600, boxShadow: `${SHADOW.lg}, 0 0 0 ${3 * hot}px ${C.safety}`, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: C.lavenderDeep }} />
        {o.n}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ filter: rewinding > 0.02 ? `saturate(${1 - 0.5 * rewinding}) hue-rotate(${-12 * rewinding}deg)` : undefined }}>
      {/* the notes at the back of their orbit, then the node, then those in front */}
      {notes.filter((o) => o.depth < 0.5).map((o) => (
        <Note key={o.n} o={o} />
      ))}
      <AgentNode name="Buying agent" sub="Hotel Lumo kitchen" lit={1} w={MEMORY_NODE.w} style={{ position: "absolute", left: MEMORY_NODE.x - MEMORY_NODE.w / 2, top: MEMORY_NODE.y - NH / 2 }} />
      {notes.filter((o) => o.depth >= 0.5).map((o) => (
        <Note key={o.n} o={o} />
      ))}

      {/* the line from the remembered "about 400 L" to the request it catches */}
      {caught > 0.02 && (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <path d={`M ${usual.x} ${usual.y} Q ${(usual.x + cardX + 240) / 2} ${(usual.y + cardY) / 2 - 80} ${cardX + 240} ${cardY}`} fill="none" stroke={C.safety} strokeWidth={3} strokeDasharray="8 10" opacity={caught} />
        </svg>
      )}

      {/* the request */}
      <div style={{ position: "absolute", left: cardX, top: cardY, width: 480, rotate: `${wob}deg`, translate: `${wob * 3}px 0px`, opacity: cardFade, scale: String(1 - 0.5 * ride) }}>
        <div style={{ boxSizing: "border-box", borderRadius: 26, background: C.paper, padding: "22px 30px", ...sans, boxShadow: `${SHADOW.xl}, 0 0 0 ${4 * Math.max(caught * (1 - fixed), fixed)}px ${fixed > 0.5 ? C.lime : C.safety}` }}>
          <div style={{ fontSize: 27, color: C.inkSoft }}>Lactose-free milk, for Friday</div>
          <div style={{ position: "relative", height: 88, overflow: "hidden", marginTop: 4 }}>
            <div style={{ position: "absolute", ...display, fontSize: 78, color: C.ink, fontVariantNumeric: "tabular-nums", translate: `0px ${-88 * fixed}px`, opacity: 1 - fixed }}>4 000 L</div>
            <div style={{ position: "absolute", ...display, fontSize: 78, color: C.ink, fontVariantNumeric: "tabular-nums", translate: `0px ${88 * (1 - fixed)}px`, opacity: fixed }}>400 L</div>
          </div>
        </div>
      </div>

      {/* the one question: out of the node, a tap answers it */}
      {ask > 0.01 && (
        <div style={{ position: "absolute", left: 1040, top: 610, transformOrigin: "0 0", scale: String(0.7 + 0.3 * ask), opacity: ask, width: 620, boxSizing: "border-box", borderRadius: 28, background: C.mist, boxShadow: SHADOW.xl, padding: "24px 28px", ...sans }}>
          <div style={{ ...display, fontSize: 56, color: C.ink }}>Did you mean 400 L?</div>
          <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
            <span style={{ position: "relative", height: 58, padding: "0 26px", borderRadius: 29, background: C.petrolDeep, color: C.paper, display: "flex", alignItems: "center", fontSize: 25, fontWeight: 600, scale: String(1 - 0.05 * tap) }}>
              Yes, 400 L
              <span style={{ position: "absolute", left: "50%", top: "50%", width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: "50%", background: "rgb(192 224 33 / 0.5)", scale: String(0.2 + 1.2 * (1 - tap)), opacity: tap }} />
            </span>
            <span style={{ height: 58, padding: "0 26px", borderRadius: 29, border: `1.5px solid ${C.lineStrong}`, color: C.ink, display: "flex", alignItems: "center", fontSize: 25, fontWeight: 600 }}>Yes, as I said</span>
          </div>
          <div style={{ position: "absolute", left: 120 + 60 * (1 - cursor), top: 128 + 90 * (1 - cursor), width: 34, height: 34, borderRadius: "50%", background: "rgb(255 255 255 / 0.9)", border: `3px solid ${C.petrolDeep}`, boxShadow: SHADOW.md, opacity: cursor, scale: String(1 - 0.2 * tap) }} />
        </div>
      )}

      {/* the inbox and the receipt on its way to it */}
      <div style={{ position: "absolute", left: inbox.x - 75, top: inbox.y - 58, width: 150, height: 116, borderRadius: 20, background: "rgb(255 255 255 / 0.1)", border: "2px solid rgb(255 255 255 / 0.3)", opacity: inboxIn, scale: String(1 + 0.12 * bump), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={76} height={57} viewBox="0 0 56 42" fill="none" stroke={C.paper} strokeWidth={3} strokeLinejoin="round">
          <rect x={2} y={2} width={52} height={38} rx={6} />
          <path d="M2 6 L28 24 L54 6" />
        </svg>
        <span style={{ position: "absolute", right: -12, top: -12, width: 42, height: 42, borderRadius: "50%", background: C.lime, color: C.slab, ...sans, fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", scale: String(landed ? 1 : 0) }}>1</span>
      </div>
      {r > 0 && !landed && (
        <div style={{ position: "absolute", left: rx, top: ry, translate: "-50% -50%", scale: String(1 - 0.6 * r), rotate: `${-8 * Math.sin(r * Math.PI)}deg`, width: 340, boxSizing: "border-box", borderRadius: 18, background: C.paper, padding: "14px 18px", boxShadow: SHADOW.lg, ...sans }}>
          <div style={{ fontSize: 22, color: C.inkSoft }}>Receipt</div>
          <div style={{ fontSize: 30, fontWeight: 650, color: C.ink, marginTop: 2 }}>400 L lactose-free milk</div>
        </div>
      )}

      {/* the Time machine */}
      {bar > 0.01 && (
        <div style={{ position: "absolute", left: 440, width: 1040, top: 972, opacity: bar, translate: `0px ${(1 - bar) * 20}px`, display: "flex", alignItems: "center", gap: 22, ...sans }}>
          <span style={{ fontSize: 30, fontWeight: 600, color: "rgb(255 255 255 / 0.85)", whiteSpace: "nowrap" }}>Time machine</span>
          <div style={{ position: "relative", flex: 1, height: 6, borderRadius: 3, background: "rgb(255 255 255 / 0.18)" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${head * 100}%`, borderRadius: 3, background: C.lime, opacity: 0.6 }} />
            <span style={{ position: "absolute", top: -11, left: `${head * 100}%`, marginLeft: -14, width: 28, height: 28, borderRadius: "50%", background: C.lime, boxShadow: `0 0 ${10 + 20 * rewinding}px rgb(192 224 33 / 0.9)` }} />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
