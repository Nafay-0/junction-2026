import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, Count, EASE, EASE_IO, fall, fi, Grow, prog, Rise, Shrink, Typed } from "../anim";
import { C, display, sans } from "../theme";
import { D as LEN } from "../timing";
import { cue } from "../vo";
import { Agent, B, BrowserFrame, Buyer, Composer, D, GateMark, Ground, IconCheck, IconFaceId, IconTruck, IconX, OptionRow, PhoneFrame, Say, SignedSlab, SignOffSlab, StepRow, StepsBox, StepsToggle, ThreadLine, Wordmark } from "../ui";

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
const T = {
  type: 34,
  zoom: c("Monday", 8),
  send: c("Monday", 16),
  work: c("Monday", 24),
  steps: [c("The agent", 2), c("The agent", 12), c("searches", 6), c("asks a live"), c("just three", 14)],
  stat1: c("seventeen"),
  stat2: c("just three", -4),
  reply: c("The usual boxes", -2),
  options: [c("offers"), c("offers", 11), c("offers", 22)],
  type2: c("It's over", -18),
  send2: c("It's over"),
  work2: c("It's over", 6),
  steps2: [c("It's over", 10), c("It's over", 20)],
  gate: c("limit", 4),
  slab: c("limit", 12),
  phone: c("a person", -8),
  tap: c("One passkey", 4),
  face: c("One passkey", 12),
  ok: c("placed", 2),
  placed: c("placed", 12),
};

const REQUEST = "I need 1,000 litres of lactose-free milk by Monday";

const Working = ({ label }: { label: string }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "inline-block", fontSize: "0.9em", fontWeight: 500, backgroundImage: `linear-gradient(100deg, ${C.petrol} 0%, ${C.petrol} 38%, #8fd0e0 50%, ${C.petrol} 62%, ${C.petrol} 100%)`, backgroundSize: "220% 100%", backgroundPosition: `${120 - ((frame * 5) % 240)}% 0`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
      {label}
    </div>
  );
};

const Thread = () => {
  const frame = useCurrentFrame();
  const pulse = (frame % 30) / 30;
  const label = frame < T.steps[2] ? "Reading your request" : frame < T.steps[3] ? "Checking against your history and the assortment" : "Checking live prices and the delivery day";
  return (
    <ThreadLine style={{ flexShrink: 0, minHeight: "100%", boxSizing: "border-box", paddingTop: 16, paddingBottom: 10, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <Agent>
        <div style={{ ...display, fontSize: "1.7em", marginBottom: "0.25em" }}>Good evening.</div>
        <Say>Nothing needs you today.</Say>
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
              I found three ways to get the <B>1 000 L</B> of lactose-free milk to you by <D>Monday 16 Nov</D>. Your usual 10 l boxes can&apos;t arrive in time, so it would come as <B>1 000 one-litre cartons</B>. Which one?
            </Say>
          </Grow>
          <Grow at={T.options[0]}>
            <OptionRow title="Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free" price="1 010,00 €" sub="1,01 €/l · Mon 16 Nov" />
          </Grow>
          <Grow at={T.options[1]}>
            <OptionRow title="Valio semi skimmed milk 1 l lactose free UHT" price="1 560,00 €" sub="1,56 €/l · Mon 16 Nov · 550,00 € more" />
          </Grow>
          <Grow at={T.options[2]}>
            <OptionRow title="Arla Semi skimmed milkdrink + Valio Arki Eila semi" price="1 574,48 €" sub="2,48 €/l · Mon 16 Nov · Lowest carbon, 564,48 € more" />
          </Grow>
          <Grow at={T.options[2] + 12}>
            <div style={{ fontSize: "0.84em", color: C.inkSoft, marginTop: "0.7em" }}>or just tell me</div>
          </Grow>
          <Shrink at={T.reply - 4} dur={16}>
            <StepsBox>
              <Grow at={T.steps[0]} dur={12}>
                <StepRow head="Read your request" rest="1 000 L, lactose-free milk, Mon 16 Nov" />
              </Grow>
              <Grow at={T.steps[1]} dur={12}>
                <StepRow head="Looked at your history" rest="Always lactose-free: many breakfast guests ask for it, as always (Kitchen manager, Tue 27.10.)" />
              </Grow>
              <Grow at={T.steps[2]} dur={12}>
                <StepRow head="Searched the assortment" rest="Valio Hyvä suomalainen Arki® Eila® 1 l · Valio semi skimmed 1 l UHT · Arla + Valio Arki Eila" />
              </Grow>
              <Grow at={T.steps[3]} dur={12}>
                <StepRow head="Checked live price and delivery for 3" rest="All can arrive Mon 16 Nov. The cheapest is 1 010,00 €." />
              </Grow>
              <Grow at={T.steps[4]} dur={12}>
                <StepRow head="Left out 17 products" rest="The order cut-off for that day has passed (6); a different kind of product than asked (11)" />
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
              1000 × Valio Hyvä suomalainen Arki for <B>1 010,00 €</B> is over the <B>500,00 €</B> I may spend alone, so it needs the kitchen manager&apos;s OK.
            </Say>
          </Grow>
          <Grow at={T.placed}>
            <Say style={{ marginTop: "0.5em" }}>
              The Kitchen manager OK&apos;d it, and the order is placed: <B>1 000 one-litre cartons</B> of Valio Eila lactose-free milk for <B>1 010,00 €</B>, arriving <D>Monday 16 Nov</D>.
            </Say>
          </Grow>
          <Grow at={T.slab} dur={20}>
            {frame < T.ok + 6 ? <SignOffSlab /> : <SignedSlab />}
          </Grow>
          <Shrink at={T.gate - 4} dur={14}>
            <StepsBox>
              <Grow at={T.steps2[0]} dur={10}>
                <StepRow head="Price held until 21.13" rest="Signed by the wholesaler: anyone can check it against their published key." />
              </Grow>
              <Grow at={T.steps2[1]} dur={10}>
                <StepRow head="Checked your rules" rest="1 010,00 € is over the 500,00 € the agent may spend alone." />
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
    <div style={{ position: "absolute", left: W - PANEL, top: 0, width: PANEL, height: H, background: C.mist, borderLeft: `1px solid ${C.line}`, display: "flex", flexDirection: "column", fontSize: 16, ...sans }}>
      <div style={{ height: 70, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 22px", gap: 10, color: C.inkSoft, fontSize: 14 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.petrol }} />
        <span style={{ color: C.ink }}>Your buying agent</span>
        <span style={{ marginLeft: "auto" }}>Hotel Lumo kitchen</span>
        <span style={{ color: C.petrol, fontWeight: 600, borderBottom: `1px solid ${C.petrol}` }}>Start over</span>
        <IconX size={16} color={C.inkSoft} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 26px 0 30px" }}>
        <Thread />
      </div>
      <div style={{ flexShrink: 0, padding: "8px 14px 16px" }}>
        <Composer focus={typing1 || typing2}>{typing1 ? <Typed text={REQUEST} at={T.type} perFrame={0.6} /> : typing2 ? <Typed text="the first one" at={T.type2} perFrame={0.85} /> : undefined}</Composer>
      </div>
    </div>
  );
};

const STAGES = ["Request", "Lookup", "Order", "Approval"];
const Rail = ({ active, x }: { active: number; x: number }) => (
  <div style={{ position: "absolute", left: x, top: 66, display: "flex", gap: 10, ...sans }}>
    {STAGES.map((s, i) => (
      <div key={s} style={{ height: 52, padding: "0 26px", borderRadius: 26, display: "flex", alignItems: "center", gap: 10, fontSize: 26, fontWeight: 600, background: i === active ? C.lime : "rgb(255 255 255 / 0.09)", color: i === active ? C.ink : i < active ? "rgb(255 255 255 / 0.85)" : "rgb(255 255 255 / 0.5)" }}>
        {i < active && <IconCheck size={22} color={C.lime} />}
        {s}
      </div>
    ))}
  </div>
);

const Callout = ({ at, exit, children }: { at: number; exit: number; children: ReactNode }) => (
  <Rise at={at} exit={exit} style={{ position: "absolute", left: 1100, top: 210, width: 740 }}>
    {children}
  </Rise>
);

const Stat = ({ at, value, label }: { at: number; value: ReactNode; label: string }) => (
  <Rise at={at} style={{ display: "flex", alignItems: "baseline", gap: 30, marginBottom: 46 }}>
    <div style={{ ...display, fontSize: 168, color: C.lime, fontVariantNumeric: "tabular-nums", minWidth: 150 }}>{value}</div>
    <div style={{ ...sans, fontSize: 40, lineHeight: 1.25, color: "rgb(255 255 255 / 0.86)", maxWidth: 420 }}>{label}</div>
  </Rise>
);

const Rank = ({ at, rank, what, price }: { at: number; rank: string; what: string; price: string }) => (
  <Rise at={at} y={16} style={{ display: "flex", alignItems: "center", gap: 22, padding: "16px 0", borderTop: "1px solid rgb(255 255 255 / 0.14)", ...sans, fontSize: 32, color: C.paper }}>
    <span style={{ ...display, width: 132, color: C.lime, fontSize: 34 }}>{rank}</span>
    <span style={{ flex: 1, color: "rgb(255 255 255 / 0.86)", fontSize: 30, whiteSpace: "nowrap" }}>{what}</span>
    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{price}</span>
  </Rise>
);

const ApprovePage = () => {
  const frame = useCurrentFrame();
  const done = frame >= T.ok;
  const press = interpolate(frame, [T.tap, T.tap + 5, T.tap + 12], [0, 1, 0], clamp);
  const ripple = interpolate(frame, [T.tap, T.tap + 16], [0, 1], clamp);
  const face = prog(frame, T.face, 10) * fall(frame, T.ok + 4, 8);
  const finger = prog(frame, T.tap - 14, 10) * fall(frame, T.tap + 8, 8);
  const scan = interpolate(frame, [T.face + 8, T.ok - 12], [0, 1], clamp);
  const checked = frame >= T.ok - 12;
  const hazard = `repeating-linear-gradient(135deg, ${C.safety} 0 10px, ${C.slab} 10px 20px)`;
  return (
    <div style={{ position: "absolute", inset: 0, ...sans, color: C.ink, fontSize: 16, background: C.mist }}>
      <div style={{ height: 112, background: C.paper, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "flex-end", padding: "0 18px 14px", gap: 12 }}>
        <Wordmark size={28} />
        <span style={{ width: 1, height: 22, background: C.line }} />
        <span style={{ color: C.inkSoft, fontSize: 15 }}>Sign-off</span>
      </div>
      <div style={{ margin: "18px 16px 0", borderRadius: 22, overflow: "hidden", background: C.slab, color: C.chalk }}>
        {!done && <div style={{ height: 8, background: hazard }} />}
        <div style={{ padding: "18px 20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {done ? (
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: C.lime, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconCheck size={19} color={C.ink} />
              </span>
            ) : (
              <GateMark size={30} />
            )}
            <span style={{ ...display, fontSize: 25, color: done ? C.lime : C.safety }}>{done ? "Approved" : "Stopped at the gate"}</span>
          </div>
          <div style={{ fontSize: 16.5, lineHeight: 1.4, marginTop: 12 }}>{done ? "Signed with this phone's passkey, bound to this exact order." : "Hotel Lumo kitchen's buyer agent needs your OK."}</div>
          <div style={{ ...display, fontSize: 50, color: C.paper, marginTop: 14, fontVariantNumeric: "tabular-nums" }}>1 010,00 €</div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, fontSize: 15.5, lineHeight: 1.4, color: C.chalkSoft }}>
            <IconTruck size={20} />
            <span>
              Delivery <span style={{ color: C.paper, fontWeight: 600 }}>Monday 16 November</span>, Hotel Lumo kitchen
            </span>
          </div>
        </div>
      </div>
      <div style={{ margin: "20px 16px 8px", color: C.inkSoft, fontSize: 14.5 }}>Why you are asked</div>
      <div style={{ margin: "0 16px", borderRadius: 16, background: C.safetySoft, border: `1px solid #f3dc8a`, padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", fontSize: 16.5 }}>
        <GateMark size={20} />
        Over this agent&apos;s 500 € per-order limit
      </div>
      <div style={{ margin: "20px 16px 8px", color: C.inkSoft, fontSize: 14.5 }}>The order</div>
      <div style={{ margin: "0 16px", borderRadius: 18, background: C.paper, border: `1px solid ${C.line}`, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ ...display, fontSize: 24, color: C.petrolDeep }}>1,000 L</span>
          <span style={{ fontSize: 16.5, fontVariantNumeric: "tabular-nums" }}>1 010,00 €</span>
        </div>
        <div style={{ fontSize: 15.5, lineHeight: 1.4, marginTop: 6 }}>Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free</div>
        <div style={{ fontSize: 14, color: C.inkSoft, marginTop: 4 }}>1 000 × 1 l · 1,01 €/l · price fixed by a signed quote</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paper, borderRadius: "26px 26px 0 0", padding: "16px 16px 34px", boxShadow: "0 -8px 30px -12px rgb(0 54 70 / 0.25)" }}>
        {done ? (
          <div style={{ height: 56, borderRadius: 28, background: C.goodSoft, color: C.good, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontWeight: 600, fontSize: 17 }}>
            <IconCheck size={20} />
            Order placed at the quoted price
          </div>
        ) : (
          <>
            <div style={{ position: "relative", height: 56, borderRadius: 28, background: C.lime, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontWeight: 600, fontSize: 18, scale: String(1 - press * 0.04), filter: `brightness(${1 - press * 0.1})`, overflow: "hidden" }}>
              <IconFaceId size={24} />
              Approve 1 010,00 €
              {ripple > 0 && ripple < 1 && <span style={{ position: "absolute", left: "50%", top: "50%", width: 40, height: 40, margin: -20, borderRadius: "50%", background: "rgb(21 36 43 / 0.25)", scale: String(1 + ripple * 6), opacity: 1 - ripple }} />}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
              <div style={{ flex: 1, height: 50, borderRadius: 25, border: `1px solid ${C.lineStrong}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 16 }}>Decline</div>
              <span style={{ color: C.petrol, fontWeight: 600, borderBottom: `1px solid ${C.petrol}`, marginRight: 14 }}>Add reason</span>
            </div>
          </>
        )}
      </div>
      {finger > 0 && <span style={{ position: "absolute", left: 232, top: 700, width: 58, height: 58, borderRadius: "50%", background: "rgb(21 36 43 / 0.28)", border: "2px solid rgb(255 255 255 / 0.85)", boxSizing: "border-box", opacity: finger, scale: String(1.5 - 0.5 * finger - press * 0.12), boxShadow: "0 6px 18px rgb(0 0 0 / 0.25)" }} />}
      {face > 0 && (
        <div style={{ position: "absolute", inset: 0, background: `rgb(10 18 21 / ${0.35 * face})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 168, height: 168, borderRadius: 34, background: "rgb(28 34 38 / 0.94)", opacity: face, scale: String(0.85 + face * 0.15), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.paper }}>
            {checked ? (
              <span style={{ width: 72, height: 72, borderRadius: "50%", border: `4px solid ${C.lime}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconCheck size={40} color={C.lime} />
              </span>
            ) : (
              <IconFaceId size={78} color={C.paper} style={{ opacity: 0.55 + 0.45 * Math.abs(Math.sin(scan * Math.PI * 3)) }} />
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
  const z = interpolate(frame, [T.zoom, T.zoom + 44], [0, 1], { ...clamp, easing: EASE_IO });
  const enter = prog(frame, 0, 16);
  const active = frame < T.send ? 0 : frame < T.type2 ? 1 : frame < T.phone ? 2 : 3;
  const phoneIn = interpolate(frame, [T.phone, T.phone + 22], [0, 1], { ...clamp, easing: EASE });
  // The camera: wide on the whole shop, then pushed in on the agent's panel, still drifting closer.
  const close = 1.7 + interpolate(frame, [T.zoom + 44, LEN.flow], [0, 0.05], clamp);
  const s = 1 + (close - 1) * z + (1 - z) * interpolate(frame, [0, T.zoom], [0, 0.02], clamp);
  const tx = 240 + (90 - (W - PANEL) * close - 240) * z;
  const ty = 118 + (1040 - (H + 44) * close - 118) * z;
  return (
    <AbsoluteFill>
      <Ground>
        <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", translate: `${tx}px ${ty + (1 - enter) * 50}px`, scale: String(s), opacity: enter }}>
          <BrowserFrame width={W} height={H} url="aimopilot.zeroanomaly.tech/k/hotel-lumo">
            <Img src={staticFile("shots/hero-desktop-store.webp")} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
            <div style={{ position: "absolute", left: 0, top: 0, width: W - PANEL, height: H, background: `rgb(0 40 52 / ${0.86 * z})` }} />
            <Panel />
          </BrowserFrame>
        </div>
        <Rail active={active} x={interpolate(z, [0, 1], [610, 1100])} />

        <Callout at={T.stat1 - 6} exit={T.reply - 8}>
          <Stat at={T.stat1 - 2} value={<Count to={17546} at={T.stat1 - 2} dur={30} format={fi} />} label="" />
          <Rise at={T.stat1 + 6} style={{ ...sans, fontSize: 42, color: "rgb(255 255 255 / 0.86)", marginTop: -34, marginBottom: 60 }}>
            products searched by meaning
          </Rise>
          <Stat at={T.stat2} value="3" label="live prices asked. Only for the candidates." />
        </Callout>

        <Callout at={T.reply + 6} exit={T.type2 + 4}>
          <div style={{ ...display, fontSize: 76, color: C.paper, marginBottom: 40 }}>It says the exception first.</div>
          <Rank at={T.options[0] + 4} rank="Best" what="Valio Eila, 1 l cartons" price="1 010,00 €" />
          <Rank at={T.options[1] + 4} rank="Better" what="Valio UHT, 1 l cartons" price="1 560,00 €" />
          <Rank at={T.options[2] + 4} rank="Good" what="Arla and Valio, lowest carbon" price="1 574,48 €" />
        </Callout>

        <Callout at={T.send2 + 4} exit={T.phone}>
          <div style={{ ...display, fontSize: 84, color: C.paper }}>Over its 500,00 € limit.</div>
          <div style={{ ...sans, fontSize: 42, color: "rgb(255 255 255 / 0.8)", marginTop: 24 }}>Plain code stops the order.</div>
        </Callout>

        <div style={{ position: "absolute", left: 1400, top: 138, opacity: phoneIn, translate: `${(1 - phoneIn) * 220}px 0px` }}>
          <PhoneFrame scale={1.04}>
            <ApprovePage />
          </PhoneFrame>
        </div>
        <Rise at={T.phone + 12} exit={T.ok} style={{ position: "absolute", left: 1062, top: 400, width: 300 }}>
          <div style={{ ...display, fontSize: 50, color: C.paper }}>A named person signs.</div>
          <div style={{ ...sans, fontSize: 31, lineHeight: 1.35, color: "rgb(255 255 255 / 0.78)", marginTop: 18 }}>Their own phone, their passkey.</div>
        </Rise>
        <Rise at={T.ok + 6} style={{ position: "absolute", left: 1062, top: 400, width: 300 }}>
          <div style={{ ...display, fontSize: 50, color: C.lime }}>Signed and placed.</div>
          <div style={{ ...sans, fontSize: 31, lineHeight: 1.35, color: "rgb(255 255 255 / 0.78)", marginTop: 18 }}>At the quoted price.</div>
        </Rise>
      </Ground>
    </AbsoluteFill>
  );
};
