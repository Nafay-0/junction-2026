import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, Count, EASE, EASE_IO, M, prog, Q, Rise, Typed } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const T = {
  l1: cue("problem", "AI agents", -4),
  l2: cue("problem", "But the webshop", -4),
  l3: cue("problem", "So who signs", -4),
};
/** The narrator says the first two lines; only the question stays on screen. */
const LINES = [{ at: T.l3, text: "Who signs for the machine?" }];

/** Where the agent's pointer is: off the page, on the order line, by the empty name, on the button. */
const PATH = [
  { f: T.l1 - 4, x: 1880, y: 1010 },
  { f: T.l1 + 16, x: 1560, y: 398 },
  { f: T.l2 - 6, x: 1560, y: 398 },
  { f: T.l2 + 16, x: 1480, y: 560 },
  { f: T.l3 - 4, x: 1480, y: 560 },
  { f: T.l3 + 22, x: 1500, y: 858 },
];
const at = (frame: number, k: "x" | "y") =>
  interpolate(
    frame,
    PATH.map((p) => p.f),
    PATH.map((p) => p[k]),
    { ...clamp, easing: EASE_IO },
  );

const Field = ({
  label,
  hot,
  children,
}: {
  label: string;
  hot: number;
  children?: React.ReactNode;
}) => (
  <div style={{ marginTop: 30 }}>
    <div style={{ ...sans, fontSize: 25, color: C.inkSoft, marginBottom: 10 }}>
      {label}
    </div>
    <div
      style={{
        height: 84,
        borderRadius: 18,
        border: `2.5px dashed ${hot > 0.5 ? C.safety : C.lineStrong}`,
        background: hot > 0.5 ? C.safetySoft : C.mist,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 18,
      }}
    >
      {children}
    </div>
  </div>
);

/** The problem as a picture: an agent's order arrives at a checkout built for a person, and nobody is there to say yes. */
export const Problem = () => {
  const frame = useCurrentFrame();
  // The film opens already moving: the checkout comes out of the depth, sharpening as it lands.
  const card = prog(frame, -6, 26);
  const room = interpolate(frame, [T.l3 - 16, T.l3 + 10], [0, 1], {
    ...clamp,
    easing: EASE_IO,
  });
  const typed = frame >= T.l1 + 14;
  const who = interpolate(frame, [T.l2 + 8, T.l2 + 22], [0, 1], clamp);
  const sign = interpolate(frame, [T.l3 + 4, T.l3 + 18], [0, 1], clamp);
  const press = interpolate(
    frame,
    [T.l3 + 26, T.l3 + 31, T.l3 + 38],
    [0, 1, 0],
    clamp,
  );
  const shake =
    frame > T.l3 + 31 && frame < T.l3 + 52
      ? Math.sin((frame - T.l3 - 31) * 1.5) *
        10 *
        (1 - (frame - T.l3 - 31) / 21)
      : 0;
  return (
    <AbsoluteFill>
      <Ground>
        {LINES.map((l, i) => (
          <Rise
            key={l.text}
            at={l.at}
            dur={M}
            y={0}
            x={-50}
            exit={LINES[i + 1] ? LINES[i + 1].at - Q : undefined}
            style={{
              position: "absolute",
              left: 110,
              top: 380,
              width: 860,
              ...display,
              fontSize: 124,
              color: C.lime,
              textWrap: "balance",
            }}
          >
            {l.text}
          </Rise>
        ))}

        {/* The checkout holds the centre until the question arrives, then makes room for it. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            translate: `${(-470 * (1 - room)).toFixed(2)}px 0px`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 1040,
              top: 150,
              width: 770,
              boxSizing: "border-box",
              borderRadius: 32,
              background: C.paper,
              boxShadow: SHADOW.xl,
              padding: "40px 44px 44px",
              opacity: Math.min(1, card * 1.6),
              scale: String(1 + 0.14 * (1 - card)),
              filter: card < 0.98 ? `blur(${((1 - card) * 12).toFixed(2)}px)` : undefined,
              rotate: "1.2deg",
            }}
          >
            <div style={{ ...sans, fontSize: 24, color: C.inkSoft }}>
              Wholesale webshop
            </div>
            <div
              style={{ ...display, fontSize: 60, color: C.ink, marginTop: 4 }}
            >
              Checkout
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: 92,
                marginTop: 26,
                borderTop: `1.5px solid ${C.line}`,
                borderBottom: `1.5px solid ${C.line}`,
                ...sans,
                fontSize: 32,
                color: C.ink,
              }}
            >
              <span>
                {typed ? (
                  <Typed
                    text="1 000 × lactose-free milk, 1 l"
                    at={T.l1 + 14}
                    perFrame={1.3}
                  />
                ) : null}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  opacity: frame > T.l1 + 34 ? 1 : 0,
                }}
              >
                <Count
                  to={1010}
                  at={T.l1 + 34}
                  dur={18}
                  format={(n) =>
                    `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},00 €`
                  }
                />
              </span>
            </div>
            <Field label="Ordered by" hot={0}>
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: `2.5px dashed ${who > 0.5 ? C.petrol : C.lineStrong}`,
                  scale: String(1 + 0.12 * Math.sin(frame / 5) * who),
                }}
              />
              <span
                style={{
                  ...sans,
                  fontSize: 28,
                  color: C.inkFaint,
                  opacity: who,
                }}
              >
                a person, signed in
              </span>
            </Field>
            <Field label="Approved by" hot={sign}>
              <span
                style={{
                  ...display,
                  fontSize: 56,
                  color: C.slab,
                  opacity: sign,
                  scale: String(0.6 + 0.4 * EASE(sign)),
                }}
              >
                ?
              </span>
            </Field>
            <div
              style={{
                marginTop: 40,
                height: 96,
                borderRadius: 48,
                background: C.lime,
                color: C.ink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...sans,
                fontSize: 36,
                fontWeight: 700,
                scale: String(1 - press * 0.04),
                translate: `${shake}px 0px`,
                filter: `brightness(${1 - press * 0.1})`,
              }}
            >
              Place order
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: at(frame, "x"),
              top: at(frame, "y"),
              opacity: prog(frame, T.l1 - 4, 8),
            }}
          >
            <svg
              width={54}
              height={54}
              viewBox="0 0 24 24"
              style={{
                filter: "drop-shadow(0 6px 10px rgb(0 0 0 / 0.35))",
                scale: String(1 - press * 0.12),
              }}
            >
              <path
                d="M4 2l15 9.5-6.5 1.5L9 20z"
                fill={C.petrolDeep}
                stroke="#fff"
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </svg>
            <div
              style={{
                position: "absolute",
                left: 40,
                top: 40,
                height: 44,
                padding: "0 18px 0 14px",
                borderRadius: 22,
                background: C.petrolDeep,
                border: "1.5px solid rgb(255 255 255 / 0.5)",
                color: C.paper,
                display: "flex",
                alignItems: "center",
                gap: 10,
                ...sans,
                fontSize: 24,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: C.lime,
                }}
              />
              AI agent
            </div>
          </div>
        </div>
      </Ground>
    </AbsoluteFill>
  );
};
