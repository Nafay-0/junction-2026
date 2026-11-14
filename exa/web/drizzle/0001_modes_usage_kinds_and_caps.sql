ALTER TABLE "usage_events" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "effort" integer;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "decision_cost_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "decision_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "modes" text[] DEFAULT '{ultrafast}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_usage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "usage_cap_usd" double precision;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" in ('chat', 'voice', 'tool'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_modes_check" CHECK (cardinality("users"."modes") >= 1);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_usage_cap_check" CHECK ("users"."usage_cap_usd" is null or "users"."usage_cap_usd" > 0);--> statement-breakpoint
-- Rows written before this migration, brought in line by hand (drizzle-kit only writes the columns).
-- A tool that ran for a live call was recorded under the voice model with no tokens of its own.
UPDATE "usage_events" SET "kind" = 'tool' WHERE "model_id" = 'gemini-3.8-live' AND "input_tokens" = 0 AND "output_tokens" = 0;--> statement-breakpoint
-- The voice of a call, and voice input.
UPDATE "usage_events" SET "kind" = 'voice' WHERE "model_id" IN ('gemini-3.8-live', 'gemini-3.5-transcribe-live') AND ("input_tokens" > 0 OR "output_tokens" > 0);--> statement-breakpoint
-- Typed requests from before modes: the mode each model now stands behind. Other models stay without one.
UPDATE "usage_events" SET "mode" = CASE "model_id" WHEN 'gemini-4-hydrogen' THEN 'ultrafast' WHEN 'claude-sonnet-5-5' THEN 'fast' WHEN 'claude-opus-5-5' THEN 'smart' WHEN 'gemini-4-carbon' THEN 'expert' END WHERE "kind" = 'chat' AND "model_id" IN ('gemini-4-hydrogen', 'claude-sonnet-5-5', 'claude-opus-5-5', 'gemini-4-carbon');
