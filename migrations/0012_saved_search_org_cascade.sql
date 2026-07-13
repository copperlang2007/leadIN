ALTER TABLE "saved_searches" DROP CONSTRAINT "saved_searches_org_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;