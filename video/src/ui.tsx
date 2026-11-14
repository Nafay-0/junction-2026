import type { CSSProperties, ReactNode } from "react";
import { C, display, sans, SHADOW } from "./theme";

/* ---------- marks ---------- */

/** The pilot light: a lime lamp in a petrol bezel (web/src/app/_ui/wordmark.tsx). */
export const PilotLight = ({ size = 14, onDark = false, glow = 0.28 }: { size?: number; onDark?: boolean; glow?: number }) => (
  <span style={{ display: "inline-flex", flexShrink: 0, alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "32%", background: onDark ? "rgb(255 255 255 / 0.15)" : C.petrolDeep }}>
    <span style={{ width: "46%", height: "46%", borderRadius: "50%", background: C.lime, boxShadow: `0 0 0 ${Math.max(2, size * 0.06)}px rgb(192 224 33 / ${glow})` }} />
  </span>
);

export const Wordmark = ({ size = 30, tone = "petrol" }: { size?: number; tone?: "petrol" | "paper" }) => (
  <span style={{ display: "inline-flex", alignItems: "center", lineHeight: 1, gap: Math.round(size * 0.3) }}>
    <PilotLight size={Math.round(size * 0.62)} onDark={tone === "paper"} />
    <span style={{ ...display, whiteSpace: "nowrap", color: tone === "paper" ? C.paper : C.petrolDeep, fontSize: Math.round(size * 0.8), fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>AimoPilot</span>
  </span>
);

/** The gate's own mark: the quartered crash-test target. */
export const GateMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill={C.slab} />
    <path d="M16 1 A15 15 0 0 1 31 16 L16 16 Z" fill={C.safety} />
    <path d="M16 31 A15 15 0 0 1 1 16 L16 16 Z" fill={C.safety} />
  </svg>
);

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
type IconProps = { size?: number | string; color?: string; style?: CSSProperties };
const Svg = ({ size = "1em", color, style, children }: IconProps & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ color, flexShrink: 0, ...style }} {...stroke}>
    {children}
  </svg>
);
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </Svg>
);
export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h3l2-3h8l2 3h3v12H3z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Svg>
);
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
);
export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);
export const IconTruck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z" />
    <circle cx="6.5" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
);
export const IconFaceId = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 9.5v1.2M15 9.5v1.2M12 9.5v3.2h-.8M9 15.2a4 4 0 0 0 6 0" />
  </Svg>
);
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Svg>
);

/* ---------- device frames ---------- */

export const BrowserFrame = ({ width, height, url, children, style }: { width: number; height: number; url: string; children: ReactNode; style?: CSSProperties }) => (
  <div style={{ width, height: height + 44, borderRadius: 16, overflow: "hidden", background: C.paper, boxShadow: SHADOW.xl, ...style }}>
    <div style={{ height: 44, background: "#e6edef", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, borderBottom: `1px solid ${C.line}` }}>
      {["#f26d5f", "#f5bf4f", "#5fcb58"].map((c) => (
        <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, opacity: 0.85 }} />
      ))}
      <div style={{ ...sans, margin: "0 auto", translate: "-26px 0", minWidth: 460, height: 28, borderRadius: 14, background: C.paper, color: C.inkSoft, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
        <IconLock size={12} color={C.inkFaint} />
        {url}
      </div>
    </div>
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>{children}</div>
  </div>
);

/** A phone: 390 × 844 points inside, scaled by `scale`. */
export const PhoneFrame = ({ scale = 1, children, style }: { scale?: number; children: ReactNode; style?: CSSProperties }) => {
  const w = 390;
  const h = 844;
  const bezel = 11;
  return (
    <div style={{ width: (w + bezel * 2) * scale, height: (h + bezel * 2) * scale, ...style }}>
      <div style={{ width: w + bezel * 2, height: h + bezel * 2, scale: String(scale), transformOrigin: "0 0", borderRadius: 58, background: "#0b1215", padding: bezel, boxSizing: "border-box", boxShadow: `${SHADOW.xl}, inset 0 0 0 1.5px rgb(255 255 255 / 0.14)` }}>
        <div style={{ position: "relative", width: w, height: h, borderRadius: 47, overflow: "hidden", background: C.mist }}>
          {children}
          <div style={{ position: "absolute", top: 11, left: "50%", translate: "-50% 0", width: 112, height: 32, borderRadius: 16, background: "#0b1215" }} />
        </div>
      </div>
    </div>
  );
};

/* ---------- the conversation on its line (web/src/app/k/[kitchen]/thread-line.tsx) ---------- */

/** Sizes inside are in em: set `fontSize` on this to scale the whole thread. */
export const ThreadLine = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ position: "relative", paddingLeft: "2.35em", ...sans, color: C.ink, ...style }}>
    <div style={{ position: "absolute", left: "0.56em", top: 0, bottom: 0, width: "0.09em", background: C.lineStrong }} />
    <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
  </div>
);

export const Buyer = ({ children, spoken }: { children: ReactNode; spoken?: boolean }) => (
  <div style={{ position: "relative", padding: "0.85em 0" }}>
    <span style={{ position: "absolute", left: "-2.105em", top: "1.28em", width: "0.72em", height: "0.72em", boxSizing: "border-box", borderRadius: "50%", border: `0.15em solid ${C.petrol}`, background: C.mist }} />
    <div style={{ ...display, fontSize: "1.2em", lineHeight: 1.25, color: C.petrolDeep, display: "flex", gap: "0.4em", alignItems: "baseline" }}>
      {spoken && <IconMic size="0.8em" color={C.petrol} style={{ translate: "0 0.08em" }} />}
      <span>{children}</span>
    </div>
  </div>
);

export const Agent = ({ children, busy = false, pulse = 0 }: { children: ReactNode; busy?: boolean; pulse?: number }) => (
  <div style={{ position: "relative", padding: "0.85em 0" }}>
    <span style={{ position: "absolute", left: "-2.32em", top: "1.05em", width: "1.15em", height: "1.15em", borderRadius: "50%", background: busy ? C.lime : C.petrol, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: busy ? `0 0 0 ${0.15 + pulse * 0.35}em rgb(192 224 33 / ${0.35 - pulse * 0.3})` : "none" }}>
      {!busy && <span style={{ width: "0.38em", height: "0.38em", borderRadius: "50%", background: C.lime }} />}
    </span>
    {children}
  </div>
);

export const Say = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <p style={{ margin: 0, fontSize: "1.02em", lineHeight: 1.6, maxWidth: "39ch", textWrap: "pretty", ...style }}>{children}</p>;
export const B = ({ children }: { children: ReactNode }) => <span style={{ fontWeight: 650 }}>{children}</span>;
export const D = ({ children }: { children: ReactNode }) => <span style={{ color: C.petrol }}>{children}</span>;

export const OptionRow = ({ title, price, sub, style }: { title: string; price: string; sub: string; style?: CSSProperties }) => (
  <div style={{ background: C.paper, borderRadius: "1em", padding: "0.72em 1em", display: "flex", gap: "1em", justifyContent: "space-between", boxShadow: "0 1px 2px rgb(0 54 70 / 0.05)", marginTop: "0.5em", ...style }}>
    <div>
      <div style={{ fontSize: "0.96em", fontWeight: 500, lineHeight: 1.35 }}>{title}</div>
      <div style={{ fontSize: "0.83em", color: C.inkSoft, marginTop: "0.15em" }}>{sub}</div>
    </div>
    <div style={{ fontSize: "0.96em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{price}</div>
  </div>
);

/** One of the agent's steps, set quiet: smaller, grey, under a thin rule. */
export const StepRow = ({ head, rest, done = true }: { head: string; rest?: string; done?: boolean }) => (
  <div style={{ position: "relative", paddingLeft: "0.95em", fontSize: "0.8em", lineHeight: 1.4, color: C.inkSoft, padding: "0.22em 0 0.22em 0.95em" }}>
    <span style={{ position: "absolute", left: 0, top: "0.72em", width: "0.42em", height: "0.42em", borderRadius: "50%", background: done ? C.petrol : C.lime, opacity: 0.75 }} />
    <span style={{ fontWeight: 600 }}>{head}.</span> {rest}
  </div>
);
export const StepsBox = ({ children }: { children: ReactNode }) => <div style={{ marginTop: "0.5em", marginLeft: "0.2em", borderLeft: `1px solid ${C.line}`, paddingLeft: "0.85em" }}>{children}</div>;
export const StepsToggle = ({ n }: { n: number }) => (
  <div style={{ marginTop: "0.6em", fontSize: "0.78em", fontWeight: 500, color: C.inkSoft, display: "flex", alignItems: "center", gap: "0.35em" }}>
    {n} steps <IconChevron size="1em" />
  </div>
);

const hazard = `repeating-linear-gradient(135deg, ${C.safety} 0 0.6em, ${C.slab} 0.6em 1.2em)`;

/** The dark slab: an order waiting for a person's OK. `press` 0..1 presses the button. */
export const SignOffSlab = ({ press = 0, button = "OK with Face ID" }: { press?: number; button?: string }) => (
  <div style={{ marginTop: "0.8em", borderRadius: "1.35em", overflow: "hidden", background: C.slab, color: C.chalk, boxShadow: SHADOW.md }}>
    <div style={{ height: "0.5em", background: hazard }} />
    <div style={{ padding: "1.05em 1.3em 1.3em" }}>
      <div style={{ fontSize: "0.86em", color: C.safety, fontWeight: 500 }}>Needs your OK</div>
      <div style={{ ...display, fontSize: "2.1em", color: C.paper, marginTop: "0.15em", fontVariantNumeric: "tabular-nums" }}>1 010,00 €</div>
      <div style={{ fontSize: "0.92em", lineHeight: 1.5, marginTop: "0.5em" }}>1 000 × Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free</div>
      <div style={{ fontSize: "0.92em", lineHeight: 1.5, color: C.safety, marginTop: "0.25em" }}>In place of your usual Valio Eila semi skimmed milk drink 10 l box lactose free, which cannot come in time.</div>
      <div style={{ fontSize: "0.86em", lineHeight: 1.5, color: C.chalkSoft, marginTop: "0.2em" }}>Mon 16 Nov. 1 010,00 € is over the 500,00 € the agent may spend alone.</div>
      <div style={{ marginTop: "1em", height: "3.1em", borderRadius: "1.55em", background: C.lime, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.55em", fontWeight: 600, fontSize: "1.02em", scale: String(1 - press * 0.04), filter: `brightness(${1 - press * 0.1})` }}>
        <IconFaceId size="1.35em" />
        {button}
      </div>
      <div style={{ marginTop: "0.9em", display: "flex", gap: "1.4em", fontSize: "0.86em", color: C.chalkSoft }}>
        <span style={{ borderBottom: `1px solid ${C.chalkSoft}` }}>Send to my phone</span>
        <span style={{ borderBottom: `1px solid ${C.chalkSoft}` }}>Take it back</span>
      </div>
    </div>
  </div>
);

export const SignedSlab = () => (
  <div style={{ marginTop: "0.8em", borderRadius: "1.35em", overflow: "hidden", background: C.slab, color: C.chalk, boxShadow: SHADOW.md }}>
    <div style={{ padding: "1.2em 1.3em 1.3em" }}>
      <div style={{ fontSize: "0.86em", color: C.chalkSoft }}>OK given</div>
      <div style={{ ...display, fontSize: "2.1em", color: C.paper, marginTop: "0.15em", fontVariantNumeric: "tabular-nums" }}>1 010,00 €</div>
      <div style={{ fontSize: "0.92em", lineHeight: 1.5, marginTop: "0.5em" }}>1 000 × Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free</div>
      <div style={{ marginTop: "1em", height: "3.1em", borderRadius: "1.55em", background: C.slab2, color: C.lime, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5em", fontWeight: 600, fontSize: "1.02em" }}>
        <IconCheck size="1.2em" />
        OK&apos;d by Kitchen manager
      </div>
    </div>
  </div>
);

export const Composer = ({ children, focus = false, style }: { children?: ReactNode; focus?: boolean; style?: CSSProperties }) => (
  <div style={{ ...sans, display: "flex", alignItems: "center", gap: "0.9em", height: "3.5em", borderRadius: "1.75em", background: C.paper, border: `${focus ? 2 : 1}px solid ${focus ? C.lavenderDeep : C.lineStrong}`, padding: "0 0.3em 0 1.4em", boxSizing: "border-box", boxShadow: "0 1px 2px rgb(0 54 70 / 0.05)", ...style }}>
    <div style={{ flex: 1, fontSize: "1.02em", color: children ? C.ink : C.inkSoft, whiteSpace: "nowrap", overflow: "hidden" }}>{children ?? "What does the kitchen need?"}</div>
    <IconMic size="1.3em" color={C.inkSoft} />
    <IconCamera size="1.3em" color={C.inkSoft} />
    <div style={{ width: "2.9em", height: "2.9em", borderRadius: "50%", background: C.lime, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <IconArrowUp size="1.35em" color={C.ink} />
    </div>
  </div>
);

/** The dish card: every ingredient in exactly one of three groups (web/src/app/k/[kitchen]/thread-dishes.tsx). */
export const DishRow = ({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) => (
  <p style={{ margin: "0.3em 0 0", fontSize: "0.88em", lineHeight: 1.55, color: tone ?? C.inkSoft }}>
    <span style={{ fontWeight: 600, color: C.ink }}>{label}: </span>
    {children}
  </p>
);

/* ---------- the film's own type ---------- */

export const Headline = ({ children, size = 96, color = C.paper, style }: { children: ReactNode; size?: number; color?: string; style?: CSSProperties }) => <div style={{ ...display, fontSize: size, color, textWrap: "balance", ...style }}>{children}</div>;
export const Support = ({ children, size = 40, color = "rgb(255 255 255 / 0.78)", style }: { children: ReactNode; size?: number; color?: string; style?: CSSProperties }) => (
  <div style={{ ...sans, fontSize: size, lineHeight: 1.35, color, textWrap: "pretty", ...style }}>{children}</div>
);

/** The dark ground every scene stands on. */
/**
 * A scene's ground. The film's world (src/camera.tsx) is drawn once behind every scene and moves with the camera, so a
 * scene draws no background of its own: only what stands in the world. `tone` is kept for the Stills.
 */
export const Ground = ({ children }: { children: ReactNode; tone?: "deep" | "slab" }) => <div style={{ position: "absolute", inset: 0 }}>{children}</div>;
