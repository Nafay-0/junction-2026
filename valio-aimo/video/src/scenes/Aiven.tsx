import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { bez, clamp, EASE_IO, M, prog, Q, Rise, Wire } from "../anim";
import { C, display, sans, SHADOW } from "../theme";
import { GateMark, Ground, Wordmark } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("aiven", phrase, shift);
/** Each service lights as it is named (infra/aiven.md; the operations portal's Platform page says the same jobs). */
const T = { runtime: c("Runtime", -3), pg: c("Postgres", -3), kafka: c("Kafka", -3), valkey: c("Valkey", -3), os: c("OpenSearch", -3), grafana: c("Grafana", -3), agent: c("Managed Agent", -3), door: c("MCP door", -6), mcp: c("Aiven's MCP", -3), all: c("feeds", -2) };

const APP = { x: 700, y: 380, w: 520, h: 340 };
const COL = { x: 1366, w: 440, h: 150 };
const ROWS = { pg: 170, kafka: 344, valkey: 518, os: 692 };
const mid = (y: number) => y + COL.h / 2;
/** From the app's right edge to a service on the right. */
const out = (y: number, k: number): number[][] => [[APP.x + APP.w, APP.y + 60 + k * 72], [APP.x + APP.w + 110, APP.y + 60 + k * 72], [COL.x - 110, mid(y)], [COL.x, mid(y)]];

const Card = ({ at, x, y, w, h, name, job, children }: { at: number; x: number; y: number; w: number; h: number; name: string; job: string; children?: ReactNode }) => {
  const frame = useCurrentFrame();
  const base = prog(frame, 14, M);
  const on = prog(frame, at, M);
  const flash = interpolate(frame, [at, at + 6, at + 40], [0, 1, 0.25], clamp);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, boxSizing: "border-box", borderRadius: 24, padding: "22px 26px", background: `rgb(255 255 255 / ${0.045 + 0.065 * on})`, border: `2.5px solid rgb(192 224 33 / ${0.12 + 0.5 * on + 0.38 * flash})`, boxShadow: `0 0 ${60 * flash}px -12px rgb(192 224 33 / ${0.7 * flash})`, opacity: base * (0.32 + 0.68 * on), scale: String(1 + 0.035 * flash), translate: `0px ${(1 - base) * 20 - 8 * flash}px` }}>
      <div style={{ ...display, fontSize: 40, color: C.paper, whiteSpace: "nowrap" }}>{name}</div>
      <div style={{ ...sans, fontSize: 26, color: "rgb(255 255 255 / 0.8)", marginTop: 8, opacity: on, whiteSpace: "nowrap" }}>{job}</div>
      {children}
    </div>
  );
};

/** A small labelled thing travelling a line: an order row, a price, a query. */
const Chip = ({ pts, at, every, back = false, children }: { pts: number[][]; at: number; every: number; back?: boolean; children: ReactNode }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const u = EASE_IO(((frame - at) % every) / every);
  // The pill travels only the open middle of its line, so it never rests on a card or its words.
  const t = 0.3 + 0.4 * (back ? 1 - u : u);
  const [x, y] = bez(pts, t);
  return (
    <div style={{ position: "absolute", left: x, top: y, translate: "-50% -50%", height: 28, padding: "0 11px", borderRadius: 14, background: C.lime, color: C.ink, display: "flex", alignItems: "center", ...sans, fontSize: 17, fontWeight: 700, whiteSpace: "nowrap", opacity: Math.sin(u * Math.PI) ** 0.6, boxShadow: SHADOW.md }}>{children}</div>
  );
};

export const Aiven = () => {
  const frame = useCurrentFrame();
  const app = prog(frame, T.runtime, M);
  const flash = interpolate(frame, [T.runtime, T.runtime + 6, T.runtime + 40], [0, 1, 0.25], clamp);
  const door = prog(frame, T.door, Q);
  const W = { pg: out(ROWS.pg, 0), kafka: out(ROWS.kafka, 1), valkey: out(ROWS.valkey, 2), os: out(ROWS.os, 3) };
  const bus = 1852;
  const agentWire = [[520, 375], [620, 375], [600, 520], [APP.x, 520]];
  const mcpWire = [[520, 775], [600, 775], [640, 800], [760, 800]];
  return (
    <AbsoluteFill>
      <Ground>
        <Rise at={6} style={{ position: "absolute", left: 80, top: 56, ...display, fontSize: 104, color: C.paper }}>
          Built on Aiven.
        </Rise>

        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <Wire pts={W.pg} at={T.pg} every={66} />
          <Wire pts={W.kafka} at={T.kafka} every={30} />
          <Wire pts={W.kafka} at={T.kafka} every={30} offset={10} rest={0} />
          <Wire pts={W.kafka} at={T.kafka} every={30} offset={20} rest={0} />
          <Wire pts={W.valkey} at={T.valkey} every={54} back />
          <Wire pts={W.os} at={T.os} every={48} />
          <Wire pts={W.os} at={T.os + M} every={48} offset={24} back rest={0} />
          {Object.values(ROWS).map((y, i) => (
            <Wire key={y} pts={[[COL.x + COL.w, mid(y)], [bus - 6 * i, mid(y)], [bus - 6 * i, mid(y) + 60], [bus - 6 * i, 900]]} at={T.grafana + i * 4} dur={M + 6} every={36} offset={i * 9} width={2} color="#ffffff" rest={0.34} />
          ))}
          {Object.values(ROWS).map((y, i) => (
            <Wire key={`in${y}`} pts={[[bus - 6 * i, 900], [bus - 6 * i, 945 - 8 * i], [bus - 30, 945 - 8 * i], [COL.x + COL.w, 945 - 8 * i + 12]]} at={T.grafana + M + i * 4} dur={Q} width={2} color="#ffffff" rest={0.34} />
          ))}
          <Wire pts={agentWire} at={T.agent + 6} dur={M + 6} every={72} />
          <Wire pts={mcpWire} at={T.mcp + 4} every={54} />
        </svg>

        <div style={{ position: "absolute", left: APP.x, top: APP.y, width: APP.w, height: APP.h, boxSizing: "border-box", borderRadius: 30, padding: "26px 30px", background: `rgb(255 255 255 / ${0.05 + 0.07 * app})`, border: `3px solid rgb(192 224 33 / ${0.14 + 0.56 * app + 0.3 * flash})`, boxShadow: `0 0 ${90 * flash}px -14px rgb(192 224 33 / ${0.7 * flash})`, opacity: prog(frame, 10, M) * (0.35 + 0.65 * app), scale: String(1 + 0.03 * flash) }}>
          <div style={{ ...display, fontSize: 52, color: C.paper }}>Aiven Runtime</div>
          <div style={{ ...sans, fontSize: 27, color: "rgb(255 255 255 / 0.8)", marginTop: 6, opacity: app }}>Hosts the app and its MCP door.</div>
          <div style={{ marginTop: 26, height: 150, borderRadius: 20, background: C.mist, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", opacity: 0.35 + 0.65 * app }}>
            <Wordmark size={44} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 76, padding: "0 20px", borderRadius: 18, background: C.slab }}>
              <GateMark size={40} />
              <span style={{ ...display, fontSize: 32, color: C.safety }}>the gate</span>
            </div>
          </div>
          <div style={{ position: "absolute", left: -78, top: 118, height: 44, padding: "0 16px", borderRadius: 22, background: C.lime, color: C.ink, display: "flex", alignItems: "center", ...sans, fontSize: 22, fontWeight: 700, opacity: door, translate: `${(1 - door) * 16}px 0px` }}>MCP door</div>
        </div>
        <Rise at={T.mcp + M} dur={Q} y={10} style={{ position: "absolute", left: 760, top: 772, height: 56, padding: "0 24px", borderRadius: 28, background: C.lavender, color: C.lavenderDeep, display: "flex", alignItems: "center", ...sans, fontSize: 26, fontWeight: 700 }}>
          Operations copilot
        </Rise>

        <Card at={T.pg} x={COL.x} y={ROWS.pg} w={COL.w} h={COL.h} name="Aiven for PostgreSQL" job="Orders, ledger, memory, history" />
        <Card at={T.kafka} x={COL.x} y={ROWS.kafka} w={COL.w} h={COL.h} name="Aiven for Apache Kafka" job="Every action, in order" />
        <Card at={T.valkey} x={COL.x} y={ROWS.valkey} w={COL.w} h={COL.h} name="Aiven for Valkey" job="Live prices, lookup budgets" />
        <Card at={T.os} x={COL.x} y={ROWS.os} w={COL.w} h={COL.h} name="Aiven for OpenSearch" job="Keyword and vector search" />
        <Card at={T.grafana} x={COL.x} y={880} w={COL.w} h={130} name="Aiven for Grafana" job="Dashboards, alerts, metrics, logs" />
        <Card at={T.agent} x={80} y={300} w={440} h={150} name="Aiven Managed Agents" job="An outside buyer, through MCP" />
        <Card at={T.mcp} x={80} y={700} w={440} h={150} name="Aiven MCP server" job="Service state for the copilot" />

        <Chip pts={W.pg} at={T.pg + M} every={66}>
          ledger entry
        </Chip>
        <Chip pts={W.valkey} at={T.valkey + M} every={54} back>
          1,01 €/l
        </Chip>
        <Chip pts={W.os} at={T.os + M} every={96}>
          query
        </Chip>
        <Chip pts={agentWire} at={T.agent + M + 12} every={72}>
          order
        </Chip>
      </Ground>
    </AbsoluteFill>
  );
};
