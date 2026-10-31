CREATE TYPE "public"."bot_session_status" AS ENUM('ACTIVE', 'COMPLETED', 'HANDOFF', 'ENDED');--> statement-breakpoint
CREATE TABLE "bot_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"contact_name" varchar(120),
	"status" "bot_session_status" DEFAULT 'ACTIVE' NOT NULL,
	"node_id" varchar(40),
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"handoff_until" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"sender_number_id" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"flow" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_sessions_contact_idx" ON "bot_sessions" USING btree ("sender_number_id","contact_phone","last_activity_at");--> statement-breakpoint
CREATE INDEX "bot_sessions_bot_idx" ON "bot_sessions" USING btree ("bot_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "bots_account_idx" ON "bots" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bots_active_number_uq" ON "bots" USING btree ("sender_number_id") WHERE "bots"."is_active";