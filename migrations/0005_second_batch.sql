CREATE TABLE "affiliate_payouts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "affiliate_payouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"affiliate_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stripe_transfer_id" varchar(200),
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "affiliates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "affiliates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"affiliate_code" varchar(30) NOT NULL,
	"payout_method" varchar(20) DEFAULT 'stripe' NOT NULL,
	"tax_form_url" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_earned_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "affiliates_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "affiliates_affiliate_code_unique" UNIQUE("affiliate_code")
);
--> statement-breakpoint
CREATE TABLE "agent_achievements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_achievements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"achievement_key" varchar(60) NOT NULL,
	"earned_at" timestamp DEFAULT now(),
	"meta" jsonb,
	CONSTRAINT "uniq_agent_achievement" UNIQUE("agent_user_id","achievement_key")
);
--> statement-breakpoint
CREATE TABLE "agent_certifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_certifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"cert_key" varchar(60) NOT NULL,
	"score_pct" integer DEFAULT 0 NOT NULL,
	"passed_at" timestamp,
	"certificate_url" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_agent_cert" UNIQUE("agent_user_id","cert_key")
);
--> statement-breakpoint
CREATE TABLE "agent_streaks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_streaks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"streak_date" timestamp NOT NULL,
	"activity_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_agent_streak_day" UNIQUE("agent_user_id","streak_date")
);
--> statement-breakpoint
CREATE TABLE "carrier_direct_pipelines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carrier_direct_pipelines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"carrier_name" varchar(255) NOT NULL,
	"carrier_product_code" varchar(100),
	"pipeline_key" varchar(100) NOT NULL,
	"api_endpoint" text,
	"api_credentials_json" jsonb,
	"status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"bindings_count" integer DEFAULT 0 NOT NULL,
	"last_binding_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_carrier_pipeline" UNIQUE("org_id","pipeline_key")
);
--> statement-breakpoint
CREATE TABLE "cms_filings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_filings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"filing_kind" varchar(40) NOT NULL,
	"material_url" text,
	"submitted_at" timestamp,
	"cms_id" varchar(100),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"review_notes" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commission_escrows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commission_escrows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"agent_user_id" varchar,
	"amount_cents" integer NOT NULL,
	"status" varchar(30) DEFAULT 'held' NOT NULL,
	"release_at" timestamp,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "commission_escrows_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_certifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "compliance_certifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"cert_kind" varchar(40) NOT NULL,
	"level" varchar(20) DEFAULT 'bronze' NOT NULL,
	"score_pct" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"badge_url" text,
	CONSTRAINT "uniq_compliance_cert" UNIQUE("org_id","cert_kind")
);
--> statement-breakpoint
CREATE TABLE "credit_lines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"org_id" varchar,
	"limit_cents" integer NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"apr_bps" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_repayments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_repayments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"line_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"order_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_challenges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"challenge_kind" varchar(40) NOT NULL,
	"target_value" integer NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"for_date" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_daily_challenge" UNIQUE("agent_user_id","challenge_kind","for_date")
);
--> statement-breakpoint
CREATE TABLE "data_product_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_product_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"subscriber_user_id" varchar NOT NULL,
	"org_id" varchar,
	"stripe_subscription_id" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_data_product_sub" UNIQUE("product_id","subscriber_user_id")
);
--> statement-breakpoint
CREATE TABLE "data_products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"cadence" varchar(20),
	"sample_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "data_products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "defense_packets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "defense_packets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"complaint_id" integer,
	"org_id" varchar,
	"packet_url" text,
	"evidence_json" jsonb,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "direct_mail_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_mail_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"buyer_user_id" varchar NOT NULL,
	"org_id" varchar,
	"campaign_name" varchar(200) NOT NULL,
	"target_count" integer NOT NULL,
	"zips_json" jsonb NOT NULL,
	"piece_template" varchar(60),
	"price_per_piece_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"mailed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "doi_complaints" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "doi_complaints_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar,
	"agent_user_id" varchar,
	"state" varchar(2) NOT NULL,
	"complaint_number" varchar(100),
	"filed_at" timestamp NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"summary" text,
	"defense_packet_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "landing_pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"slug" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"blocks_json" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"views_count" integer DEFAULT 0 NOT NULL,
	"leads_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "landing_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "language_packs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "language_packs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"locale" varchar(10) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"translations_json" jsonb NOT NULL,
	"coverage_pct" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "language_packs_locale_unique" UNIQUE("locale")
);
--> statement-breakpoint
CREATE TABLE "lead_audio_tours" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_audio_tours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"audio_url" text NOT NULL,
	"transcript" text,
	"duration_sec" integer,
	"generated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_audio_tours_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "lead_option_contracts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_option_contracts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"option_id" integer NOT NULL,
	"holder_user_id" varchar NOT NULL,
	"paid_premium_cents" integer NOT NULL,
	"exercised_at" timestamp,
	"exercise_lead_id" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_options" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_options_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"writer_vendor_id" integer,
	"strike_cents" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"criteria_json" jsonb NOT NULL,
	"premium_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_share_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_share_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"share_id" integer NOT NULL,
	"member_user_id" varchar NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_share_member" UNIQUE("share_id","member_user_id")
);
--> statement-breakpoint
CREATE TABLE "lead_shares" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_user_id" varchar NOT NULL,
	"org_id" varchar,
	"lead_id" integer NOT NULL,
	"split_pct" numeric(5, 2) DEFAULT '50.00' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_tradein_credits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_tradein_credits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"agent_user_id" varchar NOT NULL,
	"credit_cents" integer NOT NULL,
	"reason" varchar(60),
	"status" varchar(20) DEFAULT 'issued' NOT NULL,
	"redeemed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_tradein_credits_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "lead_xray_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lead_xray_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"unique_viewers" integer DEFAULT 0 NOT NULL,
	"avg_dwell_sec" integer DEFAULT 0 NOT NULL,
	"similar_sold_count" integer DEFAULT 0 NOT NULL,
	"similar_avg_close_rate_pct" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_xray_stats_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "mediscore_api_keys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mediscore_api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar,
	"customer_name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"monthly_quota" integer DEFAULT 10000 NOT NULL,
	"price_per_call_cents" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "mediscore_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "mediscore_api_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mediscore_api_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"api_key_id" integer NOT NULL,
	"endpoint" varchar(100) NOT NULL,
	"status_code" integer NOT NULL,
	"latency_ms" integer,
	"billed_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mentor_matches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mentor_matches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mentor_user_id" varchar NOT NULL,
	"mentee_user_id" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"match_score" integer DEFAULT 0 NOT NULL,
	"sessions_held" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_mentor_mentee" UNIQUE("mentor_user_id","mentee_user_id")
);
--> statement-breakpoint
CREATE TABLE "news_briefs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "news_briefs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brief_date" timestamp NOT NULL,
	"headline" varchar(500) NOT NULL,
	"summary" text NOT NULL,
	"stories_json" jsonb,
	"audio_url" text,
	"published_at" timestamp,
	"views_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_news_brief_date" UNIQUE("brief_date")
);
--> statement-breakpoint
CREATE TABLE "obituary_signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "obituary_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" varchar(100) NOT NULL,
	"state" varchar(2),
	"county" varchar(100),
	"decedent_initials" varchar(8),
	"age" integer,
	"published_at" timestamp,
	"raw_snippet" text,
	"contactability" integer DEFAULT 0 NOT NULL,
	"converted_to_lead_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_per_close_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pay_per_close_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer NOT NULL,
	"agent_user_id" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"close_price_cents" integer,
	CONSTRAINT "pay_per_close_orders_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "pii_retention_policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pii_retention_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"lead_pii_days" integer DEFAULT 365 NOT NULL,
	"recording_days" integer DEFAULT 180 NOT NULL,
	"transcript_days" integer DEFAULT 365 NOT NULL,
	"auto_delete_enabled" boolean DEFAULT true NOT NULL,
	"last_sweep_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pii_retention_policies_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "provisioned_phone_numbers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provisioned_phone_numbers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar,
	"agent_user_id" varchar,
	"phone_number" varchar(20) NOT NULL,
	"twilio_sid" varchar(100),
	"capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"monthly_cost_cents" integer,
	"provisioned_at" timestamp DEFAULT now(),
	CONSTRAINT "provisioned_phone_numbers_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "public_webhooks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "public_webhooks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"target_url" text NOT NULL,
	"secret" varchar(128) NOT NULL,
	"event_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "quote_widgets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quote_widgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar NOT NULL,
	"widget_key" varchar(60) NOT NULL,
	"name" varchar(200) NOT NULL,
	"vertical" varchar(30) DEFAULT 'medicare' NOT NULL,
	"theme_json" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"embeds_count" integer DEFAULT 0 NOT NULL,
	"submits_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "quote_widgets_widget_key_unique" UNIQUE("widget_key")
);
--> statement-breakpoint
CREATE TABLE "refund_insurance_policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refund_insurance_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"premium_paid_cents" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"refund_issued_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "refund_insurance_policies_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "reverse_auction_bids" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reverse_auction_bids_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"auction_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"bid_cents" integer NOT NULL,
	"lead_count" integer NOT NULL,
	"note_text" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reverse_auctions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reverse_auctions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"buyer_user_id" varchar NOT NULL,
	"org_id" varchar,
	"criteria_json" jsonb NOT NULL,
	"max_bid_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"closes_at" timestamp NOT NULL,
	"awarded_bid_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sdk_install_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sdk_install_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sdk_name" varchar(60) NOT NULL,
	"sdk_version" varchar(30) NOT NULL,
	"install_source" varchar(30),
	"org_id" varchar,
	"count" integer DEFAULT 1 NOT NULL,
	"reported_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentiment_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sentiment_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"call_log_id" integer NOT NULL,
	"offset_sec" integer NOT NULL,
	"sentiment_score" numeric(4, 3) NOT NULL,
	"emotion" varchar(30),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tcpa_watchdog_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tcpa_watchdog_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar,
	"agent_user_id" varchar,
	"lead_id" integer,
	"event_kind" varchar(40) NOT NULL,
	"severity" varchar(10) DEFAULT 'warn' NOT NULL,
	"details" jsonb,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vendor_reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendor_reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vendor_id" integer NOT NULL,
	"reviewer_user_id" varchar NOT NULL,
	"order_id" integer,
	"rating" integer NOT NULL,
	"body" text,
	"verified" boolean DEFAULT false NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_vendor_review_per_order" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "video_call_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_call_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"call_log_id" integer,
	"agent_user_id" varchar NOT NULL,
	"lead_id" integer,
	"room_sid" varchar(100),
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"recording_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "voice_clones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voice_clones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"provider_voice_id" varchar(200),
	"provider" varchar(30) DEFAULT 'elevenlabs' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sample_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "voice_clones_agent_user_id_unique" UNIQUE("agent_user_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_cards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallet_cards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"stripe_card_id" varchar(255) NOT NULL,
	"last4" varchar(4) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "wallet_cards_stripe_card_id_unique" UNIQUE("stripe_card_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"webhook_id" integer NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"response_body" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"succeeded" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webinar_registrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webinar_registrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"webinar_id" integer NOT NULL,
	"user_id" varchar,
	"email" varchar(255) NOT NULL,
	"attended" boolean DEFAULT false NOT NULL,
	"certificate_url" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_webinar_reg" UNIQUE("webinar_id","email")
);
--> statement-breakpoint
CREATE TABLE "webinars" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webinars_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"presenter" varchar(255),
	"starts_at" timestamp NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"zoom_url" text,
	"replay_url" text,
	"ce_credits" numeric(3, 1),
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "webinars_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "wins_feed_posts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wins_feed_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_user_id" varchar NOT NULL,
	"org_id" varchar,
	"order_id" integer,
	"headline" varchar(280) NOT NULL,
	"amount_cents" integer,
	"state" varchar(2),
	"is_public" boolean DEFAULT true NOT NULL,
	"reactions_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wishlist_matches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wishlist_matches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wishlist_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"notified_at" timestamp,
	"purchased" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_wishlist_match" UNIQUE("wishlist_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wishlists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"org_id" varchar,
	"name" varchar(200) NOT NULL,
	"criteria_json" jsonb NOT NULL,
	"max_price_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "streak_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "vertical" varchar(30) DEFAULT 'medicare' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "pricing_mode" varchar(20) DEFAULT 'per_lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "compliance_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "aep_campaign_status" varchar(20);--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_achievements" ADD CONSTRAINT "agent_achievements_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_certifications" ADD CONSTRAINT "agent_certifications_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_streaks" ADD CONSTRAINT "agent_streaks_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_direct_pipelines" ADD CONSTRAINT "carrier_direct_pipelines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_filings" ADD CONSTRAINT "cms_filings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_escrows" ADD CONSTRAINT "commission_escrows_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_escrows" ADD CONSTRAINT "commission_escrows_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certifications" ADD CONSTRAINT "compliance_certifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lines" ADD CONSTRAINT "credit_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lines" ADD CONSTRAINT "credit_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_repayments" ADD CONSTRAINT "credit_repayments_line_id_credit_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."credit_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_repayments" ADD CONSTRAINT "credit_repayments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_product_subscriptions" ADD CONSTRAINT "data_product_subscriptions_product_id_data_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."data_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_product_subscriptions" ADD CONSTRAINT "data_product_subscriptions_subscriber_user_id_users_id_fk" FOREIGN KEY ("subscriber_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_product_subscriptions" ADD CONSTRAINT "data_product_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_packets" ADD CONSTRAINT "defense_packets_complaint_id_doi_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."doi_complaints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_packets" ADD CONSTRAINT "defense_packets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_mail_orders" ADD CONSTRAINT "direct_mail_orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_mail_orders" ADD CONSTRAINT "direct_mail_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doi_complaints" ADD CONSTRAINT "doi_complaints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doi_complaints" ADD CONSTRAINT "doi_complaints_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_audio_tours" ADD CONSTRAINT "lead_audio_tours_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_option_contracts" ADD CONSTRAINT "lead_option_contracts_option_id_lead_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."lead_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_option_contracts" ADD CONSTRAINT "lead_option_contracts_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_option_contracts" ADD CONSTRAINT "lead_option_contracts_exercise_lead_id_leads_id_fk" FOREIGN KEY ("exercise_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_options" ADD CONSTRAINT "lead_options_writer_vendor_id_vendors_id_fk" FOREIGN KEY ("writer_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_share_members" ADD CONSTRAINT "lead_share_members_share_id_lead_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."lead_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_share_members" ADD CONSTRAINT "lead_share_members_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_shares" ADD CONSTRAINT "lead_shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_shares" ADD CONSTRAINT "lead_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_shares" ADD CONSTRAINT "lead_shares_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tradein_credits" ADD CONSTRAINT "lead_tradein_credits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tradein_credits" ADD CONSTRAINT "lead_tradein_credits_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_xray_stats" ADD CONSTRAINT "lead_xray_stats_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediscore_api_keys" ADD CONSTRAINT "mediscore_api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediscore_api_usage" ADD CONSTRAINT "mediscore_api_usage_api_key_id_mediscore_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."mediscore_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_matches" ADD CONSTRAINT "mentor_matches_mentor_user_id_users_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_matches" ADD CONSTRAINT "mentor_matches_mentee_user_id_users_id_fk" FOREIGN KEY ("mentee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obituary_signals" ADD CONSTRAINT "obituary_signals_converted_to_lead_id_leads_id_fk" FOREIGN KEY ("converted_to_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_per_close_orders" ADD CONSTRAINT "pay_per_close_orders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_per_close_orders" ADD CONSTRAINT "pay_per_close_orders_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_retention_policies" ADD CONSTRAINT "pii_retention_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_phone_numbers" ADD CONSTRAINT "provisioned_phone_numbers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_phone_numbers" ADD CONSTRAINT "provisioned_phone_numbers_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_webhooks" ADD CONSTRAINT "public_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_widgets" ADD CONSTRAINT "quote_widgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_insurance_policies" ADD CONSTRAINT "refund_insurance_policies_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverse_auction_bids" ADD CONSTRAINT "reverse_auction_bids_auction_id_reverse_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."reverse_auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverse_auction_bids" ADD CONSTRAINT "reverse_auction_bids_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverse_auctions" ADD CONSTRAINT "reverse_auctions_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverse_auctions" ADD CONSTRAINT "reverse_auctions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_install_metrics" ADD CONSTRAINT "sdk_install_metrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_snapshots" ADD CONSTRAINT "sentiment_snapshots_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_watchdog_events" ADD CONSTRAINT "tcpa_watchdog_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_watchdog_events" ADD CONSTRAINT "tcpa_watchdog_events_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcpa_watchdog_events" ADD CONSTRAINT "tcpa_watchdog_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_call_sessions" ADD CONSTRAINT "video_call_sessions_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_call_sessions" ADD CONSTRAINT "video_call_sessions_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_call_sessions" ADD CONSTRAINT "video_call_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_public_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."public_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_webinar_id_webinars_id_fk" FOREIGN KEY ("webinar_id") REFERENCES "public"."webinars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_feed_posts" ADD CONSTRAINT "wins_feed_posts_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_feed_posts" ADD CONSTRAINT "wins_feed_posts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_feed_posts" ADD CONSTRAINT "wins_feed_posts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_affiliate_payouts_aff" ON "affiliate_payouts" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "idx_affiliate_payouts_status" ON "affiliate_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_achievements_agent" ON "agent_achievements" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_certs_agent" ON "agent_certifications" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_streaks_agent" ON "agent_streaks" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_carrier_pipelines_org" ON "carrier_direct_pipelines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_cms_filings_org" ON "cms_filings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_cms_filings_status" ON "cms_filings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_commission_escrows_agent" ON "commission_escrows" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_commission_escrows_status" ON "commission_escrows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compliance_certs_org" ON "compliance_certifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_credit_lines_user" ON "credit_lines" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_credit_lines_org" ON "credit_lines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_credit_repayments_line" ON "credit_repayments" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "idx_credit_repayments_kind" ON "credit_repayments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_daily_challenges_agent" ON "daily_challenges" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_daily_challenges_date" ON "daily_challenges" USING btree ("for_date");--> statement-breakpoint
CREATE INDEX "idx_data_product_subs_user" ON "data_product_subscriptions" USING btree ("subscriber_user_id");--> statement-breakpoint
CREATE INDEX "idx_data_products_kind" ON "data_products" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_defense_packets_org" ON "defense_packets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_defense_packets_complaint" ON "defense_packets" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "idx_direct_mail_buyer" ON "direct_mail_orders" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "idx_direct_mail_status" ON "direct_mail_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_doi_complaints_org" ON "doi_complaints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_doi_complaints_state" ON "doi_complaints" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_doi_complaints_status" ON "doi_complaints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_landing_pages_org" ON "landing_pages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_landing_pages_published" ON "landing_pages" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_lead_option_contracts_holder" ON "lead_option_contracts" USING btree ("holder_user_id");--> statement-breakpoint
CREATE INDEX "idx_lead_option_contracts_option" ON "lead_option_contracts" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "idx_lead_options_status" ON "lead_options" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_lead_options_expires" ON "lead_options" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_share_members_user" ON "lead_share_members" USING btree ("member_user_id");--> statement-breakpoint
CREATE INDEX "idx_lead_shares_owner" ON "lead_shares" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_lead_shares_lead" ON "lead_shares" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_tradein_agent" ON "lead_tradein_credits" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_lead_xray_lead" ON "lead_xray_stats" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_mediscore_api_keys_prefix" ON "mediscore_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_mediscore_usage_key" ON "mediscore_api_usage" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "idx_mediscore_usage_created" ON "mediscore_api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_mentor_matches_mentor" ON "mentor_matches" USING btree ("mentor_user_id");--> statement-breakpoint
CREATE INDEX "idx_mentor_matches_mentee" ON "mentor_matches" USING btree ("mentee_user_id");--> statement-breakpoint
CREATE INDEX "idx_news_briefs_published" ON "news_briefs" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_obituary_state" ON "obituary_signals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_obituary_published" ON "obituary_signals" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_ppc_agent" ON "pay_per_close_orders" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_ppc_status" ON "pay_per_close_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_phone_numbers_org" ON "provisioned_phone_numbers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_phone_numbers_agent" ON "provisioned_phone_numbers" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_public_webhooks_org" ON "public_webhooks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_public_webhooks_active" ON "public_webhooks" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_quote_widgets_org" ON "quote_widgets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_refund_ins_status" ON "refund_insurance_policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reverse_bids_auction" ON "reverse_auction_bids" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "idx_reverse_bids_vendor" ON "reverse_auction_bids" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_reverse_auctions_buyer" ON "reverse_auctions" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "idx_reverse_auctions_status" ON "reverse_auctions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sdk_install_name" ON "sdk_install_metrics" USING btree ("sdk_name");--> statement-breakpoint
CREATE INDEX "idx_sdk_install_reported" ON "sdk_install_metrics" USING btree ("reported_at");--> statement-breakpoint
CREATE INDEX "idx_sentiment_call" ON "sentiment_snapshots" USING btree ("call_log_id");--> statement-breakpoint
CREATE INDEX "idx_watchdog_org" ON "tcpa_watchdog_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_watchdog_severity" ON "tcpa_watchdog_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_watchdog_created" ON "tcpa_watchdog_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_vendor_reviews_vendor" ON "vendor_reviews" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_reviews_rating" ON "vendor_reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_video_call_agent" ON "video_call_sessions" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_video_call_lead" ON "video_call_sessions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_wallet_cards_user" ON "wallet_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_hook" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_created" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webinar_regs_user" ON "webinar_registrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_webinars_starts" ON "webinars" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "idx_webinars_status" ON "webinars" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wins_feed_created" ON "wins_feed_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wins_feed_agent" ON "wins_feed_posts" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "idx_wishlist_matches_wishlist" ON "wishlist_matches" USING btree ("wishlist_id");--> statement-breakpoint
CREATE INDEX "idx_wishlists_user" ON "wishlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wishlists_active" ON "wishlists" USING btree ("active");