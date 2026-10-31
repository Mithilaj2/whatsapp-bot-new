CREATE TYPE "public"."credit_txn_type" AS ENUM('CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'SPENT', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."service" AS ENUM('PREMIUM', 'BRANDED');--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"account_id" uuid NOT NULL,
	"service" "service" NOT NULL,
	"country_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_account_id_service_country_id_pk" PRIMARY KEY("account_id","service","country_id"),
	CONSTRAINT "credit_balances_not_negative" CHECK ("credit_balances"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"service" "service" NOT NULL,
	"country_id" uuid NOT NULL,
	"type" "credit_txn_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"counterparty_id" uuid,
	"group_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"campaign_no" varchar(12),
	"recipients" integer,
	"remarks" varchar(255),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_txn_amount_not_zero" CHECK ("credit_transactions"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_counterparty_id_accounts_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_txn_account_idx" ON "credit_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_txn_campaign_idx" ON "credit_transactions" USING btree ("campaign_id");