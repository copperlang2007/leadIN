CREATE TABLE "agency_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agency_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"slug" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"bio" text,
	"specialties" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"carriers" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"public_email" varchar(255),
	"public_phone" varchar(20),
	"website_url" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "agency_profiles_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "agency_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_reputation_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_reputation_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"weight" integer NOT NULL,
	"related_lead_id" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_spend_caps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_spend_caps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"monthly_limit_cents" integer NOT NULL,
	"current_spend_cents" integer DEFAULT 0 NOT NULL,
	"period_started_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_spend_caps_agent_user_id_unique" UNIQUE("agent_user_id")
);
--> statement-breakpoint
CREATE TABLE "bulk_order_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bulk_order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bulk_order_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"assigned_agent_user_id" varchar,
	"order_id" integer
);
--> statement-breakpoint
CREATE TABLE "bulk_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bulk_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"buyer_user_id" varchar NOT NULL,
	"org_id" varchar,
	"requested_count" integer NOT NULL,
	"filter_criteria" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"fanout_completed_at" timestamp,
	"total_price_cents" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "call_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"lead_id" integer,
	"twilio_sid" varchar(100),
	"status" varchar(30) NOT NULL,
	"duration_sec" integer,
	"recording_url" text,
	"started_at" timestamp DEFAULT now(),
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversation_assists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_assists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"call_log_id" integer NOT NULL,
	"trigger_phrase" text,
	"suggestion" text NOT NULL,
	"emitted_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_connections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm_connections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"provider" varchar(30) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scopes" text,
	"external_account_id" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_crm_org_provider" UNIQUE("org_id","provider")
);
--> statement-breakpoint
CREATE TABLE "crm_sync_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm_sync_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connection_id" integer NOT NULL,
	"direction" varchar(10) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" varchar(255),
	"external_id" varchar(255),
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_bundle_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_bundle_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bundle_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	CONSTRAINT "uniq_bundle_lead" UNIQUE("bundle_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "lead_bundles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_bundles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price_cents_per_lead" integer NOT NULL,
	"total_lead_count" integer NOT NULL,
	"expires_at" timestamp,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"agent_user_id" varchar NOT NULL,
	"org_id" varchar,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"bid_amount_cents" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_personas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_personas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"persona" text NOT NULL,
	"predicted_objections" jsonb,
	"best_approach" text,
	"generated_at" timestamp DEFAULT now(),
	"model_used" varchar(100),
	CONSTRAINT "lead_personas_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "lead_price_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_price_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"reason" varchar(50) NOT NULL,
	"surge_multiplier" numeric(4, 2),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_integration_installs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketplace_integration_installs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"integration_id" integer NOT NULL,
	"org_id" varchar NOT NULL,
	"config" jsonb,
	"installed_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_install" UNIQUE("integration_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_integrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketplace_integrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"developer" varchar(255),
	"category" varchar(40) NOT NULL,
	"description" text,
	"logo_url" text,
	"install_count" integer DEFAULT 0 NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "marketplace_integrations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "news_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "news_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category" varchar(50) NOT NULL,
	"state" varchar(2),
	"county" varchar(100),
	"headline" text NOT NULL,
	"summary" text,
	"effective_date" timestamp,
	"source" varchar(200),
	"fetched_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_branding" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "org_branding_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"custom_domain" varchar(255),
	"logo_url" text,
	"primary_color_hex" varchar(7),
	"product_name" varchar(100),
	"support_email" varchar(255),
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "org_branding_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outreach_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"channel" varchar(10) NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"generated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "referral_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(30) NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"owner_kind" varchar(10) NOT NULL,
	"reward_pct" numeric(4, 3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "referrals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code_id" integer NOT NULL,
	"referee_user_id" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"qualified_at" timestamp,
	"reward_cents" integer,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_referral_per_referee" UNIQUE("referee_user_id")
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "routing_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "smart_match_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "smart_match_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"org_id" varchar,
	"monthly_lead_quota" integer NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"filter_criteria" jsonb NOT NULL,
	"stripe_subscription_id" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"cycles_delivered" integer DEFAULT 0 NOT NULL,
	"leads_delivered_this_cycle" integer DEFAULT 0 NOT NULL,
	"cycle_started_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sms_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"lead_id" integer,
	"twilio_sid" varchar(100),
	"direction" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tcpa_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tcpa_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"policy_id" integer NOT NULL,
	"order_id" integer,
	"agent_user_id" varchar,
	"claim_reason" text,
	"amount_claimed_cents" integer NOT NULL,
	"amount_paid_cents" integer,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"filed_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tcpa_policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tcpa_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"carrier_name" varchar(255),
	"per_claim_limit_cents" integer DEFAULT 2500000 NOT NULL,
	"aggregate_limit_cents" integer DEFAULT 10000000 NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"ends_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transcripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"call_log_id" integer NOT NULL,
	"text" text NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "transcripts_call_log_id_unique" UNIQUE("call_log_id")
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "nipr_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "nipr_license_expiry" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "nipr_last_error" text;--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD COLUMN "ai_classification" varchar(40);--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD COLUMN "ai_confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD COLUMN "auto_replacement_order_id" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "enrichment_json" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "mediscore_explanation" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "best_call_windows_json" jsonb;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "is_exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "rev_share_override" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "agency_profiles" ADD CONSTRAINT "agency_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reputation_events" ADD CONSTRAINT "agent_reputation_events_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reputation_events" ADD CONSTRAINT "agent_reputation_events_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spend_caps" ADD CONSTRAINT "agent_spend_caps_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spend_caps" ADD CONSTRAINT "agent_spend_caps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_order_items" ADD CONSTRAINT "bulk_order_items_bulk_order_id_bulk_orders_id_fk" FOREIGN KEY ("bulk_order_id") REFERENCES "public"."bulk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_order_items" ADD CONSTRAINT "bulk_order_items_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_order_items" ADD CONSTRAINT "bulk_order_items_assigned_agent_user_id_users_id_fk" FOREIGN KEY ("assigned_agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_order_items" ADD CONSTRAINT "bulk_order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_orders" ADD CONSTRAINT "bulk_orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_orders" ADD CONSTRAINT "bulk_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assists" ADD CONSTRAINT "conversation_assists_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sync_events" ADD CONSTRAINT "crm_sync_events_connection_id_crm_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."crm_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_bundle_items" ADD CONSTRAINT "lead_bundle_items_bundle_id_lead_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."lead_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_bundle_items" ADD CONSTRAINT "lead_bundle_items_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_bundles" ADD CONSTRAINT "lead_bundles_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_claims" ADD CONSTRAINT "lead_claims_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_claims" ADD CONSTRAINT "lead_claims_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_claims" ADD CONSTRAINT "lead_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_personas" ADD CONSTRAINT "lead_personas_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_price_history" ADD CONSTRAINT "lead_price_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_integration_installs" ADD CONSTRAINT "marketplace_integration_installs_integration_id_marketplace_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."marketplace_integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_integration_installs" ADD CONSTRAINT "marketplace_integration_installs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_branding" ADD CONSTRAINT "org_branding_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_id_referral_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_match_subscriptions" ADD CONSTRAINT "smart_match_subscriptions_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_match_subscriptions" ADD CONSTRAINT "smart_match_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_claims" ADD CONSTRAINT "tcpa_claims_policy_id_tcpa_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tcpa_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_claims" ADD CONSTRAINT "tcpa_claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_claims" ADD CONSTRAINT "tcpa_claims_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_policies" ADD CONSTRAINT "tcpa_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_repu_agent" ON "agent_reputation_events" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_repu_created" ON "agent_reputation_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bulk_buyer" ON "bulk_orders" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "idx_calls_agent" ON "call_logs" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_calls_lead" ON "call_logs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_crm_events_conn" ON "crm_sync_events" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "idx_bundles_vendor" ON "lead_bundles" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_bundles_status" ON "lead_bundles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_claims_lead" ON "lead_claims" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_claims_agent" ON "lead_claims" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_claims_status" ON "lead_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_price_history_lead" ON "lead_price_history" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_price_history_created" ON "lead_price_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_news_state" ON "news_events" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_news_category" ON "news_events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_outreach_lead" ON "outreach_drafts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_rules_org" ON "routing_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_smartmatch_agent" ON "smart_match_subscriptions" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_sms_lead" ON "sms_logs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_tcpa_claims_status" ON "tcpa_claims" USING btree ("status");--> statement-breakpoint
ALTER TABLE "lead_disputes" ADD CONSTRAINT "lead_disputes_auto_replacement_order_id_orders_id_fk" FOREIGN KEY ("auto_replacement_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;