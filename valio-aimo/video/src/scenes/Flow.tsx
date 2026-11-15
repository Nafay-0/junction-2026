import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {
  clamp,
  EASE,
  EASE_IO,
  fall,
  fi,
  Grow,
  L,
  M,
  prog,
  Q,
  Rise,
  Shrink,
  Typed,
} from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { cue } from "../vo";
import {
  Agent,
  B,
  BrowserFrame,
  Buyer,
  Composer,
  D,
  GateMark,
  Ground,
  IconCheck,
  IconFaceId,
  IconTruck,
  IconX,
  OptionRow,
  PhoneFrame,
  Say,
  SignedSlab,
  SignOffSlab,
  StepRow,
  StepsBox,
  StepsToggle,
  ThreadLine,
  Wordmark,
} from "../ui";

/**
 * The partner's own example, in the product's own words (web/src/app/_landing2/reel-thread.json, captured from the
 * running product): request, lookup, order, approval. The catalogue behind is a real capture; the agent panel and the
 * approver's phone are the product's widgets, rebuilt so they can be staged.
 */
const W = 1440;
const H = 900;
const PANEL = 544;

const c = (phrase: string, shift = 0) => cue("flow", phrase, shift);
/** Every moment on the frame its word is spoken (src/vo.ts). */
export const T = {
  type: 34,
  zoom: c("Monday", 8),
  send: c("Monday", 16),
  work: c("Monday", 24),
  steps: [
    c("The agent", 2),
    c("The agent", 12),
    c("searches", 6),
    c("prices just"),
    c("just three", 14),
  ],
  funnel: c("Monday", 28),
  count: c("seventeen", -16),
  narrow: c("and prices", -4),
  three: c("just three", -6),
  reply: c("The usual boxes", -2),
  options: [c("offers"), c("offers", 11), c("offers", 22)],
  type2: c("It's over", -18),
  send2: c("It's over"),
  work2: c("It's over", 6),
  steps2: [c("It's over", 10), c("It's over", 20)],
  gate: c("limit", 4),
  slab: c("limit", 12),
  phone: c("a person", -6),
  tap: c("One passkey", 4),
  face: c("One passkey", 12),
  ok: c("placed", 2),
  placed: c("placed", 12),
};

const REQUEST = "I need 1,000 litres of lactose-free milk by Monday";

const Working = ({ label }: { label: string }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        display: "inline-block",
        fontSize: "0.9em",
        fontWeight: 500,
        backgroundImage: `linear-gradient(100deg, ${C.petrol} 0%, ${C.petrol} 38%, #8fd0e0 50%, ${C.petrol} 62%, ${C.petrol} 100%)`,
        backgroundSize: "220% 100%",
        backgroundPosition: `${120 - ((frame * 5) % 240)}% 0`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {label}
    </div>
  );
};

/**
 * The two marks the product draws on every option today (web/src/app/k/[kitchen]/thread-marks.tsx, CompactMarks):
 * five pips for the delivery record and a leaf with the estimated footprint. All three products have a good record;
 * the kilograms are the live site's figures. They come in once their row has landed: the pips fill one by one, then
 * the leaf and its figure rise into place.
 */
const Marks = ({ at, kg }: { at: number; kg: string }) => {
  const frame = useCurrentFrame();
  const leaf = prog(frame, at + 10, 14);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5em", marginLeft: "0.5em", verticalAlign: "middle" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.17em" }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const on = prog(frame, at + i * 2, 6);
          return <span key={i} style={{ width: "0.42em", height: "0.42em", borderRadius: "50%", background: "currentColor", opacity: 0.25 + 0.75 * on, scale: String(0.8 + 0.2 * on) }} />;
        })}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2em", fontVariantNumeric: "tabular-nums", opacity: leaf, translate: `0px ${((1 - leaf) * 7).toFixed(2)}px` }}>
        <svg width="0.95em" height="0.95em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
        </svg>
        {kg}
      </span>
    </span>
  );
};

const Thread = () => {
  const frame = useCurrentFrame();
  const pulse = (frame % 30) / 30;
  const label =
    frame < T.steps[2]
      ? "Reading your request"
      : frame < T.steps[3]
        ? "Checking against your history and the assortment"
        : "Checking live prices and the delivery day";
  return (
    <ThreadLine
      style={{
        flexShrink: 0,
        minHeight: "100%",
        boxSizing: "border-box",
        paddingTop: 16,
        paddingBottom: 10,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <Agent>
        <Say>
          Your Monday lactose-free milk can&apos;t come this week: the order
          cut-off for that day has passed. The closest is Valio Hyvä suomalainen
          Arki: 0,49 € less per litre, 420 l as 420 × 1 l, same maker. Shall I
          switch this week&apos;s order?
        </Say>
        <div
          style={{
            marginTop: "0.6em",
            fontSize: "0.78em",
            fontWeight: 500,
            color: C.inkSoft,
          }}
        >
          1 step
        </div>
      </Agent>
      <Grow at={T.send}>
        <Buyer>{REQUEST}</Buyer>
      </Grow>
      <Grow at={T.work}>
        <Agent busy={frame < T.reply} pulse={pulse}>
          <Shrink at={T.reply - 6}>
            <Working label={label} />
          </Shrink>
          <Grow at={T.reply}>
            <Say>
              I found three ways to get the <B>1 000 L</B> of lactose-free milk
              to you by <D>Monday 16 Nov</D>. Your usual 10 l boxes can&apos;t
              arrive in time, so it would come as <B>1 000 one-litre cartons</B>
              . Which one?
            </Say>
          </Grow>
          <Grow at={T.options[0]}>
            <OptionRow
              title="Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free"
              price="1 010,00 €"
              sub={
                <>
                  1,01 €/l · Mon 16 Nov
                  <Marks at={T.options[0] + 16} kg="≈1 128 kg" />
                </>
              }
              style={{
                boxShadow: `0 0 0 ${2.5 * prog(frame, T.options[2] + 10, 12)}px ${C.lime}, 0 1px 2px rgb(0 54 70 / 0.05)`,
              }}
            />
          </Grow>
          <Grow at={T.options[1]}>
            <OptionRow
              title="Valio semi skimmed milk 1 l lactose free UHT"
              price="1 560,00 €"
              sub={
                <>
                  1,56 €/l · 550,00 € more
                  <Marks at={T.options[1] + 16} kg="≈1 134 kg" />
                </>
              }
            />
          </Grow>
          <Grow at={T.options[2]}>
            <OptionRow
              title="Arla Semi skimmed milkdrink + Valio Arki Eila semi"
              price="1 574,48 €"
              sub={
                <>
                  2,48 €/l · Lowest carbon, 564,48 € more
                  <Marks at={T.options[2] + 16} kg="≈1 127 kg" />
                </>
              }
            />
          </Grow>
          <Grow at={T.options[2] + 12}>
            <div
              style={{
                fontSize: "0.84em",
                color: C.inkSoft,
                marginTop: "0.7em",
              }}
            >
              or just tell me
            </div>
          </Grow>
          <Shrink at={T.reply - 4} dur={16}>
            <StepsBox>
              <Grow at={T.steps[0]} dur={12}>
                <StepRow
                  head="Read your request"
                  rest="1 000 L, lactose-free milk, Mon 16 Nov"
                />
              </Grow>
              <Grow at={T.steps[1]} dur={12}>
                <StepRow
                  head="Looked at your history"
                  rest="Always lactose-free: many breakfast guests ask for it, as always (Kitchen manager, Tue 27.10.)"
                />
              </Grow>
              <Grow at={T.steps[2]} dur={12}>
                <StepRow
                  head="Searched the assortment"
                  rest="Valio Hyvä suomalainen Arki® Eila® 1 l · Valio semi skimmed 1 l UHT · Arla + Valio Arki Eila"
                />
              </Grow>
              <Grow at={T.steps[3]} dur={12}>
                <StepRow
                  head="Checked live price and delivery for 3"
                  rest="All can arrive Mon 16 Nov. The cheapest is 1 010,00 €."
                />
              </Grow>
              <Grow at={T.steps[4]} dur={12}>
                <StepRow
                  head="Left out 17 products"
                  rest="The order cut-off for that day has passed (6); a different kind of product than asked (11)"
                />
              </Grow>
            </StepsBox>
          </Shrink>
          <Grow at={T.reply + 8}>
            <StepsToggle n={5} />
          </Grow>
        </Agent>
      </Grow>
      <Grow at={T.send2}>
        <Buyer>the first one</Buyer>
      </Grow>
      <Grow at={T.work2}>
        <Agent busy={frame < T.gate} pulse={pulse}>
          <Shrink at={T.gate - 6}>
            <Working label="Fixing the price with the wholesaler" />
          </Shrink>
          <Grow at={T.gate}>
            <Say>
              1000 × Valio Hyvä suomalainen Arki for <B>1 010,00 €</B> is over
              the <B>500,00 €</B> I may spend alone, so it needs the kitchen
              manager&apos;s OK.
            </Say>
          </Grow>
          <Grow at={T.placed}>
            <Say style={{ marginTop: "0.5em" }}>
              The Kitchen manager OK&apos;d it, and the order is placed:{" "}
              <B>1 000 one-litre cartons</B> of Valio Eila lactose-free milk for{" "}
              <B>1 010,00 €</B>, arriving <D>Monday 16 Nov</D>.
            </Say>
          </Grow>
          <Grow at={T.slab} dur={20}>
            <Shrink at={T.ok + 6} dur={16}>
              <SignOffSlab />
            </Shrink>
            <Grow at={T.ok + 6} dur={16}>
              <SignedSlab />
            </Grow>
          </Grow>
          <Shrink at={T.gate - 4} dur={14}>
            <StepsBox>
              <Grow at={T.steps2[0]} dur={10}>
                <StepRow
                  head="Price held until 21.13"
                  rest="Signed by the wholesaler: anyone can check it against their published key."
                />
              </Grow>
              <Grow at={T.steps2[1]} dur={10}>
                <StepRow
                  head="Checked your rules"
                  rest="1 010,00 € is over the 500,00 € the agent may spend alone."
                />
              </Grow>
            </StepsBox>
          </Shrink>
          <Grow at={T.gate + 8}>
            <StepsToggle n={3} />
          </Grow>
        </Agent>
      </Grow>
    </ThreadLine>
  );
};

const Panel = () => {
  const frame = useCurrentFrame();
  const typing1 = frame >= T.type && frame < T.send;
  const typing2 = frame >= T.type2 && frame < T.send2;
  return (
    <div
      style={{
        position: "absolute",
        left: W - PANEL,
        top: 0,
        width: PANEL,
        height: H,
        background: C.mist,
        borderLeft: `1px solid ${C.line}`,
        display: "flex",
        flexDirection: "column",
        fontSize: 16,
        ...sans,
      }}
    >
      <div
        style={{
          height: 70,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          gap: 10,
          color: C.inkSoft,
          fontSize: 14,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: C.petrol,
          }}
        />
        <span style={{ color: C.ink }}>Your buying agent</span>
        <span style={{ marginLeft: "auto" }}>Hotel Lumo kitchen</span>
        <span
          style={{
            color: C.petrol,
            fontWeight: 600,
            borderBottom: `1px solid ${C.petrol}`,
          }}
        >
          Start over
        </span>
        <IconX size={16} color={C.inkSoft} />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "0 26px 0 30px",
        }}
      >
        <Thread />
      </div>
      <div style={{ flexShrink: 0, padding: "8px 14px 16px" }}>
        <Composer focus={typing1 || typing2}>
          {typing1 ? (
            <Typed text={REQUEST} at={T.type} perFrame={0.6} />
          ) : typing2 ? (
            <Typed text="the first one" at={T.type2} perFrame={0.85} />
          ) : undefined}
        </Composer>
      </div>
    </div>
  );
};

const STAGES = ["Request", "Lookup", "Order", "Approval"];
const Rail = ({
  active,
  x,
  opacity,
}: {
  active: number;
  x: number;
  opacity: number;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: 66,
      display: "flex",
      gap: 10,
      ...sans,
      opacity,
    }}
  >
    {STAGES.map((s, i) => (
      <div
        key={s}
        style={{
          height: 52,
          padding: "0 26px",
          borderRadius: 26,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 26,
          fontWeight: 600,
          background: i === active ? C.lime : "rgb(255 255 255 / 0.09)",
          color:
            i === active
              ? C.ink
              : i < active
                ? "rgb(255 255 255 / 0.85)"
                : "rgb(255 255 255 / 0.5)",
        }}
      >
        {i < active && <IconCheck size={22} color={C.lime} />}
        {s}
      </div>
    ))}
  </div>
);

/** The right of the frame, one thing at a time. */
const Side = ({
  at,
  exit,
  children,
}: {
  at: number;
  exit: number;
  children: ReactNode;
}) => (
  <Rise
    at={at}
    exit={exit}
    y={30}
    style={{ position: "absolute", left: 1100, top: 190, width: 740 }}
  >
    {children}
  </Rise>
);

/** The lookup as a funnel: the whole catalogue, the few candidates, the three that get a live price. */
const COLS = 20;
const DOTS = COLS * 7;
const KEPT = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) % DOTS);
const LIVE = [
  { name: "Valio Eila, 1 l", price: "1,01 €/l" },
  { name: "Valio UHT, 1 l", price: "1,56 €/l" },
  { name: "Arla and Valio Eila", price: "2,48 €/l" },
];
const Funnel = () => {
  const frame = useCurrentFrame();
  const narrow = prog(frame, T.narrow, M);
  const three = prog(frame, T.three, M);
  const count = Math.round(
    interpolate(frame, [T.count, T.count + L], [0, 17546], {
      ...clamp,
      easing: EASE,
    }),
  );
  const value = three > 0.5 ? "3" : narrow > 0.5 ? "20" : fi(count);
  const label =
    three > 0.5
      ? "priced live. Only these."
      : narrow > 0.5
        ? "candidates, by meaning"
        : "products searched";
  const swap =
    three > 0 && three < 1
      ? Math.abs(three - 0.5) * 2
      : narrow > 0 && narrow < 1
        ? Math.abs(narrow - 0.5) * 2
        : 1;
  return (
    <>
      <div
        style={{
          opacity: swap,
          height: 236,
        }}
      >
        <span
          style={{
            ...display,
            display: "block",
            fontSize: 168,
            color: C.lime,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        <span
          style={{ ...sans, display: "block", marginTop: 6, fontSize: 44, whiteSpace: "nowrap", color: "rgb(255 255 255 / 0.86)" }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: 13,
          marginTop: 30,
          width: 740,
        }}
      >
        {Array.from({ length: DOTS }, (_, i) => {
          const kept = KEPT.indexOf(i);
          const inP = prog(
            frame,
            T.funnel + (i % COLS) * 0.8 + Math.floor(i / COLS) * 1.5,
            Q,
          );
          const o =
            kept < 0 ? 1 - 0.9 * narrow : kept < 3 ? 1 : 1 - 0.9 * three;
          return (
            <span
              key={i}
              style={{
                height: 24,
                borderRadius: 6,
                background:
                  kept >= 0 && narrow > 0.2 ? C.lime : "rgb(255 255 255 / 0.5)",
                opacity: inP * o * (kept >= 0 ? 1 : 0.55),
                scale: String(0.6 + 0.4 * inP),
              }}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 40 }}>
        {LIVE.map((r, i) => {
          const p = prog(frame, T.three + 8 + i * 5, M);
          return (
            <div
              key={r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                height: 74,
                borderTop: "1px solid rgb(255 255 255 / 0.14)",
                ...sans,
                fontSize: 34,
                color: C.paper,
                opacity: p,
                translate: `${(1 - p) * 30}px 0px`,
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
              <span style={{ flex: 1 }}>{r.name}</span>
              <span
                style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
              >
                {r.price}
              </span>
              <span
                style={{
                  color: C.lime,
                  fontSize: 28,
                  fontWeight: 600,
                  width: 170,
                  textAlign: "right",
                }}
              >
                arrives Mon
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};

/** The exception, said first: the usual boxes miss the cut-off; one-litre cartons still arrive on Monday. */
const Exception = () => {
  const frame = useCurrentFrame();
  const miss = prog(frame, T.reply + 12, M);
  const ok = prog(frame, T.reply + 24, M);
  const row = (p: number, name: string, note: string, good: boolean) => (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "22px 0", borderTop: `1.5px solid ${C.line}`, opacity: p, translate: `${(1 - p) * 24}px 0px` }}>
      <span style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: good ? C.lime : C.safety, display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 28, color: C.slab }}>{good ? "✓" : "!"}</span>
      <div>
        <div style={{ fontSize: 34, fontWeight: 650, color: C.ink }}>{name}</div>
        <div style={{ fontSize: 26, color: good ? C.good : C.notice, marginTop: 2 }}>{note}</div>
      </div>
    </div>
  );
  return (
    <div style={{ marginTop: 110, width: 700, boxSizing: "border-box", borderRadius: 32, background: C.paper, boxShadow: SHADOW.xl, borderTop: `10px solid ${C.safety}`, padding: "30px 38px 14px", ...sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: C.inkSoft }}>
        <IconTruck size={30} />
        Delivery Monday 16 Nov
      </div>
      <div style={{ ...display, fontSize: 52, color: C.ink, margin: "10px 0 18px" }}>Cut-off passed</div>
      {row(miss, "Usual 10 l boxes", "can't arrive in time", false)}
      {row(ok, "1 000 one-litre cartons", "arrive Monday", true)}
    </div>
  );
};

/** The three options as the product ranks them, and why the first wins (the option cards' own reasons). */
const RANKS = [
  {
    rank: "Best",
    what: "Valio Eila, 1 l cartons",
    why: "Cheapest by 550,00 €.",
    price: "1 010,00 €",
  },
  {
    rank: "Better",
    what: "Valio UHT, 1 l cartons",
    why: "550,00 € more.",
    price: "1 560,00 €",
  },
  {
    rank: "Good",
    what: "Arla and Valio Eila",
    why: "Lowest carbon. 564,48 € more.",
    price: "1 574,48 €",
  },
];
const Ranks = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {RANKS.map((r, i) => {
        const p = prog(frame, T.options[i] + 2, M);
        const best = i === 0;
        const win = best ? prog(frame, T.options[2] + 10, M) : 0;
        return (
          <div
            key={r.rank}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              boxSizing: "border-box",
              height: best ? 170 : 122,
              marginTop: i ? 16 : 0,
              padding: "0 28px",
              borderRadius: 26,
              background: `rgb(255 255 255 / ${0.06 + 0.06 * win})`,
              border: `2.5px solid rgb(192 224 33 / ${best ? 0.35 + 0.65 * win : 0.14})`,
              boxShadow: `0 0 ${50 * win}px -12px rgb(192 224 33 / ${0.6 * win})`,
              opacity: p,
              translate: `${(1 - p) * 40}px 0px`,
            }}
          >
            <span
              style={{
                ...display,
                width: 128,
                flexShrink: 0,
                color: best ? C.lime : "rgb(255 255 255 / 0.8)",
                fontSize: best ? 52 : 40,
              }}
            >
              {r.rank}
            </span>
            <span style={{ flex: 1, ...sans }}>
              <span
                style={{
                  display: "block",
                  fontSize: best ? 31 : 28,
                  color: C.paper,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {r.what}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 23,
                  color: "rgb(255 255 255 / 0.7)",
                  marginTop: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {r.why}
              </span>
            </span>
            <span
              style={{
                ...sans,
                fontSize: best ? 33 : 28,
                fontWeight: 700,
                color: C.paper,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {r.price}
            </span>
          </div>
        );
      })}
    </>
  );
};

/** The turning point: the order's total crossing the line the agent may not cross alone. */
const Limit = () => {
  const frame = useCurrentFrame();
  const FULL = 720;
  const SCALE = 1150;
  const total = interpolate(frame, [T.send2 + 6, T.gate + 2], [0, 1010], {
    ...clamp,
    easing: EASE_IO,
  });
  const over = prog(frame, T.gate - 6, Q);
  const mark = 500 / SCALE;
  return (
    <>
      <div
        style={{
          ...display,
          fontSize: 132,
          color: over > 0.5 ? C.safety : C.paper,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fi(Math.round(total))},00 €
      </div>
      <div style={{ position: "relative", height: 150, marginTop: 34 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 56,
            width: FULL,
            height: 44,
            borderRadius: 12,
            background: "rgb(255 255 255 / 0.1)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 56,
            width: (Math.min(total, 500) / SCALE) * FULL,
            height: 44,
            borderRadius: 12,
            background: C.lime,
          }}
        />
        {total > 500 && (
          <div
            style={{
              position: "absolute",
              left: mark * FULL,
              top: 56,
              width: ((total - 500) / SCALE) * FULL,
              height: 44,
              borderRadius: "0 12px 12px 0",
              background: `repeating-linear-gradient(135deg, ${C.safety} 0 14px, ${C.slab} 14px 28px)`,
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: mark * FULL - 2,
            top: 20,
            width: 4,
            height: 116,
            borderRadius: 2,
            background: C.paper,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: mark * FULL + 16,
            top: 108,
            ...sans,
            fontSize: 28,
            color: "rgb(255 255 255 / 0.86)",
            whiteSpace: "nowrap",
          }}
        >
          500,00 € alone
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          marginTop: 30,
          opacity: over,
          translate: `0px ${(1 - over) * 20}px`,
        }}
      >
        <GateMark size={84} />
        <span style={{ ...display, fontSize: 76, color: C.paper }}>
          The gate stops it.
        </span>
      </div>
    </>
  );
};

export const ApprovePage = () => {
  const frame = useCurrentFrame();
  const done = prog(frame, T.ok, Q);
  const press = interpolate(
    frame,
    [T.tap, T.tap + 5, T.tap + 12],
    [0, 1, 0],
    clamp,
  );
  const finger = prog(frame, T.tap - 16, Q) * fall(frame, T.tap + 8, 8);
  const face = prog(frame, T.face, Q) * fall(frame, T.ok + 4, 8);
  const scan = interpolate(frame, [T.face + 8, T.ok - 12], [0, 1], clamp);
  const checked = frame >= T.ok - 12;
  const hazard = `repeating-linear-gradient(135deg, ${C.safety} 0 10px, ${C.slab} 10px 20px)`;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        ...sans,
        color: C.ink,
        fontSize: 16,
        background: C.mist,
      }}
    >
      <div
        style={{
          height: 112,
          background: C.paper,
          borderBottom: `1px solid ${C.line}`,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 18px 14px",
          gap: 12,
        }}
      >
        <Wordmark size={28} />
        <span style={{ width: 1, height: 22, background: C.line }} />
        <span style={{ color: C.inkSoft, fontSize: 15 }}>Sign-off</span>
      </div>
      <div
        style={{
          margin: "18px 16px 0",
          borderRadius: 22,
          overflow: "hidden",
          background: C.slab,
          color: C.chalk,
        }}
      >
        <div style={{ height: 8, background: hazard, opacity: 1 - done }} />
        <div style={{ padding: "18px 20px 22px" }}>
          <div style={{ display: "grid" }}>
            <div
              style={{
                gridArea: "1 / 1",
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: 1 - done,
              }}
            >
              <GateMark size={30} />
              <span style={{ ...display, fontSize: 25, color: C.safety }}>
                Stopped at the gate
              </span>
            </div>
            <div
              style={{
                gridArea: "1 / 1",
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: done,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: C.lime,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconCheck size={19} color={C.ink} />
              </span>
              <span style={{ ...display, fontSize: 25, color: C.lime }}>
                Approved
              </span>
            </div>
          </div>
          <div
            style={{
              fontSize: 16.5,
              lineHeight: 1.4,
              marginTop: 12,
              height: 46,
            }}
          >
            {done > 0.5
              ? "Signed with this phone's passkey, bound to this exact order."
              : "Hotel Lumo kitchen's buyer agent needs your OK."}
          </div>
          <div
            style={{
              ...display,
              fontSize: 50,
              color: C.paper,
              marginTop: 14,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            1 010,00 €
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              fontSize: 15.5,
              lineHeight: 1.4,
              color: C.chalkSoft,
            }}
          >
            <IconTruck size={20} />
            <span>
              Delivery{" "}
              <span style={{ color: C.paper, fontWeight: 600 }}>
                Monday 16 November
              </span>
              , Hotel Lumo kitchen
            </span>
          </div>
        </div>
      </div>
      <div
        style={{ margin: "20px 16px 8px", color: C.inkSoft, fontSize: 14.5 }}
      >
        Why you are asked
      </div>
      <div
        style={{
          margin: "0 16px",
          borderRadius: 16,
          background: C.safetySoft,
          border: "1px solid #f3dc8a",
          padding: "14px 16px",
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontSize: 16.5,
        }}
      >
        <GateMark size={20} />
        Over this agent&apos;s 500 € per-order limit
      </div>
      <div
        style={{ margin: "20px 16px 8px", color: C.inkSoft, fontSize: 14.5 }}
      >
        The order
      </div>
      <div
        style={{
          margin: "0 16px",
          borderRadius: 18,
          background: C.paper,
          border: `1px solid ${C.line}`,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ ...display, fontSize: 24, color: C.petrolDeep }}>
            1,000 L
          </span>
          <span style={{ fontSize: 16.5, fontVariantNumeric: "tabular-nums" }}>
            1 010,00 €
          </span>
        </div>
        <div style={{ fontSize: 15.5, lineHeight: 1.4, marginTop: 6 }}>
          Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose
          free
        </div>
        <div style={{ fontSize: 14, color: C.inkSoft, marginTop: 4 }}>
          1 000 × 1 l · 1,01 €/l · price fixed by a signed quote
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 172,
          boxSizing: "border-box",
          background: C.paper,
          borderRadius: "26px 26px 0 0",
          padding: "16px 16px 0",
          boxShadow: "0 -8px 30px -12px rgb(0 54 70 / 0.25)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            top: 34,
            height: 56,
            borderRadius: 28,
            background: C.goodSoft,
            color: C.good,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontWeight: 600,
            fontSize: 17,
            opacity: done,
          }}
        >
          <IconCheck size={20} />
          Order placed at the quoted price
        </div>
        <div style={{ opacity: 1 - done }}>
          <div
            style={{
              height: 56,
              borderRadius: 28,
              background: C.lime,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              fontWeight: 600,
              fontSize: 18,
              scale: String(1 - press * 0.04),
              filter: `brightness(${1 - press * 0.1})`,
            }}
          >
            <IconFaceId size={24} />
            Approve 1 010,00 €
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              marginTop: 12,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 50,
                borderRadius: 25,
                border: `1px solid ${C.lineStrong}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              Decline
            </div>
            <span
              style={{
                color: C.petrol,
                fontWeight: 600,
                borderBottom: `1px solid ${C.petrol}`,
                marginRight: 14,
              }}
            >
              Add reason
            </span>
          </div>
        </div>
      </div>
      {finger > 0 && (
        <span
          style={{
            position: "absolute",
            left: 232,
            top: 688,
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "rgb(21 36 43 / 0.28)",
            border: "2px solid rgb(255 255 255 / 0.85)",
            boxSizing: "border-box",
            opacity: finger,
            scale: String(1.5 - 0.5 * finger - press * 0.12),
            boxShadow: "0 6px 18px rgb(0 0 0 / 0.25)",
          }}
        />
      )}
      {face > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `rgb(10 18 21 / ${0.35 * face})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 34,
              background: "rgb(28 34 38 / 0.94)",
              opacity: face,
              scale: String(0.85 + face * 0.15),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: C.paper,
            }}
          >
            {checked ? (
              <span
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  border: `4px solid ${C.lime}`,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  scale: String(0.7 + 0.3 * prog(frame, T.ok - 12, Q)),
                }}
              >
                <IconCheck size={40} color={C.lime} />
              </span>
            ) : (
              <IconFaceId
                size={78}
                color={C.paper}
                style={{
                  opacity: 0.55 + 0.45 * Math.abs(Math.sin(scan * Math.PI * 3)),
                }}
              />
            )}
            <span style={{ fontSize: 16, fontWeight: 500 }}>Face ID</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const Flow = () => {
  const frame = useCurrentFrame();
  const enter = prog(frame, 8, M);
  const z = interpolate(frame, [T.zoom, T.zoom + 44], [0, 1], {
    ...clamp,
    easing: EASE_IO,
  });
  const active =
    frame < T.send ? 0 : frame < T.type2 ? 1 : frame < T.phone ? 2 : 3;
  // The approver's phone takes the frame; the desk falls back behind it, then returns with the signed order.
  const hero = interpolate(frame, [T.phone, T.phone + 24], [0, 1], {
    ...clamp,
    easing: EASE_IO,
  });
  const back = interpolate(frame, [T.ok + 8, T.ok + 34], [0, 1], {
    ...clamp,
    easing: EASE_IO,
  });
  const away = hero * (1 - back);
  // One camera move: wide on the whole shop with a slow push, then in on the agent's panel, where it holds still.
  const wide =
    1 +
    0.03 *
      interpolate(frame, [0, T.zoom], [0, 1], { ...clamp, easing: EASE_IO });
  const s = wide + (1.7 - wide) * z;
  const tx = Math.round(240 + (90 - (W - PANEL) * 1.7 - 240) * z);
  const ty = Math.round(118 + (1040 - (H + 44) * 1.7 - 118) * z);
  const phoneScale = 1.19 - 0.17 * back;
  return (
    <AbsoluteFill>
      <Ground>
        <div
          style={{
            position: "absolute",
            inset: 0,
            perspective: 2800,
            perspectiveOrigin: "30% 50%",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "0 0",
              translate: `${tx}px ${ty + Math.round((1 - enter) * 50)}px`,
              rotate: z < 1 ? `y ${7 * (1 - z)}deg` : undefined,
              scale: String(s),
              opacity: enter,
              filter:
                away > 0.01
                  ? `blur(${7 * away}px) brightness(${1 - 0.5 * away})`
                  : undefined,
            }}
          >
            <BrowserFrame
              width={W}
              height={H}
              url="aimopilot.zeroanomaly.tech/k/hotel-lumo"
            >
              <Img
                src={staticFile("shots/hero-desktop-store.webp")}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: W,
                  height: H,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: W - PANEL,
                  height: H,
                  background: `rgb(0 40 52 / ${0.86 * z})`,
                }}
              />
              <Panel />
            </BrowserFrame>
          </div>
        </div>
        <Rail
          active={active}
          x={Math.round(interpolate(z, [0, 1], [610, 1100]))}
          opacity={enter * (1 - away)}
        />

        <Side at={T.funnel} exit={T.reply - Q}>
          <Funnel />
        </Side>
        <Side at={T.reply + 4} exit={T.options[0] - Q}>
          <Exception />
        </Side>
        <Side at={T.options[0]} exit={T.send2 - Q}>
          <Ranks />
        </Side>
        {/* One label, so the marks on every option are noticed: under the ranked cards, clear of every card. */}
        <Rise
          at={T.options[2] + 6}
          exit={T.options[2] + 58}
          y={8}
          style={{ position: "absolute", left: 1100, top: 700 }}
        >
          <div
            style={{
              ...sans,
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              height: 62,
              padding: "0 28px",
              borderRadius: 31,
              background: "rgb(255 255 255 / 0.1)",
              border: `1.5px solid rgb(192 224 33 / 0.6)`,
              color: C.paper,
              fontSize: 28,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: C.lime }} />
              ))}
            </span>
            Delivery record and CO₂ on every option
          </div>
        </Rise>
        <Side at={T.send2 + 2} exit={T.phone - 4}>
          <Limit />
        </Side>

        <div style={{ position: "absolute", inset: 0, perspective: 2400 }}>
          <div
            style={{
              position: "absolute",
              left: Math.round(1035 + 385 * back),
              top: Math.round(22 + 118 * back),
              opacity: hero,
              translate: `0px ${Math.round((1 - hero) * 160)}px`,
              rotate: hero < 1 ? `y ${-16 * (1 - hero)}deg` : undefined,
            }}
          >
            <PhoneFrame scale={phoneScale}>
              <ApprovePage />
            </PhoneFrame>
          </div>
        </div>
      </Ground>
    </AbsoluteFill>
  );
};
