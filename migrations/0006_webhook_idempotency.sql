CREATE TABLE "webhook_idempotency" (
	"source" varchar(64) NOT NULL,
	"key" varchar(256) NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_webhook_idempotency" UNIQUE("source","key")
);
--> statement-breakpoint
CREATE INDEX "idx_webhook_idempotency_seen_at" ON "webhook_idempotency" USING btree ("seen_at");