/**
 * Dock's tables in PostgreSQL. Idempotent: every statement can run again on every start (`migrate()`), and
 * `pnpm aiven:migrate` runs the same from the command line. `S` is the schema (DOCK_PG_SCHEMA, default `dock`).
 *
 * Design: the core's records (orders, requests, kitchens, intakes, approvers, credentials, sessions, sandboxes,
 * passkey prompts) are documents in `jsonb`, keyed by collection and id, with a few real columns where a query
 * needs them (org, approval id, expiry). A field added to an order type in the core needs no migration.
 *
 * Two things are real tables because they carry invariants of their own:
 *   - used_quotes: "a quote is used once" is a primary key, so `claimQuote` is one atomic insert.
 *   - ledger: append-only (updates and deletes are refused by a trigger), and its hash chain is checked by
 *     constraints at insert time: the stored body hashes to `hash` (pgcrypto), the body's seq and prevHash
 *     match the columns, and prev_hash is the previous entry's hash (or the genesis hash for entry 0).
 *     `S.ledger_verify()` re-checks the whole chain in SQL.
 */
export const GENESIS = "0".repeat(64);

export function schemaSql(S: string): string {
  return `
create schema if not exists ${S};

create table if not exists ${S}.docs (
  collection  text        not null,
  id          text        not null,
  doc         jsonb       not null,
  org_id      text        generated always as (doc->>'orgId') stored,
  approval_id text        generated always as (doc->'approval'->>'approvalId') stored,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists docs_org_idx      on ${S}.docs (collection, org_id);
create index if not exists docs_approval_idx on ${S}.docs (approval_id) where approval_id is not null;
create index if not exists docs_expiry_idx   on ${S}.docs (collection, expires_at) where expires_at is not null;
create index if not exists docs_approver_idx on ${S}.docs (collection, (doc->>'approverId'));
create index if not exists docs_role_idx     on ${S}.docs (collection, org_id, (doc->>'role'));
comment on table ${S}.docs is 'Dock records as jsonb documents. collections: request, order, kitchen, intake, approver, credential, session, ceremony, sandbox.';

create table if not exists ${S}.used_quotes (
  quote_id text        primary key,
  used_at  timestamptz not null default now()
);
comment on table ${S}.used_quotes is 'A quote can be ordered against once: the primary key is the replay guard.';

create table if not exists ${S}.ledger (
  seq        bigint      primary key check (seq >= 0),
  at         timestamptz not null,
  type       text        not null,
  actor      text        not null,
  request_id text,
  order_id   text,
  body       text        not null,
  prev_hash  text        not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash       text        not null unique,
  written_at timestamptz not null default now(),
  constraint ledger_hash_is_body_digest check (hash = encode(public.digest(body, 'sha256'), 'hex')),
  constraint ledger_body_matches_columns check (
    (body::jsonb->>'seq')::bigint = seq and body::jsonb->>'prevHash' = prev_hash and body::jsonb->>'type' = type
  )
);
create index if not exists ledger_request_idx on ${S}.ledger (request_id) where request_id is not null;
create index if not exists ledger_order_idx   on ${S}.ledger (order_id)   where order_id is not null;
comment on table ${S}.ledger is 'Append-only hash-chained audit log. body is the canonical JSON Ledger.hashOf hashes; hash = sha256(body).';

create or replace function ${S}.ledger_chain_guard() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'the ledger is append-only: % refused', tg_op using errcode = 'insufficient_privilege';
  end if;
  if new.seq = 0 then
    if new.prev_hash <> '${GENESIS}' then
      raise exception 'ledger entry 0 must point to the genesis hash' using errcode = 'check_violation';
    end if;
  elsif not exists (select 1 from ${S}.ledger where seq = new.seq - 1 and hash = new.prev_hash) then
    raise exception 'ledger entry % does not point to entry %', new.seq, new.seq - 1 using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists ledger_chain_guard on ${S}.ledger;
create trigger ledger_chain_guard before insert or update or delete on ${S}.ledger
  for each row execute function ${S}.ledger_chain_guard();

-- The whole chain re-checked in SQL: first problem found, or ok with the head.
create or replace function ${S}.ledger_verify()
returns table (ok boolean, length bigint, head_seq bigint, head_hash text, broken_at bigint, problem text)
language sql stable as $$
  with c as (
    select seq, hash, prev_hash, body,
           row_number() over (order by seq) - 1 as pos,
           lag(hash) over (order by seq) as prev
      from ${S}.ledger
  ), bad as (
    select seq,
           case when seq <> pos then 'sequence_gap'
                when prev_hash <> coalesce(prev, '${GENESIS}') then 'chain_break'
                when hash <> encode(public.digest(body, 'sha256'), 'hex') then 'hash_mismatch'
           end as problem
      from c
  )
  select (select count(*) = 0 from bad where problem is not null),
         (select count(*) from ${S}.ledger),
         (select max(seq) from ${S}.ledger),
         (select hash from ${S}.ledger order by seq desc limit 1),
         (select min(seq) from bad where problem is not null),
         (select problem from bad where problem is not null order by seq limit 1)
$$;

-- Read-only access for Grafana (role created in infra/telemetry.sql); skipped where the role does not exist.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'grafana_reader') then
    execute 'grant usage on schema ${S} to grafana_reader';
    execute 'grant select on all tables in schema ${S} to grafana_reader';
  end if;
end $$;

-- telemetry.events (infra/telemetry.sql): one row per event id, so the Kafka sink can write at-least-once.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'telemetry' and table_name = 'events') then
    execute 'create unique index if not exists events_event_id_uq on telemetry.events ((attrs->>''event_id'')) where attrs ? ''event_id''';
  end if;
end $$;
`;
}

/** Same layout, for the case where telemetry.events was never applied (a fresh database, tests). */
export const TELEMETRY_SQL = `
create schema if not exists telemetry;
create table if not exists telemetry.events (
  id        bigint generated always as identity primary key,
  ts        timestamptz      not null default now(),
  source    text             not null,
  kind      text             not null,
  rule      text,
  agent_id  text,
  order_id  text,
  value     double precision,
  ok        boolean,
  attrs     jsonb            not null default '{}'::jsonb
);
create index if not exists events_ts_idx      on telemetry.events (ts desc);
create index if not exists events_kind_ts_idx on telemetry.events (kind, ts desc);
`;
