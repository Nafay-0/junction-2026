CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"output" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "job_runs_trigger_check" CHECK ("job_runs"."trigger" in ('schedule', 'manual')),
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" in ('running', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"schedule_text" text NOT NULL,
	"time_zone" text NOT NULL,
	"until_at" timestamp with time zone,
	"max_runs" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"mode" text NOT NULL,
	"effort" integer DEFAULT 1 NOT NULL,
	"place" text,
	"country" text,
	"coords" jsonb,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('active', 'paused', 'done')),
	CONSTRAINT "jobs_max_runs_check" CHECK ("jobs"."max_runs" is null or "jobs"."max_runs" > 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"conversation_id" text,
	"job_id" uuid,
	"run_id" uuid,
	"dedupe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('chat_done', 'needs_you', 'job_done', 'job_failed'))
);
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_kind_check";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "notify_when_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("user_id","dedupe");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" in ('chat', 'voice', 'tool', 'job'));