CREATE TABLE "admin_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_user_id" varchar NOT NULL,
	"org_id" varchar,
	"action" varchar(80) NOT NULL,
	"target_kind" varchar(40),
	"target_id" varchar(100),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_disputes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_disputes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"buyer_user_id" varchar NOT NULL,
	"reason" varchar(80) NOT NULL,
	"notes" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolver_user_id" varchar,
	"resolved_at" timestamp,
	"refund_cents" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_dispute_per_order" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_balances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendor_balances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"pending_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "vendor_balances_vendor_id_unique" UNIQUE("vendor_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_payouts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendor_payouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"order_id" integer,
	"lead_id" integer,
	"stripe_transfer_id" varchar(200),
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tcpa_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tcpa_cert_id" varchar(200);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tcpa_verified_source" varchar(50);--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD CONSTRAINT "lead_disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD CONSTRAINT "lead_disputes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD CONSTRAINT "lead_disputes_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD CONSTRAINT "lead_disputes_resolver_user_id_users_id_fk" FOREIGN KEY ("resolver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_balances" ADD CONSTRAINT "vendor_balances_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "admin_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_disputes_status" ON "lead_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_disputes_order" ON "lead_disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_payouts_vendor" ON "vendor_payouts" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_payouts_kind" ON "vendor_payouts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_vendor_payouts_created" ON "vendor_payouts" USING btree ("created_at");