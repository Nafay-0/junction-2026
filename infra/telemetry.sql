-- Telemetry contract between the Dock app and the Grafana dashboard (infra/grafana/dock-overview.json).
-- Idempotent. Applied to dock-pg on 13 Nov 2026.
--
-- The app writes one row per thing worth counting. Grafana reads it through the grafana_reader role.
-- It lives in its own schema so the app's own tables (orders, approvals, ledger) stay free to change.
-- Why PostgreSQL and not a metrics store: our data services are on free plans, and free plans allow
-- no service integrations, so Aiven for Metrics (Thanos) could not receive their metrics anyway; and
-- these numbers are business events the app already writes transactionally next to the order.

create schema if not exists telemetry;

create table if not exists telemetry.events (
  id        bigint generated always as identity primary key,
  ts        timestamptz      not null default now(),
  source    text             not null,             -- 'dock-app' | 'crash-test' | 'infra-check' | ...
  kind      text             not null,             -- see the list below
  rule      text,                                  -- gate rule id for refusals; service name for infra.check
  agent_id  text,
  order_id  text,
  value     double precision,                      -- euros, milliseconds or a score, depending on kind
  ok        boolean,
  attrs     jsonb            not null default '{}'::jsonb
);
create index if not exists events_ts_idx      on telemetry.events (ts desc);
create index if not exists events_kind_ts_idx on telemetry.events (kind, ts desc);

comment on table telemetry.events is
  'One row per countable event. kinds: request.opened, quote.issued, order.committed (value = EUR), '
  'approval.requested, approval.granted, approval.denied, gate.allowed, gate.refused (rule = rule id), '
  'partner_api.call (value = ms), partner_api.cache_hit, crashtest.score (value = score, attrs.run), '
  'infra.check (rule = service, value = ms, ok).';

-- Read-only role for Grafana (created through the Aiven API as service user grafana_reader).
grant usage on schema telemetry to grafana_reader;
grant select on all tables in schema telemetry to grafana_reader;
alter default privileges in schema telemetry grant select on tables to grafana_reader;
-- Lets later panels read the app's own tables in public too, still without write access.
-- (avnadmin is not a superuser on Aiven and cannot grant pg_read_all_data.)
grant usage on schema public to grafana_reader;
grant select on all tables in schema public to grafana_reader;
alter default privileges for role avnadmin in schema public grant select on tables to grafana_reader;
-- Keep Grafana from holding more than a couple of the free plan's 20 connections.
alter role grafana_reader connection limit 3;
alter role grafana_reader set statement_timeout = '10s';
