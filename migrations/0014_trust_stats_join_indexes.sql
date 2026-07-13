CREATE INDEX "idx_disputes_lead" ON "lead_disputes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_leads_vendor" ON "leads" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_orders_lead" ON "orders" USING btree ("lead_id");