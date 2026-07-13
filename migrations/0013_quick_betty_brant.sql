-- Clear the unwired N2 scaffold rows first. The reshape below adds NOT NULL
-- columns (referrer_user_id, code) and does reward_cents SET NOT NULL with no
-- default/backfill; Postgres rejects those on any non-empty table. Production is
-- asserted empty (the scaffold was never wired on main, so nothing ever wrote a
-- row), but a dev/staging DB seeded via db:push, a smoke test, or an old branch
-- could hold rows and block the deploy with SQLSTATE 23502. Deleting them is
-- safe given the no-data-dependency assertion and makes the migration idempotent
-- across every environment.
DELETE FROM "referrals";--> statement-breakpoint
ALTER TABLE "referral_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "referral_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "uniq_referral_per_referee";--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_code_id_referral_codes_id_fk";
--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_referee_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "referrals" ALTER COLUMN "reward_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "referrer_user_id" varchar NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "code" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "referred_user_id" varchar;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "redeemed_at" timestamp;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "rewarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_referrals_code" ON "referrals" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_referrals_referred_user" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
ALTER TABLE "referrals" DROP COLUMN "code_id";--> statement-breakpoint
ALTER TABLE "referrals" DROP COLUMN "referee_user_id";--> statement-breakpoint
ALTER TABLE "referrals" DROP COLUMN "qualified_at";--> statement-breakpoint
ALTER TABLE "referrals" DROP COLUMN "paid_at";--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_unique" UNIQUE("referrer_user_id");