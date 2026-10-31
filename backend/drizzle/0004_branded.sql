CREATE TYPE "public"."brand_status" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "auto_responders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_number_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"normal_message" text,
	"opt_out_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_responders_sender_number_id_unique" UNIQUE("sender_number_id")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_name" varchar(150) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"category" varchar(60) NOT NULL,
	"description" text,
	"website" varchar(255),
	"email" varchar(254) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"address" text NOT NULL,
	"tax_id" varchar(30),
	"contact_name" varchar(120) NOT NULL,
	"logo_media_id" uuid,
	"status" "brand_status" DEFAULT 'SUBMITTED' NOT NULL,
	"review_note" text,
	"sender_number_id" uuid,
	"submitted_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "auto_responders" ADD CONSTRAINT "auto_responders_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_responders" ADD CONSTRAINT "auto_responders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_sender_number_id_sender_numbers_id_fk" FOREIGN KEY ("sender_number_id") REFERENCES "public"."sender_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_account_idx" ON "brands" USING btree ("account_id");