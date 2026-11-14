import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Grow, prog, Rise } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Agent, B, Buyer, Ground, Say, ThreadLine } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("memory", phrase, shift);
const T = { notes: c("remembers", -4), ask: c("So it catches", -6), reply: c("four thousand", 4), only: c("and asks", -4), mail: c("and asks", 8), time: c("and asks", 14) };

/** What the kitchen's agent remembers, in the product's own words (reel-thread.json, attacks.json). */
const NOTES = ["Always lactose-free", "Semi-skimmed 1.5 %, as usual", "Milk: about 400 L an order"];

export const Memory = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", left: 100, top: 120, width: 900, boxSizing: "border-box", borderRadius: 30, background: C.mist, boxShadow: SHADOW.xl, padding: "34px 40px 40px", ...sans }}>
          <div style={{ fontSize: 24, color: C.inkSoft, marginBottom: 14 }}>What this kitchen&apos;s agent remembers</div>
          {NOTES.map((n, i) => {
            const p = prog(frame, T.notes + i * 9, 14);
            return (
              <div key={n} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 20px", marginTop: 10, borderRadius: 18, background: C.lavender, color: C.lavenderDeep, fontSize: 26, lineHeight: 1.35, fontWeight: 500, opacity: p, translate: `${(1 - p) * 30}px 0px` }}>
                <span style={{ width: 12, height: 12, marginTop: 12, borderRadius: "50%", background: C.lavenderDeep, flexShrink: 0 }} />
                {n}
              </div>
            );
          })}
          <ThreadLine style={{ fontSize: 26, marginTop: 26 }}>
            <Grow at={T.ask}>
              <Buyer>4 000 litres of lactose-free milk for Friday</Buyer>
            </Grow>
            <Grow at={T.reply}>
              <Agent>
                <Say style={{ maxWidth: "none" }}>
                  <B>4,000 L</B> where you usually order about <B>400 L</B>: did you mean 400 L?
                </Say>
                <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                  <span style={{ height: 54, padding: "0 24px", borderRadius: 27, background: C.petrolDeep, color: C.paper, display: "flex", alignItems: "center", fontSize: 23, fontWeight: 600 }}>Yes, 400 L</span>
                  <span style={{ height: 54, padding: "0 24px", borderRadius: 27, border: `1.5px solid ${C.lineStrong}`, color: C.ink, display: "flex", alignItems: "center", fontSize: 23, fontWeight: 600 }}>Yes, as I said</span>
                </div>
              </Agent>
            </Grow>
          </ThreadLine>
        </div>

        <div style={{ position: "absolute", left: 1090, top: 150, width: 740 }}>
          <Rise at={6} style={{ ...display, fontSize: 92, color: C.paper }}>
            It remembers how each kitchen buys.
          </Rise>
          <Rise at={T.only} style={{ ...sans, fontSize: 50, lineHeight: 1.3, color: C.lime, marginTop: 34 }}>
            It asks only when it matters.
          </Rise>
        </div>
        <Rise at={T.mail} style={{ position: "absolute", left: 1090, top: 690, width: 350, height: 300, borderRadius: 24, overflow: "hidden", background: C.paper, boxShadow: SHADOW.lg }}>
          <Img src={staticFile("shots/mail-receipt.webp")} style={{ width: 350 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "34px 22px 18px", background: "linear-gradient(to top, rgb(0 54 70 / 0.96) 55%, rgb(0 54 70 / 0))", color: C.paper, ...sans, fontSize: 27, fontWeight: 600 }}>Receipts and alerts by email</div>
        </Rise>
        <Rise at={T.time} style={{ position: "absolute", left: 1470, top: 690, width: 360, height: 300, boxSizing: "border-box", borderRadius: 24, background: "rgb(255 255 255 / 0.08)", border: "1.5px solid rgb(255 255 255 / 0.18)", padding: "28px 28px", ...sans, color: C.paper }}>
          <div style={{ ...display, fontSize: 44 }}>Time machine</div>
          <div style={{ fontSize: 26, lineHeight: 1.3, color: "rgb(255 255 255 / 0.76)", marginTop: 10 }}>Replay any moment.</div>
          <div style={{ position: "relative", height: 6, borderRadius: 3, background: "rgb(255 255 255 / 0.2)", marginTop: 34 }}>
            <span style={{ position: "absolute", top: -9, left: `${20 + 55 * prog(frame, T.time + 6, 40)}%`, width: 24, height: 24, borderRadius: "50%", background: C.lime }} />
          </div>
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
