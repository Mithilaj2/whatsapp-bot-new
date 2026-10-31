CREATE TYPE "public"."message_direction" AS ENUM('OUT', 'IN');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('TEMPLATE', 'TEXT', 'IMAGE', 'INTERACTIVE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('META', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."sender_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('MARKETING', 'UTILITY');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(512) NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"category" "template_category" DEFAULT 'MARKETING' NOT NULL,
	"content" jsonb NOT NULL,
	"status" "template_status" DEFAULT 'DRAFT' NOT NULL,
	"provider_template_id" varchar(64),
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"contact_name" varchar(120),
	"kind" "message_kind" NOT NULL,
	"template_id" uuid,
	"payload" jsonb,
	"body" text,
	"status" "message_status" NOT NULL,
	"provider_message_id" varchar(128),
	"error_code" varchar(32),
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"campaign_id" uuid,
	"reply_to_provider_id" varchar(128),
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(120) NOT NULL,
	"provider" "provider" NOT NULL,
	"service" "service" NOT NULL,
	"owner_account_id" uuid,
	"phone_number" varchar(20) NOT NULL,
	"display_name" varchar(120),
	"phone_number_id" varchar(64) NOT NULL,
	"waba_id" varchar(64) NOT NULL,
	"access_token_enc" text,
	"status" "sender_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"rate_per_second" integer DEFAULT 20 NOT NULL,
	"quality_rating" varchar(16),
	"messaging_limit" varchar(32),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_numbers" ADD CONSTRAINT "sender_numbers_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_number_name_lang_uq" ON "message_templates" USING btree ("sender_number_id","name","language");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_message_id_uq" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_queue_idx" ON "messages" USING btree ("next_attempt_at") WHERE "messages"."status" = 'QUEUED';--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("sender_number_id","contact_phone","created_at");--> statement-breakpoint
CREATE INDEX "messages_account_idx" ON "messages" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_numbers_provider_phone_id_uq" ON "sender_numbers" USING btree ("provider","phone_number_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");