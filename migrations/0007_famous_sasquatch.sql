CREATE TABLE "mediscore_weights" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mediscore_weights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"weights" jsonb NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"base_rate" numeric(6, 5),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_mediscore_weights_created" ON "mediscore_weights" USING btree ("created_at");