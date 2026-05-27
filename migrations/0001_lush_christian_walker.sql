CREATE TABLE "saved_list_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "saved_list_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"list_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now(),
	CONSTRAINT "uniq_saved_list_lead" UNIQUE("list_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "saved_lists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "saved_lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" varchar,
	"owner_user_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_list_id_saved_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."saved_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lists" ADD CONSTRAINT "saved_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lists" ADD CONSTRAINT "saved_lists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_saved_list_items_list" ON "saved_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "idx_saved_lists_org" ON "saved_lists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_saved_lists_owner" ON "saved_lists" USING btree ("owner_user_id");