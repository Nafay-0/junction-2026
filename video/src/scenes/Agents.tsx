import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, EASE, fall, Grow, prog, Rise } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { Agent, B, Buyer, DishRow, GateMark, Ground, IconMic, PhoneFrame, Say, ThreadLine } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("agents", phrase, shift);
const T = {
  planner: 4,
  have: c("what you have", -2),
  order: c("have", 14),
  cannot: c("can't get", -6),
  watch: c("A watch", -6),
  seller: c("A seller", -6),
  voice: c("Hands-free", -6),
  outside: c("Outside agents", -6),
  meet: c("They only", -8),
};

const TEAM = [
  { name: "Buying agent" },
  { name: "Menu planner" },
  { name: "Kitchen watch" },
  { name: "Selling agent" },
  { name: "Hands-free voice" },
  { name: "Outside agents" },
  { name: "Operations copilot" },
];
const activeAt = (frame: number) => (frame >= T.meet ? -1 : frame >= T.outside ? 5 : frame >= T.voice ? 4 : frame >= T.seller ? 3 : frame >= T.watch ? 2 : 1);

const Team = () => {
  const frame = useCurrentFrame();
  const active = activeAt(frame);
  return (
    <div style={{ position: "absolute", left: 1220, top: 160, width: 620 }}>
      {TEAM.map((t, i) => {
        const on = active === i || active === -1;
        const seen = i === 0 || (active > i && active !== -1);
        const p = prog(frame, 6 + i * 4, 16);
        return (
          <div key={t.name} style={{ position: "relative", padding: "22px 0 22px 58px", borderTop: i ? "1px solid rgb(255 255 255 / 0.12)" : "none", opacity: p }}>
            <span style={{ position: "absolute", left: 6, top: 38, width: 24, height: 24, borderRadius: "50%", boxSizing: "border-box", background: on ? C.lime : "transparent", border: `3px solid ${on ? C.lime : seen ? "rgb(192 224 33 / 0.55)" : "rgb(255 255 255 / 0.3)"}` }} />
            <div style={{ ...display, fontSize: 52, color: on ? C.paper : seen ? "rgb(255 255 255 / 0.62)" : "rgb(255 255 255 / 0.4)" }}>{t.name}</div>
          </div>
        );
      })}
    </div>
  );
};

/** One vignette on the left: in at `at`, out at `exit`. */
const Stage = ({ at, exit, children, tall = false }: { at: number; exit: number; children: ReactNode; tall?: boolean }) => {
  const frame = useCurrentFrame();
  if (frame < at - 2 || frame > exit + 12) return null;
  const p = prog(frame, at, 16);
  const o = p * fall(frame, exit, 10);
  const mask = tall ? "linear-gradient(to bottom, #000 78%, transparent 99%)" : undefined;
  return <div style={{ position: "absolute", left: 90, top: 96, width: 1070, height: 900, display: "flex", alignItems: tall ? "flex-start" : "center", justifyContent: "center", overflow: tall ? "hidden" : "visible", maskImage: mask, WebkitMaskImage: mask, opacity: o, translate: `0px ${(1 - p) * 40}px` }}>{children}</div>;
};

const Card = ({ children, width = 1040, dark = false }: { children: ReactNode; width?: number; dark?: boolean }) => (
  <div style={{ width, boxSizing: "border-box", borderRadius: 30, background: dark ? C.slab : C.mist, boxShadow: SHADOW.xl, padding: "34px 40px", ...sans }}>{children}</div>
);

const Planner = () => (
  <Card>
    <ThreadLine style={{ fontSize: 30 }}>
      <Buyer>I have a big lunch next week: a dish for 20 people</Buyer>
      <Agent>
        <Say style={{ maxWidth: "none" }}>
          I can buy <B>5 of the 7</B> ingredients for this kitchen (42,07 € for those).
        </Say>
        <div style={{ ...display, fontSize: "1.18em", marginTop: "0.7em", color: C.ink }}>Savoury cheese and bread bake</div>
        <Grow at={T.have} dur={12}>
          <DishRow label="You have">ground nutmeg, salt, black pepper, wheat flour (staples you keep)</DishRow>
        </Grow>
        <Grow at={T.order} dur={12}>
          <DishRow label="I'll order">hard cheese 1,2 kg, cream 800 ml, eggs 1,25 kg, butter 160 g, mustard 80 g</DishRow>
        </Grow>
        <Grow at={T.cannot} dur={12}>
          <DishRow label="Can't get">
            white bread 2,3 kg <span style={{ color: C.notice, fontStyle: "italic" }}>(cannot arrive by Tue 17 Nov)</span>, whole milk 2,2 l <span style={{ color: C.notice, fontStyle: "italic" }}>(cannot arrive by Tue 17 Nov)</span>
          </DishRow>
        </Grow>
      </Agent>
    </ThreadLine>
  </Card>
);

const Shot = ({ src }: { src: string }) => (
  <PhoneFrame scale={1.36} style={{ marginTop: 14 }}>
    <Img src={staticFile(src)} style={{ width: 390, height: 844 }} />
  </PhoneFrame>
);

const Voice = () => {
  const frame = useCurrentFrame();
  const t = frame - T.voice;
  return (
    <Card width={1040}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 26 }}>
        <div style={{ height: 64, padding: "0 26px", borderRadius: 32, background: C.lavenderDeep, color: C.paper, display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600 }}>
          <IconMic size={28} />
          {t < 22 ? "Hearing you" : "Agent speaking"}
        </div>
        <div style={{ flex: 1, height: 64, display: "flex", alignItems: "center", gap: 7 }}>
          {Array.from({ length: 34 }, (_, i) => {
            const h = 10 + 46 * Math.abs(Math.sin(t * 0.42 + i * 0.7) * Math.sin(t * 0.17 + i * 0.31));
            return <span key={i} style={{ flex: 1, height: h, borderRadius: 4, background: t < 22 ? C.petrol : C.lavenderDeep, opacity: 0.85 }} />;
          })}
        </div>
      </div>
      <ThreadLine style={{ fontSize: 31 }}>
        <Buyer spoken>Ten litres of lactose-free whipping cream for Thursday</Buyer>
        <Grow at={T.voice + 16} dur={12}>
          <Agent>
            <Say style={{ maxWidth: "none" }}>
              10 Valio Eila lactose-free whipping cream, that&apos;s 10 litres, for Thursday: <B>52 euros</B>. Shall I order it?
            </Say>
          </Agent>
        </Grow>
      </ThreadLine>
    </Card>
  );
};

const CALLS = [
  { dir: "→", text: "POST /api/mcp", note: "mandate: a signed JWS" },
  { dir: "→", text: "find_products", note: "lactose-free milk, 1 000 l" },
  { dir: "→", text: "check_availability", note: "only the candidates" },
  { dir: "→", text: "request_quote", note: "fixed price, signed" },
  { dir: "→", text: "place_order", note: "" },
  { dir: "←", text: "waiting for a person's sign-off", note: "the same gate" },
];
const Outside = () => {
  const frame = useCurrentFrame();
  return (
    <Card width={1040} dark>
      <div style={{ display: "flex", gap: 12, marginBottom: 26 }}>
        {["MCP", "REST and OpenAPI", "an agent on Aiven Managed Agents"].map((x) => (
          <span key={x} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: "rgb(255 255 255 / 0.1)", color: C.chalk, display: "flex", alignItems: "center", fontSize: 24, fontWeight: 600 }}>
            {x}
          </span>
        ))}
      </div>
      {CALLS.map((l, i) => {
        const p = prog(frame, T.outside + 8 + i * 8, 10);
        const back = l.dir === "←";
        return (
          <div key={l.text} style={{ display: "flex", alignItems: "baseline", gap: 18, padding: "9px 0", opacity: p, translate: `${(1 - p) * 24}px 0px`, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 34 }}>
            <span style={{ color: back ? C.safety : C.lime, width: 30 }}>{l.dir}</span>
            <span style={{ color: back ? C.safety : C.paper }}>{l.text}</span>
            <span style={{ ...sans, fontSize: 27, color: C.chalkSoft }}>{l.note}</span>
          </div>
        );
      })}
    </Card>
  );
};

const Meet = () => {
  const frame = useCurrentFrame();
  const p = prog(frame, T.meet, 18);
  if (frame < T.meet - 2) return null;
  const names = TEAM.map((t) => t.name);
  return (
    <div style={{ position: "absolute", left: 90, top: 70, width: 1040, height: 880, opacity: p }}>
      <svg width={1040} height={880} style={{ position: "absolute", inset: 0 }}>
        {names.map((_, i) => {
          const y = 96 + i * 104;
          const d = interpolate(frame, [T.meet + 4 + i * 2, T.meet + 26 + i * 2], [0, 1], { ...clamp, easing: EASE });
          return <path key={i} d={`M 330 ${y} C 520 ${y}, 560 440, 700 440`} fill="none" stroke={C.lime} strokeWidth={3} strokeOpacity={0.75} strokeDasharray={520} strokeDashoffset={520 * (1 - d)} />;
        })}
      </svg>
      {names.map((n, i) => (
        <div key={n} style={{ position: "absolute", left: 0, top: 96 + i * 104 - 32, width: 330, height: 64, boxSizing: "border-box", borderRadius: 32, background: "rgb(255 255 255 / 0.09)", border: "1.5px solid rgb(255 255 255 / 0.2)", color: C.paper, display: "flex", alignItems: "center", padding: "0 26px", ...sans, fontSize: 28, fontWeight: 600 }}>{n}</div>
      ))}
      <div style={{ position: "absolute", left: 700, top: 300, width: 330, height: 280, boxSizing: "border-box", borderRadius: 30, background: C.slab, boxShadow: SHADOW.xl, border: `2px solid ${C.safety}`, padding: 30, scale: String(0.9 + p * 0.1) }}>
        <GateMark size={64} />
        <div style={{ ...display, fontSize: 60, color: C.safety, marginTop: 18 }}>The gate</div>
        <div style={{ ...sans, fontSize: 26, color: C.chalkSoft, marginTop: 8 }}>one gate, one ledger</div>
      </div>
    </div>
  );
};

/** The agents, one after another as each is named, and the one place they meet. */
export const Agents = () => (
  <AbsoluteFill>
    <Ground>
      <Rise at={2} style={{ position: "absolute", left: 1220, top: 86, ...sans, fontSize: 32, fontWeight: 600, color: C.lime }}>
        Around the gate works a team
      </Rise>
      <Team />
      <Stage at={T.planner} exit={T.watch - 8}>
        <Planner />
      </Stage>
      <Stage at={T.watch} exit={T.seller - 8} tall>
        <Shot src="shots/agent-watch.webp" />
      </Stage>
      <Stage at={T.seller} exit={T.voice - 8} tall>
        <Shot src="shots/agent-seller-phone.webp" />
      </Stage>
      <Stage at={T.voice} exit={T.outside - 8}>
        <Voice />
      </Stage>
      <Stage at={T.outside} exit={T.meet - 8}>
        <Outside />
      </Stage>
      <Meet />
      <Rise at={T.meet + 10} style={{ position: "absolute", left: 90, top: 905, width: 1040, ...display, fontSize: 64, color: C.paper, textAlign: "center" }}>
        They only meet at the gate.
      </Rise>
    </Ground>
  </AbsoluteFill>
);
