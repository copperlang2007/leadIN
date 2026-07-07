ALTER TABLE "leads" ADD COLUMN "original_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "second_look" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "repriced_at" timestamp;