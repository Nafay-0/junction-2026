-- The operations copilot's read-only window on dock-pg. Idempotent; applied by infra/copilot-user.mjs.
--
-- The copilot (web/src/server/aiven/showcase/) answers staff questions with SQL. It connects as its own
-- service user, dock_copilot, which can read ONE view and nothing else:
--   * not the raw telemetry table, not the app's schemas (orders, kitchens, kitchen memory, passkeys),
--     not partner_data, not public;
--   * every session is read-only (default_transaction_read_only), statements stop after 3 s,
--     the role holds at most 2 of the free plan's 20 connections.
-- The application checks the same things again before a query is sent (sql-guard.ts); this file is the
-- part that holds even if that code were wrong.

create or replace view telemetry.ops_events with (security_barrier = true) as
select
  id, ts, source, kind, rule, agent_id, order_id, value, ok,
  attrs->>'request_id'                                   as request_id,
  attrs->>'org_id'                                       as org_id,
  (attrs->>'ledger_seq')::bigint                         as ledger_seq,
  -- Intake steps can quote a kitchen's private memory (its usual amounts, its own rules): withheld here.
  case when kind = 'intake.step' then null else left(attrs->>'summary', 300) end as summary,
  attrs->>'outcome'                                      as outcome,
  attrs->>'method'                                       as method,
  attrs->>'detail'                                       as detail,
  (attrs->>'products')::int                              as products,
  attrs->>'run'                                          as run
from telemetry.events;

comment on view telemetry.ops_events is
  'What the operations copilot may read: telemetry.events without intake-step summaries and without free-form attrs.';

revoke all on schema public from dock_copilot;
revoke all on all tables in schema telemetry from dock_copilot;
grant usage on schema telemetry to dock_copilot;
grant select on telemetry.ops_events to dock_copilot;

alter role dock_copilot connection limit 2;
alter role dock_copilot set default_transaction_read_only = on;
alter role dock_copilot set statement_timeout = '3s';
alter role dock_copilot set idle_in_transaction_session_timeout = '5s';
alter role dock_copilot set search_path = telemetry;
