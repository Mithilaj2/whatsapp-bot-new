CREATE TYPE "public"."campaign_status" AS ENUM('PENDING_APPROVAL', 'SENDING', 'COMPLETED', 'CANCELLED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_no" varchar(8) NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"service" "service" NOT NULL,
	"title" varchar(150) NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"status" "campaign_status" NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"total_numbers" integer NOT NULL,
	"invalid_numbers" integer NOT NULL,
	"duplicate_numbers" integer NOT NULL,
	"opted_out_numbers" integer NOT NULL,
	"recipients" integer NOT NULL,
	"by_country" jsonb NOT NULL,
	"credits_charged" integer NOT NULL,
	"credits_refunded" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_campaign_no_unique" UNIQUE("campaign_no")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" varchar(80) NOT NULL,
	"original_name" varchar(255),
	"mime_type" varchar(50) NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"contact_name" varchar(120),
	"account_id" uuid,
	"mode" varchar(10) NOT NULL,
	"remarks" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "campaign_defaults" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_account_idx" ON "campaigns" USING btree ("account_id","submitted_at");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "opt_outs_number_contact_uq" ON "opt_outs" USING btree ("sender_number_id","contact_phone");