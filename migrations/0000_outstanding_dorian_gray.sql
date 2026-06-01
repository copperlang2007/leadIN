CREATE TABLE "agent_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"licensed_states" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"appointed_carriers" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"territory_zips" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"territory_counties" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"license_number" varchar(100),
	"license_document_url" text,
	"verification_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"capacity_limit" integer DEFAULT 25 NOT NULL,
	"conversion_rate" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
	"accepting_leads" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "behavioral_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "behavioral_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(64) NOT NULL,
	"lead_id" integer,
	"user_id" varchar,
	"event_type" varchar(50) NOT NULL,
	"path" varchar(500),
	"value" integer,
	"metadata" jsonb,
	"user_agent" varchar(500),
	"ip" varchar(64),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cms_plan_signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_plan_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"plan_id" varchar(100) NOT NULL,
	"carrier" varchar(255),
	"state" varchar(2) NOT NULL,
	"county" varchar(100),
	"signal_type" varchar(50) NOT NULL,
	"star_rating" numeric(2, 1),
	"effective_date" timestamp,
	"details" jsonb,
	"fetched_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_cms_plan_signal" UNIQUE("plan_id","signal_type","effective_date")
);
--> statement-breakpoint
CREATE TABLE "content_articles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"excerpt" text NOT NULL,
	"body" text NOT NULL,
	"category" varchar(100) NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"seo_title" varchar(500),
	"seo_description" text,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "content_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "keyword_signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "keyword_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keyword" varchar(300) NOT NULL,
	"source" varchar(50) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"position" numeric(6, 2) DEFAULT '0' NOT NULL,
	"opportunity_score" integer DEFAULT 0 NOT NULL,
	"category" varchar(100),
	"fetched_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_kw_source" UNIQUE("keyword","source")
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"org_id" varchar NOT NULL,
	"agent_user_id" varchar NOT NULL,
	"match_score" integer NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'assigned' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"org_id" varchar,
	"assigned_to_user_id" varchar,
	"assigned_at" timestamp,
	"type" varchar(100) NOT NULL,
	"source" varchar(100) NOT NULL,
	"exclusivity" varchar(50) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"consumer_age" integer NOT NULL,
	"state" varchar(2) NOT NULL,
	"zip_code" varchar(10) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"compatibility_score" integer DEFAULT 0 NOT NULL,
	"consumer_name" varchar(255),
	"consumer_phone" varchar(20),
	"consumer_email" varchar(255),
	"consumer_address" varchar(500),
	"income" varchar(50),
	"has_condition" boolean,
	"homeowner" boolean,
	"gender" varchar(1),
	"smoker" boolean,
	"provenance" jsonb NOT NULL,
	"dnc_flagged" boolean DEFAULT false NOT NULL,
	"dnc_checked_at" timestamp,
	"mediscore" integer DEFAULT 0 NOT NULL,
	"mediscore_signals" jsonb,
	"session_id" varchar(64),
	"sold" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"sold_at" timestamp,
	"purchased_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"lead_id" integer NOT NULL,
	"type" varchar(50) DEFAULT 'new_lead' NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_notification_user_lead" UNIQUE("user_id","lead_id","type")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"org_id" varchar,
	"lead_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "org_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar(20) DEFAULT 'agent' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_org_member" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"billing_mode" varchar(20) DEFAULT 'per_lead' NOT NULL,
	"subscription_tier" varchar(50),
	"subscription_status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"routing_score_threshold" integer DEFAULT 70 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_checkout_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stripe_checkout_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"stripe_session_id" varchar(255) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "stripe_checkout_sessions_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"licensed_states" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"preferred_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"balance" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"active_org_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendor_api_keys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendor_api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"org_id" varchar,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "vendor_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"rating" numeric(2, 1) DEFAULT '0.0' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_events" ADD CONSTRAINT "behavioral_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavioral_events" ADD CONSTRAINT "behavioral_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_purchased_by_users_id_fk" FOREIGN KEY ("purchased_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkout_sessions" ADD CONSTRAINT "stripe_checkout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_api_keys" ADD CONSTRAINT "vendor_api_keys_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_api_keys" ADD CONSTRAINT "vendor_api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_profiles_org" ON "agent_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_events_session" ON "behavioral_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_events_lead" ON "behavioral_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_events_type" ON "behavioral_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_events_created" ON "behavioral_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cms_state" ON "cms_plan_signals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_cms_county" ON "cms_plan_signals" USING btree ("county");--> statement-breakpoint
CREATE INDEX "idx_articles_slug" ON "content_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_articles_published" ON "content_articles" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_articles_category" ON "content_articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_kw_opportunity" ON "keyword_signals" USING btree ("opportunity_score");--> statement-breakpoint
CREATE INDEX "idx_assignments_lead" ON "lead_assignments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_agent" ON "lead_assignments" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_assignments_org" ON "lead_assignments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_leads_state" ON "leads" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_leads_type" ON "leads" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_leads_sold" ON "leads" USING btree ("sold");--> statement-breakpoint
CREATE INDEX "idx_leads_org" ON "leads" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_leads_assigned" ON "leads" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_org" ON "orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_org_members_user" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_org" ON "org_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_orgs_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_vendor_keys_prefix" ON "vendor_api_keys" USING btree ("key_prefix");