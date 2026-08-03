CREATE TABLE "lead_outcomes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_outcomes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"buyer_user_id" varchar,
	"outcome" varchar(20) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_outcome_per_order" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_timestamp" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_user_agent" varchar(500);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_disclosure_text" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consent_source_url" varchar(500);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_party" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "status_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "status_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_outcomes" ADD CONSTRAINT "lead_outcomes_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outcomes_lead" ON "lead_outcomes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_outcomes_outcome" ON "lead_outcomes" USING btree ("outcome");