#!/usr/bin/env node
/**
 * Provision Grafana (dock-grafana on Aiven): two data sources and the "AimoPilot overview" dashboard.
 *
 *   node infra/grafana/provision.mjs            create or update data sources and the dashboard
 *   node infra/grafana/provision.mjs --print    print the dashboard JSON (project name blanked) and exit
 *
 * Reads from web/.env.local (or the environment): AIVEN_API_TOKEN, AIVEN_PROJECT, AIVEN_READONLY_TOKEN.
 * Grafana's admin password and the grafana_reader password are fetched from the Aiven API at run time
 * and never printed. Idempotent: data sources are matched by uid, the dashboard by uid.
 *
 * Why these data sources (and no Aiven for Metrics / Thanos): the data services run on free plans,
 * and free plans allow no service integrations, so neither the "datasource" integration nor a
 * "metrics" integration into Thanos is possible (the API answers 403 service_integration_not_allowed).
 *   dock-pg    PostgreSQL, user grafana_reader (read-only): the app's telemetry.events table
 *   aiven-api  Infinity plugin calling api.aiven.io with a read-only application-user token:
 *              CPU / memory / disk of every service, service state, Runtime app logs
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../../web/.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const PRINT = process.argv.includes("--print");

const project = PRINT ? "YOUR_AIVEN_PROJECT" : must("AIVEN_PROJECT");
const GRAFANA = process.env.AIVEN_GRAFANA_SERVICE ?? "dock-grafana";
const PG = process.env.AIVEN_PG_SERVICE ?? "dock-pg";
const APP = process.env.AIVEN_APP_SERVICE ?? "dock-app";
const SERVICES = [PG, "dock-search", "dock-cache", "dock-events", APP, GRAFANA];

function must(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`${k} is not set`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------- dashboard

const PG_DS = { type: "grafana-postgresql-datasource", uid: "dock-pg" };
const API_DS = { type: "yesoreyeram-infinity-datasource", uid: "aiven-api" };

let nextId = 1;
const grid = { x: 0, y: 0 };
function place(w, h) {
  if (grid.x + w > 24) {
    grid.x = 0;
    grid.y += grid.rowH ?? h;
    grid.rowH = 0;
  }
  const pos = { x: grid.x, y: grid.y, w, h };
  grid.x += w;
  grid.rowH = Math.max(grid.rowH ?? 0, h);
  return pos;
}
function row(title) {
  if (grid.x > 0) {
    grid.y += grid.rowH ?? 0;
    grid.x = 0;
    grid.rowH = 0;
  }
  const p = { type: "row", id: nextId++, title, collapsed: false, gridPos: { x: 0, y: grid.y, w: 24, h: 1 }, panels: [] };
  grid.y += 1;
  return p;
}

const sql = (refId, rawSql, format = "table") => ({ refId, datasource: PG_DS, editorMode: "code", format, rawQuery: true, rawSql });

function stat(title, targets, { w = 4, unit, description, colorMode = "value", decimals } = {}) {
  return {
    type: "stat",
    id: nextId++,
    title,
    description,
    datasource: PG_DS,
    gridPos: place(w, 4),
    targets,
    fieldConfig: { defaults: { unit, decimals, color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ color: "blue", value: null }] } }, overrides: [] },
    options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, colorMode, graphMode: "none", textMode: "value_and_name", justifyMode: "auto", orientation: "horizontal" },
  };
}

/** JSONata over the Aiven metrics API answer (Google Charts layout, months 0-based, UTC). */
function metricExpr(metric) {
  return `$filter($map(metrics.${metric}.data.rows, function($r, $i) { $i = 0 ? null : (
  $p := $map($split($substringBefore($substringAfter($r[0], "Date("), ")"), ","), function($v) { $number($v) });
  {
    "time": $toMillis($string($p[0]) & "-" & $pad($string($p[1] + 1), -2, "0") & "-" & $pad($string($p[2]), -2, "0") & "T" & $pad($string($p[3]), -2, "0") & ":" & $pad($string($p[4]), -2, "0") & ":" & $pad($string($p[5]), -2, "0") & "Z"),
    "value": $average($filter($r, function($v, $j) { $j > 0 and $type($v) = "number" }))
  }
) }), function($x) { $x != null })`;
}

function apiMetricTarget(refId, service, metric) {
  return {
    refId,
    datasource: API_DS,
    type: "json",
    source: "url",
    parser: "backend",
    format: "timeseries",
    url: `https://api.aiven.io/v1/project/\${project}/service/${service}/metrics`,
    url_options: { method: "POST", data: '{"period":"${period}"}', body_type: "raw", body_content_type: "application/json" },
    root_selector: metricExpr(metric),
    columns: [
      { selector: "time", text: "time", type: "timestamp_epoch" },
      { selector: "value", text: service, type: "number" },
    ],
  };
}

function metricPanel(title, metric, services, { unit = "percent", w = 8 } = {}) {
  return {
    type: "timeseries",
    id: nextId++,
    title,
    datasource: API_DS,
    gridPos: place(w, 8),
    targets: services.map((s, i) => apiMetricTarget(String.fromCharCode(65 + i), s, metric)),
    fieldConfig: { defaults: { unit, min: 0, custom: { lineWidth: 1, fillOpacity: 8, showPoints: "never", spanNulls: true } }, overrides: [] },
    options: { legend: { displayMode: "list", placement: "bottom", showLegend: true }, tooltip: { mode: "multi", sort: "desc" } },
  };
}


function table(title, rawSql, { w = 12, h = 8, description } = {}) {
  return { type: "table", id: nextId++, title, description, datasource: PG_DS, gridPos: place(w, h), targets: [sql("A", rawSql)], options: { showHeader: true, cellHeight: "sm" }, fieldConfig: { defaults: {}, overrides: [] } };
}

function bars(title, rawSql, { w = 8, h = 8, unit, description } = {}) {
  return {
    type: "bargauge",
    id: nextId++,
    title,
    description,
    datasource: PG_DS,
    gridPos: place(w, h),
    targets: [sql("A", rawSql)],
    fieldConfig: { defaults: { unit, color: { mode: "continuous-BlYlRd" }, min: 0 }, overrides: [] },
    options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: true }, orientation: "horizontal", displayMode: "gradient", showUnfilled: true, valueMode: "color", namePlacement: "left" },
  };
}

/** Per agent over the dashboard's time range: the scorecard's figures and status (the same thresholds as web/src/server/ops/scorecard.ts). */
const AGENT_FIGURES = `WITH e AS (SELECT * FROM telemetry.events WHERE agent_id IS NOT NULL AND $__timeFilter(ts)),
k AS (
  SELECT agent_id,
    count(*) FILTER (WHERE kind = 'request.opened') AS requests,
    count(*) FILTER (WHERE kind = 'gate.allowed') AS alone,
    count(*) FILTER (WHERE kind = 'gate.escalated') AS to_a_person,
    count(*) FILTER (WHERE kind = 'gate.escalated' AND rule = 'per_order_limit') AS over_limit,
    count(*) FILTER (WHERE kind = 'gate.refused') AS refused,
    count(*) FILTER (WHERE kind = 'order.committed') AS committed,
    count(*) FILTER (WHERE kind = 'turn.correction') AS corrections,
    count(*) FILTER (WHERE kind = 'quote.issued') AS proposals,
    coalesce(sum((attrs->>'costUsd')::float8) FILTER (WHERE kind = 'agent.model'), 0)
      + coalesce(sum((attrs->'facts'->>'cost_usd')::float8) FILTER (WHERE kind = 'search.done'), 0) AS spend_usd,
    count(*) FILTER (WHERE kind = 'lookup.live') AS live_calls
  FROM e GROUP BY 1)
SELECT agent_id AS "agent",
  CASE WHEN refused >= 3 AND refused >= 0.3 * nullif(alone + to_a_person + refused, 0) THEN 'failing'
       WHEN (to_a_person >= 2 AND to_a_person >= 0.5 * nullif(alone + to_a_person + refused, 0)) OR over_limit >= 2 THEN 'escalating'
       WHEN requests + alone + to_a_person + refused = 0 THEN 'quiet' ELSE 'performing' END AS "status",
  requests, alone, to_a_person AS "to a person", refused,
  round(100.0 * to_a_person / nullif(alone + to_a_person + refused, 0), 0) AS "escalation %",
  corrections AS "corrected", proposals AS "quotes",
  round((spend_usd / nullif(committed, 0))::numeric, 4) AS "USD per order",
  round(live_calls::numeric / nullif(committed, 0), 1) AS "live calls per order"
FROM k ORDER BY 2, 3 DESC`;

function buildDashboard() {
  const panels = [];

  // Row 1: AimoPilot, from PostgreSQL
  panels.push(row("AimoPilot (PostgreSQL telemetry.events, written by the app)"));
  panels.push(
    stat("Orders committed", [sql("A", `SELECT count(*) AS "orders" FROM telemetry.events WHERE kind = 'order.committed' AND $__timeFilter(ts)`)]),
    stat("Committed value", [sql("A", `SELECT coalesce(sum(value), 0) AS "EUR" FROM telemetry.events WHERE kind = 'order.committed' AND $__timeFilter(ts)`)], { unit: "currencyEUR", decimals: 0 }),
    stat(
      "Human sign-offs",
      [
        sql(
          "A",
          `SELECT count(*) FILTER (WHERE kind = 'approval.requested') AS "asked",
       count(*) FILTER (WHERE kind = 'approval.granted')   AS "granted",
       count(*) FILTER (WHERE kind = 'approval.denied')    AS "denied"
FROM telemetry.events WHERE kind LIKE 'approval.%' AND $__timeFilter(ts)`,
        ),
      ],
      { w: 6 },
    ),
    stat("Gate refusals", [sql("A", `SELECT count(*) AS "refused" FROM telemetry.events WHERE kind = 'gate.refused' AND $__timeFilter(ts)`)], { w: 3 }),
    stat(
      "Live API calls saved by cache",
      [
        sql(
          "A",
          `SELECT count(*) FILTER (WHERE kind = 'partner_api.cache_hit') AS "saved",
       round(100.0 * count(*) FILTER (WHERE kind = 'partner_api.cache_hit')
             / nullif(count(*), 0), 1) AS "hit %"
FROM telemetry.events WHERE kind IN ('partner_api.call', 'partner_api.cache_hit') AND $__timeFilter(ts)`,
        ),
      ],
      { w: 7, description: "partner_api.cache_hit rows are answers served from Valkey inside their validity window; partner_api.call rows are real calls to the partner's rate-limited API." },
    ),
  );
  panels.push({
    type: "bargauge",
    id: nextId++,
    title: "Refusals by rule",
    datasource: PG_DS,
    gridPos: place(8, 9),
    targets: [sql("A", `SELECT rule AS "rule", count(*) AS "refusals" FROM telemetry.events WHERE kind = 'gate.refused' AND $__timeFilter(ts) GROUP BY rule ORDER BY 2 DESC`)],
    fieldConfig: { defaults: { color: { mode: "continuous-BlYlRd" }, min: 0 }, overrides: [] },
    options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: true }, orientation: "horizontal", displayMode: "gradient", showUnfilled: true, valueMode: "color", namePlacement: "left" },
  });
  panels.push({
    type: "timeseries",
    id: nextId++,
    title: "Events per minute",
    datasource: PG_DS,
    gridPos: place(10, 9),
    targets: [sql("A", `SELECT $__timeGroupAlias(ts, '1m'), kind AS metric, count(*) AS value FROM telemetry.events WHERE $__timeFilter(ts) AND kind <> 'infra.check' GROUP BY 1, 2 ORDER BY 1`, "time_series")],
    fieldConfig: { defaults: { custom: { drawStyle: "bars", fillOpacity: 70, stacking: { mode: "normal" }, showPoints: "never" } }, overrides: [] },
    options: { legend: { displayMode: "list", placement: "bottom", showLegend: true }, tooltip: { mode: "multi", sort: "desc" } },
  });
  panels.push({
    type: "table",
    id: nextId++,
    title: "Crash-test scores",
    datasource: PG_DS,
    gridPos: place(6, 9),
    targets: [sql("A", `SELECT ts AS "time", coalesce(attrs->>'run', agent_id, '-') AS "run", value AS "score", attrs->>'notes' AS "notes" FROM telemetry.events WHERE kind = 'crashtest.score' AND $__timeFilter(ts) ORDER BY ts DESC LIMIT 50`)],
    options: { showHeader: true, cellHeight: "sm" },
    fieldConfig: { defaults: {}, overrides: [] },
  });

  // Row: the agents at the door (the operations portal's scorecard, web/src/server/ops/scorecard.ts)
  panels.push(row("Agents at the door: performing, escalating, failing"));
  panels.push(table("Agent status", AGENT_FIGURES, { w: 24, h: 8, description: "Failing: a third of its decisions refused (at least 3). Escalating: half its decisions sent to a person (at least 2), or two orders over its own limit. The portal's Agents page shows the same with the reason in words and what a person might do." }));
  panels.push(
    bars("Escalation rate by agent", `SELECT agent_id AS "agent", round(100.0 * count(*) FILTER (WHERE kind = 'gate.escalated') / nullif(count(*), 0), 0) AS "to a person %" FROM telemetry.events WHERE kind IN ('gate.allowed', 'gate.escalated', 'gate.refused') AND agent_id IS NOT NULL AND $__timeFilter(ts) GROUP BY 1 ORDER BY 2 DESC`, { unit: "percent" }),
    bars("Refusals by agent and rule", `SELECT agent_id || ' · ' || coalesce(rule, '?') AS "agent · rule", count(*) AS "refusals" FROM telemetry.events WHERE kind = 'gate.refused' AND agent_id IS NOT NULL AND $__timeFilter(ts) GROUP BY 1 ORDER BY 2 DESC LIMIT 15`),
    table(
      "Time to a decision",
      `WITH r AS (SELECT agent_id, attrs->>'request_id' AS request_id,
    extract(epoch FROM min(ts) FILTER (WHERE kind IN ('gate.allowed', 'gate.escalated', 'gate.refused')) - min(ts) FILTER (WHERE kind = 'request.opened')) AS s
  FROM telemetry.events WHERE agent_id IS NOT NULL AND attrs ? 'request_id' AND $__timeFilter(ts) GROUP BY 1, 2)
SELECT agent_id AS "agent", count(*) AS "decisions",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s)::numeric, 1) AS "p50 s",
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY s)::numeric, 1) AS "p90 s"
FROM r WHERE s IS NOT NULL GROUP BY 1 ORDER BY 4 DESC`,
      { w: 8 },
    ),
  );
  panels.push(row("Search and the conversation"));
  panels.push(
    table(
      "Search by stage (ms)",
      `SELECT count(*) AS "searches",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (attrs->'facts'->>'embed_ms')::float8)::numeric) AS "embed p50",
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY (attrs->'facts'->>'recall_ms')::float8)::numeric) AS "recall p90",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (attrs->'facts'->>'judge_ms')::float8)::numeric) AS "judge p50",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (attrs->'facts'->>'total_ms')::float8)::numeric) AS "total p50",
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY (attrs->'facts'->>'total_ms')::float8)::numeric) AS "total p90",
  round(100.0 * count(*) FILTER (WHERE attrs->'facts'->>'backend' = 'opensearch') / nullif(count(*), 0)) AS "on OpenSearch %",
  count(*) FILTER (WHERE (attrs->'facts'->>'fallback')::boolean) AS "fallbacks",
  round((1000 * avg((attrs->'facts'->>'cost_usd')::float8))::numeric, 3) AS "USD per 1000",
  count(*) FILTER (WHERE (attrs->'facts'->>'not_sold')::boolean) AS "not sold"
FROM telemetry.events WHERE kind = 'search.done' AND $__timeFilter(ts)`,
      { w: 12, h: 5 },
    ),
    table(
      "Conversation turns",
      `WITH t AS (SELECT attrs->>'turnId' AS turn, min(ts) FILTER (WHERE kind = 'turn.started') AS s, min(ts) FILTER (WHERE kind = 'turn.done') AS d,
    max(attrs->'facts'->>'outcome') FILTER (WHERE kind = 'turn.done') AS outcome
  FROM telemetry.events WHERE kind IN ('turn.started', 'turn.done') AND attrs ? 'turnId' AND $__timeFilter(ts) GROUP BY 1)
SELECT count(*) AS "turns",
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM d - s))::numeric, 1) AS "p50 s",
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM d - s))::numeric, 1) AS "p90 s",
  count(*) FILTER (WHERE d IS NULL AND s < now() - interval '150 seconds') AS "failed or timed out",
  count(*) FILTER (WHERE outcome = 'ordered') AS "ordered",
  count(*) FILTER (WHERE outcome = 'sign_off') AS "sent for sign-off",
  count(*) FILTER (WHERE outcome = 'refused') AS "refused",
  count(*) FILTER (WHERE outcome = 'asked') AS "asked"
FROM t WHERE s IS NOT NULL`,
      { w: 12, h: 5 },
    ),
  );

  // Row 2: Aiven services, from the Aiven API
  panels.push(row("Aiven services (Aiven API, read-only token)"));
  panels.push({
    type: "table",
    id: nextId++,
    title: "Services",
    datasource: API_DS,
    gridPos: place(8, 8),
    targets: [
      {
        refId: "A",
        datasource: API_DS,
        type: "json",
        source: "url",
        parser: "backend",
        format: "table",
        url: "https://api.aiven.io/v1/project/${project}/service",
        url_options: { method: "GET" },
        root_selector: "services",
        columns: [
          { selector: "service_name", text: "service", type: "string" },
          { selector: "service_type", text: "type", type: "string" },
          { selector: "plan", text: "plan", type: "string" },
          { selector: "cloud_name", text: "cloud", type: "string" },
          { selector: "state", text: "state", type: "string" },
        ],
      },
    ],
    fieldConfig: {
      defaults: {},
      overrides: [
        {
          matcher: { id: "byName", options: "state" },
          properties: [
            { id: "custom.cellOptions", value: { type: "color-background" } },
            { id: "mappings", value: [{ type: "value", options: { RUNNING: { color: "green", index: 0 }, REBUILDING: { color: "yellow", index: 1 }, POWEROFF: { color: "red", index: 2 } } }] },
          ],
        },
      ],
    },
    options: { showHeader: true, cellHeight: "sm" },
  });
  panels.push(metricPanel("CPU", "cpu_usage", SERVICES, { w: 8 }));
  panels.push(metricPanel("Memory", "mem_usage", [PG, "dock-search", "dock-cache", APP, GRAFANA], { w: 8 }));
  panels.push(metricPanel("Disk used", "disk_usage", [PG, "dock-search", "dock-events", GRAFANA], { w: 12 }));
  panels.push({
    type: "table",
    id: nextId++,
    title: "Latest pnpm infra:check (pnpm infra:check --record)",
    datasource: PG_DS,
    gridPos: place(12, 8),
    targets: [sql("A", `SELECT DISTINCT ON (rule) rule AS "service", ok, value AS "ms", ts AS "checked", attrs->>'detail' AS "detail" FROM telemetry.events WHERE kind = 'infra.check' ORDER BY rule, ts DESC`)],
    fieldConfig: {
      defaults: {},
      overrides: [{ matcher: { id: "byName", options: "ok" }, properties: [{ id: "custom.cellOptions", value: { type: "color-background" } }, { id: "mappings", value: [{ type: "value", options: { true: { color: "green", text: "pass", index: 0 }, false: { color: "red", text: "FAIL", index: 1 } } }] }] }],
    },
    options: { showHeader: true, cellHeight: "sm" },
  });

  // Row 3: the Runtime app's own logs
  panels.push(row(`Runtime app logs (${APP}, last 24 h are kept by Runtime)`));
  for (const [title, logType] of [
    ["Runtime log", "application-run"],
    ["Build log", "application-build"],
  ]) {
    panels.push({
      type: "table",
      id: nextId++,
      title,
      datasource: API_DS,
      gridPos: place(12, 12),
      targets: [
        {
          refId: "A",
          datasource: API_DS,
          type: "json",
          source: "url",
          parser: "backend",
          format: "table",
          url: `https://api.aiven.io/v1/project/\${project}/service/${APP}/logs`,
          url_options: { method: "POST", data: `{"log_type":"${logType}","limit":200,"sort_order":"desc"}`, body_type: "raw", body_content_type: "application/json" },
          root_selector: "logs",
          columns: [
            { selector: "time", text: "time", type: "timestamp" },
            { selector: "msg", text: "message", type: "string" },
          ],
        },
      ],
      fieldConfig: { defaults: {}, overrides: [{ matcher: { id: "byName", options: "time" }, properties: [{ id: "custom.width", value: 190 }] }] },
      options: { showHeader: true, cellHeight: "sm" },
    });
  }

  return {
    uid: "dock-overview",
    title: "AimoPilot overview",
    tags: ["dock", "aiven"],
    timezone: "browser",
    editable: true,
    graphTooltip: 1,
    refresh: "10s",
    schemaVersion: 39,
    time: { from: "now-1h", to: "now" },
    templating: {
      list: [
        { type: "constant", name: "project", label: "Aiven project", hide: 2, query: project, current: { text: project, value: project } },
        {
          type: "custom",
          name: "period",
          label: "Aiven metrics window",
          query: "hour,day,week",
          current: { text: "hour", value: "hour" },
          options: ["hour", "day", "week"].map((v, i) => ({ text: v, value: v, selected: i === 0 })),
        },
      ],
    },
    panels,
  };
}


// ---------------------------------------------------------------- alert rules (when this Grafana allows provisioning them)

/** The app's own alert table (web/src/server/ops/alerts.ts), as Grafana rules over the same rows. */
function alertRules(folderUid) {
  const rule = (uid, title, rawSql, threshold, summary) => ({
    uid,
    title,
    folderUID: folderUid,
    ruleGroup: "aimopilot",
    condition: "C",
    for: "1m",
    noDataState: "OK",
    execErrState: "Error",
    annotations: { summary },
    labels: { app: "aimopilot" },
    data: [
      { refId: "A", relativeTimeRange: { from: 900, to: 0 }, datasourceUid: "dock-pg", model: { refId: "A", rawSql, format: "table", rawQuery: true, editorMode: "code" } },
      { refId: "B", datasourceUid: "__expr__", model: { refId: "B", type: "reduce", expression: "A", reducer: "last" } },
      { refId: "C", datasourceUid: "__expr__", model: { refId: "C", type: "threshold", expression: "B", conditions: [{ evaluator: { type: "gt", params: [threshold] } }] } },
    ],
  });
  return [
    rule("dock-turn-p90", "Conversation turns are slow", `SELECT coalesce(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM d - s)), 0) AS p90 FROM (SELECT min(ts) FILTER (WHERE kind = 'turn.started') s, min(ts) FILTER (WHERE kind = 'turn.done') d FROM telemetry.events WHERE kind IN ('turn.started', 'turn.done') AND ts > now() - interval '15 minutes' GROUP BY attrs->>'turnId') t WHERE d IS NOT NULL`, 20, "90 % of conversation turns took over 20 s in the last 15 minutes."),
    rule("dock-search-fallback", "Search is answered by its fallback", `SELECT coalesce(count(*) FILTER (WHERE (attrs->'facts'->>'fallback')::boolean)::float8 / nullif(count(*), 0), 0) AS share FROM telemetry.events WHERE kind = 'search.done' AND ts > now() - interval '15 minutes' HAVING count(*) >= 5`, 0.05, "More than 5 % of searches answered by the fallback recall backend in 15 minutes."),
    rule("dock-signoff-wait", "An order is waiting long for a person", `SELECT coalesce(max(extract(epoch FROM now() - a.ts) / 60), 0) AS minutes FROM telemetry.events a WHERE a.kind = 'approval.requested' AND a.ts > now() - interval '2 days' AND NOT EXISTS (SELECT 1 FROM telemetry.events b WHERE b.kind IN ('approval.granted', 'approval.denied') AND b.order_id = a.order_id)`, 30, "A sign-off has waited over 30 minutes."),
    rule("dock-refusals", "An agent keeps getting refused", `SELECT coalesce(max(n), 0) AS refusals FROM (SELECT count(*) AS n FROM telemetry.events WHERE kind = 'gate.refused' AND ts > now() - interval '15 minutes' GROUP BY agent_id) x`, 4, "One agent was refused 5 or more times in 15 minutes: see its scorecard."),
  ];
}

if (PRINT) {
  console.log(JSON.stringify(buildDashboard(), null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- provisioning

const token = must("AIVEN_API_TOKEN");
const readonlyToken = must("AIVEN_READONLY_TOKEN");

async function aiven(path) {
  const res = await fetch(`https://api.aiven.io/v1${path}`, { headers: { Authorization: `aivenv1 ${token}` } });
  if (!res.ok) throw new Error(`Aiven GET ${path.split("?")[0]} -> HTTP ${res.status}`);
  return res.json();
}

const gsvc = (await aiven(`/project/${project}/service/${GRAFANA}?include_secrets=true`)).service;
const pgsvc = (await aiven(`/project/${project}/service/${PG}?include_secrets=true`)).service;
const reader = (await aiven(`/project/${project}/service/${PG}/user/grafana_reader?include_secrets=true`)).user;
const g = gsvc.service_uri_params;
const base = `https://${g.host}`;
const auth = "Basic " + Buffer.from(`${g.user}:${g.password}`).toString("base64");

async function grafana(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function upsertDatasource(ds) {
  const existing = await grafana("GET", `/api/datasources/uid/${ds.uid}`);
  const r = existing.status === 200 ? await grafana("PUT", `/api/datasources/uid/${ds.uid}`, ds) : await grafana("POST", "/api/datasources", ds);
  if (r.status >= 300) throw new Error(`datasource ${ds.uid}: HTTP ${r.status} ${r.json.message ?? ""}`);
  const health = await grafana("GET", `/api/datasources/uid/${ds.uid}/health`);
  console.log(`datasource ${ds.uid.padEnd(10)} ${existing.status === 200 ? "updated" : "created"} · health: ${health.json.status ?? health.status} ${health.json.message ?? ""}`);
}

const p = pgsvc.service_uri_params;
await upsertDatasource({
  name: "AimoPilot PostgreSQL",
  uid: "dock-pg",
  type: "grafana-postgresql-datasource",
  access: "proxy",
  url: `${p.host}:${p.port}`,
  user: reader.username,
  isDefault: true,
  jsonData: { database: p.dbname, sslmode: "require", maxOpenConns: 2, maxIdleConns: 1, connMaxLifetime: 14400, postgresVersion: 1800, timescaledb: false },
  secureJsonData: { password: reader.password },
});
await upsertDatasource({
  name: "Aiven API (read-only)",
  uid: "aiven-api",
  type: "yesoreyeram-infinity-datasource",
  access: "proxy",
  jsonData: { allowedHosts: ["https://api.aiven.io"], auth_method: "none", httpHeaderName1: "Authorization", global_queries: [] },
  secureJsonData: { httpHeaderValue1: `aivenv1 ${readonlyToken}` },
});

const put = await grafana("POST", "/api/dashboards/db", { dashboard: buildDashboard(), overwrite: true, message: "provisioned by infra/grafana/provision.mjs" });
if (put.status >= 300) throw new Error(`dashboard: HTTP ${put.status} ${put.json.message ?? ""}`);
console.log(`dashboard  ${put.json.status} · ${base}${put.json.url}`);
// Alert rules: Grafana's provisioning API, when this plan allows it; otherwise the app's own alert table holds them.
const folder = await grafana("POST", "/api/folders", { uid: "aimopilot", title: "AimoPilot" });
if (folder.status >= 300 && folder.status !== 409 && folder.status !== 412) {
  console.log(`alerts     not provisioned: folder HTTP ${folder.status} ${folder.json.message ?? ""}; the app's own alert table (Platform page) holds them`);
} else {
  let ok = 0;
  let why = "";
  for (const r of alertRules("aimopilot")) {
    const existing = await grafana("GET", `/api/v1/provisioning/alert-rules/${r.uid}`);
    const res = existing.status === 200 ? await grafana("PUT", `/api/v1/provisioning/alert-rules/${r.uid}`, r) : await grafana("POST", "/api/v1/provisioning/alert-rules", r);
    if (res.status < 300) ok++;
    else why = `HTTP ${res.status} ${res.json.message ?? ""}`;
  }
  console.log(ok ? `alerts     ${ok} rules provisioned in folder AimoPilot${why ? ` (some failed: ${why})` : ""}` : `alerts     not provisioned (${why}); the app's own alert table (Platform page) holds them`);
}
console.log(`login      user ${g.user}; password: Aiven Console > ${GRAFANA} > Overview (not printed here)`);
