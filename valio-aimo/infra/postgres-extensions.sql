-- Extensions enabled on dock-pg (Aiven for PostgreSQL 18, free-1-1gb). Idempotent; applied on 13 Nov 2026.
-- The free plan allows extensions (75 available); these are the ones Dock is likely to use.
create extension if not exists vector;              -- pgvector 0.8: embeddings for kitchen memory / product similarity
create extension if not exists pg_trgm;             -- trigram fuzzy matching on product names (fi, sv, en)
create extension if not exists unaccent;            -- fold ä/ö/å so "maito" ~ "Maito", "smör" ~ "smor"
create extension if not exists pgcrypto;            -- digest() for the hash-chained audit ledger, gen_random_uuid()
create extension if not exists pg_stat_statements;  -- query stats (also used by Aiven MCP "slow queries")
-- Also available, not enabled: citext, btree_gist, pg_cron, timescaledb, postgis, pgaudit.
-- Text search configs present: simple, english, finnish, swedish (and others).
