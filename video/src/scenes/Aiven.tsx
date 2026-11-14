import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, EASE, prog, Rise } from "../anim";
import { C, display, sans } from "../theme";
import { Ground } from "../ui";
import { cue } from "../vo";

const c = (phrase: string, shift = 0) => cue("aiven", phrase, shift);

/** Each service and the job it does here (infra/aiven.md; the operations portal's Platform page says the same). */
const SERVICES = [
  { at: c("Runtime", -3), name: "Aiven Runtime", job: "Hosts the app and its MCP door." },
  { at: c("Postgres", -3), name: "Aiven for PostgreSQL", job: "Orders, ledger, memory, history." },
  { at: c("Kafka", -3), name: "Aiven for Apache Kafka", job: "Every action, in order." },
  { at: c("Valkey", -3), name: "Aiven for Valkey", job: "Live prices, lookup budgets." },
  { at: c("OpenSearch", -3), name: "Aiven for OpenSearch", job: "Keyword and vector search." },
  { at: c("Grafana", -3), name: "Aiven for Grafana", job: "Dashboards, alerts, metrics, logs." },
  { at: c("Managed Agent", -3), name: "Aiven Managed Agents", job: "An outside buyer, through MCP." },
  { at: c("Aiven's MCP", -3), name: "Aiven MCP server", job: "Service state for the copilot." },
];
const W = 422;
const H = 330;
const GAP = 26;

export const Aiven = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Ground>
        <Rise at={4} style={{ position: "absolute", left: 80, top: 70, ...display, fontSize: 124, color: C.paper }}>
          Built on Aiven.
        </Rise>
        <Rise at={18} style={{ position: "absolute", left: 1040, top: 118, width: 800, ...sans, fontSize: 40, lineHeight: 1.3, color: "rgb(255 255 255 / 0.8)", textAlign: "right" }}>
          Eight services. Each with a job.
        </Rise>
        {SERVICES.map((s, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const base = prog(frame, 20 + i * 3, 16);
          const on = interpolate(frame, [s.at, s.at + 14], [0, 1], { ...clamp, easing: EASE });
          const next = SERVICES[i + 1]?.at ?? 9999;
          const calm = interpolate(frame, [next, next + 14], [0, 1], clamp);
          const heat = on * (1 - calm * 0.55);
          return (
            <div key={s.name} style={{ position: "absolute", left: 80 + col * (W + GAP), top: 270 + row * (H + GAP), width: W, height: H, boxSizing: "border-box", borderRadius: 28, padding: "34px 32px", background: `rgb(255 255 255 / ${0.05 + on * 0.07})`, border: `2.5px solid rgb(192 224 33 / ${0.1 + heat * 0.9})`, boxShadow: `0 0 ${heat * 70}px -14px rgb(192 224 33 / ${heat * 0.6})`, opacity: base * (0.34 + on * 0.66), scale: String(1 + (on - calm) * 0.035) }}>
              <div style={{ width: 54, height: 6, borderRadius: 3, background: C.lime, opacity: on, marginBottom: 22 }} />
              <div style={{ ...display, fontSize: 45, color: C.paper }}>{s.name}</div>
              <div style={{ ...sans, fontSize: 35, lineHeight: 1.25, color: "rgb(255 255 255 / 0.86)", marginTop: 18, opacity: on }}>{s.job}</div>
            </div>
          );
        })}
      </Ground>
    </AbsoluteFill>
  );
};
