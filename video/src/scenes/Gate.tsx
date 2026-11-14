import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, fall, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { GateMark, Ground, IconCheck } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("gate", phrase, shift);
const T = {
  pipe: c("Twenty rules", -8),
  rules: c("rules"),
  rulesEnd: c("order", 16),
  tried: c("We tried", -8),
  rows: [c("forged", -4), c("replayed", -4), c("an agent approving", -4), c("itself", 14), c("itself", 19), c("itself", 24), c("itself", 29)],
  tally: c("All stopped", 2),
  ledger: c("tamper-evident", -16),
};

/** The five stations every order passes (web/src/app/_landing2/landing2.text.ts). */
const STATIONS = [
  { name: "Mandate", who: "signed by the buyer" },
  { name: "Quote", who: "signed by the wholesaler" },
  { name: "Gate", who: "plain code, 20 rules" },
  { name: "Sign-off", who: "a named person's passkey" },
  { name: "Ledger", who: "hash-chained, verifiable" },
];

/** The gate's rules, in its own order (web/src/core/policy.ts RULES). */
const RULES = ["mandate_agent", "mandate_window", "quote_binding", "quote_expiry", "quote_replay", "order_matches_quote", "category_allowed", "required_attributes", "forbidden_allergens", "nutrition_rules", "required_certificates", "recall_hold", "delivery_deadline", "substitution_rule", "substitute_price", "weekly_budget", "per_order_limit", "order_splitting", "human_confirmation", "approver_authority"];

/** The recorded attempts (web/src/server/show/recordings/attacks.json), each with the gate's own answer. */
const ATTACKS = [
  { title: "A forged mandate", how: "Refused" },
  { title: "A replayed fixed price", how: "Refused" },
  { title: "The agent approves its own order", how: "Refused" },
  { title: "One need, split to dodge the limit", how: "To a person" },
  { title: "Ten times too much", how: "Stopped" },
  { title: "“The chef said yes”", how: "To a person" },
  { title: "Suspended by the wholesaler", how: "Refused" },
];

/** A real SHA-256 chain over these five labels: each entry carries the hash of the one before. */
const CHAIN = [
  { label: "request", hash: "8259a448…7281" },
  { label: "quote signed", hash: "96a5c12f…b17f" },
  { label: "gate decision", hash: "4448bec4…bc69" },
  { label: "sign-off, passkey", hash: "469b5e71…0fa3" },
  { label: "order placed", hash: "fa63b6cc…535d" },
];

const Pipeline = () => {
  const frame = useCurrentFrame();
  const out = fall(frame, T.tried, 12);
  const travel = interpolate(frame, [T.pipe + 14, T.rulesEnd + 6], [0, 4], { ...clamp, easing: EASE });
  const W = 310;
  const GAP = 34;
  const x0 = 117;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <div style={{ position: "absolute", left: x0 + W / 2, top: 404, width: 4 * (W + GAP), height: 3, background: "rgb(255 255 255 / 0.16)", opacity: prog(frame, T.pipe + 6, 20) }}>
        <div style={{ height: 3, width: `${(travel / 4) * 100}%`, background: C.lime }} />
      </div>
      {STATIONS.map((s, i) => {
        const p = prog(frame, T.pipe + i * 9, 18);
        const lit = travel >= i - 0.05;
        const gate = i === 2;
        return (
          <div key={s.name} style={{ position: "absolute", left: x0 + i * (W + GAP), top: 310, width: W, height: 190, boxSizing: "border-box", borderRadius: 24, padding: "30px 30px", background: gate ? C.slab : "rgb(255 255 255 / 0.07)", border: `2px solid ${lit ? C.lime : "rgb(255 255 255 / 0.16)"}`, opacity: p, translate: `0px ${(1 - p) * 30}px` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {gate && <GateMark size={40} />}
              <span style={{ ...display, fontSize: 50, color: gate ? C.safety : C.paper }}>{s.name}</span>
            </div>
            <div style={{ ...sans, fontSize: 28, color: "rgb(255 255 255 / 0.74)", marginTop: 14, lineHeight: 1.25 }}>{s.who}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: x0, top: 590, width: 1686, display: "flex", flexWrap: "wrap", gap: 14, opacity: prog(frame, T.pipe + 20, 18) }}>
        {RULES.map((r, i) => {
          const at = T.rules + (i * (T.rulesEnd - T.rules)) / RULES.length;
          const p = prog(frame, at, 10);
          return (
            <div key={r} style={{ ...sans, display: "flex", alignItems: "center", gap: 10, height: 54, padding: "0 20px", borderRadius: 27, fontSize: 25, background: p > 0.5 ? "rgb(192 224 33 / 0.14)" : "rgb(255 255 255 / 0.06)", color: p > 0.5 ? C.paper : "rgb(255 255 255 / 0.45)", border: `1.5px solid ${p > 0.5 ? "rgb(192 224 33 / 0.6)" : "rgb(255 255 255 / 0.12)"}` }}>
              <IconCheck size={22} color={C.lime} style={{ opacity: p, scale: String(0.5 + p * 0.5) }} />
              {r.replaceAll("_", " ")}
            </div>
          );
        })}
      </div>
      <Rise at={T.rules + 10} style={{ position: "absolute", left: x0, top: 880, ...display, fontSize: 56, color: C.paper }}>
        No model. The same answer, every time.
      </Rise>
    </div>
  );
};

const Attacks = () => {
  const frame = useCurrentFrame();
  if (frame < T.tried) return null;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Rise at={T.tried + 4} style={{ position: "absolute", left: 117, top: 244, ...display, fontSize: 68, color: C.lime }}>
        We tried to break it.
      </Rise>
      <div style={{ position: "absolute", left: 117, top: 356, width: 1070 }}>
        {ATTACKS.map((a, i) => {
          const at = T.rows[i];
          const p = prog(frame, at, 14);
          const stamp = prog(frame, at + 10, 10);
          return (
            <div key={a.title} style={{ display: "flex", alignItems: "center", gap: 24, height: 78, borderTop: "1px solid rgb(255 255 255 / 0.13)", opacity: p, translate: `${(1 - p) * 40}px 0px` }}>
              <div style={{ flex: 1, minWidth: 0, ...sans, fontSize: 38, fontWeight: 600, color: C.paper }}>{a.title}</div>
              <div style={{ ...sans, height: 48, padding: "0 22px", borderRadius: 24, display: "flex", alignItems: "center", fontSize: 25, fontWeight: 700, background: C.safety, color: C.slab, opacity: stamp, scale: String(1.25 - stamp * 0.25), whiteSpace: "nowrap" }}>{a.how}</div>
            </div>
          );
        })}
      </div>
      <Rise at={T.tally} dur={16} style={{ position: "absolute", left: 1290, top: 250, width: 540 }}>
        <div style={{ ...display, fontSize: 176, color: C.lime, lineHeight: 0.95, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>7 of 7</div>
        <div style={{ ...sans, fontSize: 38, color: "rgb(255 255 255 / 0.84)", marginTop: 12 }}>held at the real gate.</div>
      </Rise>
      <div style={{ position: "absolute", left: 1290, top: 540, width: 540 }}>
        <Rise at={T.ledger - 6} style={{ ...sans, fontSize: 28, color: "rgb(255 255 255 / 0.7)", marginBottom: 14 }}>
          A hash-chained ledger
        </Rise>
        {CHAIN.map((b, i) => {
          const p = prog(frame, T.ledger + i * 7, 12);
          return (
            <div key={b.label} style={{ ...sans, display: "flex", alignItems: "center", gap: 16, height: 56, marginTop: i ? 8 : 0, padding: "0 20px", borderRadius: 14, background: "rgb(255 255 255 / 0.08)", border: "1.5px solid rgb(255 255 255 / 0.16)", opacity: p, translate: `0px ${(1 - p) * 18}px` }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.lime }} />
              <span style={{ fontSize: 26, color: C.paper, flex: 1 }}>{b.label}</span>
              <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 22, color: "rgb(255 255 255 / 0.62)" }}>{b.hash}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** The gate: never the model, always plain code; the recorded attempts to break it; the ledger. */
export const Gate = () => (
  <AbsoluteFill>
    <Ground tone="slab">
      <Rise at={4} dur={20} style={{ position: "absolute", left: 117, top: 92, ...display, fontSize: 112, color: C.paper }}>
        The model is never trusted.
      </Rise>
      <Pipeline />
      <Attacks />
    </Ground>
  </AbsoluteFill>
);
