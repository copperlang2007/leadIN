import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  integer,
  decimal,
  boolean,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// ──────────────────────────────────────────────────────
// Multi-tenant organizations (Phase 3)
// ──────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  billingMode: varchar("billing_mode", { length: 20 }).notNull().default("per_lead"), // 'per_lead' | 'subscription'
  subscriptionTier: varchar("subscription_tier", { length: 50 }),
  subscriptionStatus: varchar("subscription_status", { length: 20 }).notNull().default("inactive"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  routingScoreThreshold: integer("routing_score_threshold").notNull().default(70),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_orgs_slug").on(table.slug),
]);

// User storage table (mandatory for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  // Active org context – the org the user is currently working under
  activeOrgId: varchar("active_org_id").references(() => organizations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Members of an org – a user can belong to many orgs with different roles
export const orgMembers = pgTable("org_members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("agent"), // 'owner' | 'admin' | 'agent'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_org_member").on(table.orgId, table.userId),
  index("idx_org_members_user").on(table.userId),
  index("idx_org_members_org").on(table.orgId),
]);

// Per-agent profile: licensing, carrier appointments, territory, license docs
export const agentProfiles = pgTable("agent_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  licensedStates: text("licensed_states").array().notNull().default(sql`ARRAY[]::text[]`),
  appointedCarriers: text("appointed_carriers").array().notNull().default(sql`ARRAY[]::text[]`),
  territoryZips: text("territory_zips").array().notNull().default(sql`ARRAY[]::text[]`),
  territoryCounties: text("territory_counties").array().notNull().default(sql`ARRAY[]::text[]`),
  licenseNumber: varchar("license_number", { length: 100 }),
  licenseDocumentUrl: text("license_document_url"),
  verificationStatus: varchar("verification_status", { length: 20 }).notNull().default("pending"), // 'pending' | 'verified' | 'rejected'
  capacityLimit: integer("capacity_limit").notNull().default(25),
  conversionRate: decimal("conversion_rate", { precision: 5, scale: 4 }).notNull().default("0.0000"),
  acceptingLeads: boolean("accepting_leads").notNull().default(true),
  // Wave 6 (T4): NIPR / DOI auto-verification cache.
  niprVerifiedAt: timestamp("nipr_verified_at"),
  niprLicenseExpiry: timestamp("nipr_license_expiry"),
  niprLastError: text("nipr_last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_agent_profiles_org").on(table.orgId),
]);

export const userProfiles = pgTable("user_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  licensedStates: text("licensed_states").array().notNull().default(sql`ARRAY[]::text[]`),
  preferredTypes: text("preferred_types").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull(),
  rating: decimal("rating", { precision: 2, scale: 1 }).notNull().default("0.0"),
  verified: boolean("verified").notNull().default(false),
  // Wave 6: exclusive vendor partnership program (M5)
  isExclusive: boolean("is_exclusive").notNull().default(false),
  revShareOverride: decimal("rev_share_override", { precision: 4, scale: 3 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Vendor API keys for the vendor ingestion API
export const vendorApiKeys = pgTable("vendor_api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  // Org that ingested leads are routed to. Null = legacy global-pool key.
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  active: boolean("active").notNull().default(true),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_vendor_keys_prefix").on(table.keyPrefix),
]);

export const leads = pgTable("leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  // Org that owns/sees this lead. Null = global pool (legacy / pre-Phase-3 leads).
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  // Agent the lead has been routed to (set by the routing engine when the lead crosses threshold)
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at"),
  type: varchar("type", { length: 100 }).notNull(),
  source: varchar("source", { length: 100 }).notNull(),
  exclusivity: varchar("exclusivity", { length: 50 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  consumerAge: integer("consumer_age").notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  zipCode: varchar("zip_code", { length: 10 }).notNull(),
  verified: boolean("verified").notNull().default(false),
  compatibilityScore: integer("compatibility_score").notNull().default(0),

  // PII fields (hidden until purchase)
  consumerName: varchar("consumer_name", { length: 255 }),
  consumerPhone: varchar("consumer_phone", { length: 20 }),
  consumerEmail: varchar("consumer_email", { length: 255 }),
  consumerAddress: varchar("consumer_address", { length: 500 }),

  // Consumer attributes
  income: varchar("income", { length: 50 }),
  hasCondition: boolean("has_condition"),
  homeowner: boolean("homeowner"),
  gender: varchar("gender", { length: 1 }),
  smoker: boolean("smoker"),

  // Provenance data
  provenance: jsonb("provenance").notNull(),

  // ──── Phase 4: signal enrichment ────
  // DNC compliance: result of the DNC registry check on ingest
  dncFlagged: boolean("dnc_flagged").notNull().default(false),
  dncCheckedAt: timestamp("dnc_checked_at"),
  // TrustedForm/Jornaya server-side verification (Wave 0)
  tcpaVerifiedAt: timestamp("tcpa_verified_at"),
  tcpaCertId: varchar("tcpa_cert_id", { length: 200 }),
  tcpaVerifiedSource: varchar("tcpa_verified_source", { length: 50 }),
  // MediScore = aggregated signal score (0-100), recomputed when signals change
  mediscore: integer("mediscore").notNull().default(0),
  mediscoreSignals: jsonb("mediscore_signals"),
  // Server-assigned session id when the source form fired (links behavioral events)
  sessionId: varchar("session_id", { length: 64 }),

  // ──── Wave 6: killer-feature caches (AI enrichment + NL explainers) ────
  enrichmentJson: jsonb("enrichment_json"),
  mediscoreExplanation: text("mediscore_explanation"),
  bestCallWindowsJson: jsonb("best_call_windows_json"),

  // Status
  sold: boolean("sold").notNull().default(false),
  flagged: boolean("flagged").notNull().default(false),
  removed: boolean("removed").notNull().default(false),
  soldAt: timestamp("sold_at"),
  purchasedBy: varchar("purchased_by").references(() => users.id),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_leads_state").on(table.state),
  index("idx_leads_type").on(table.type),
  index("idx_leads_sold").on(table.sold),
  index("idx_leads_org").on(table.orgId),
  index("idx_leads_assigned").on(table.assignedToUserId),
]);

export const orders = pgTable("orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_orders_user").on(table.userId),
  index("idx_orders_org").on(table.orgId),
  index("idx_orders_created").on(table.createdAt),
]);

// Routing audit log: every assignment decision, including reasons + score
export const leadAssignments = pgTable("lead_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  matchScore: integer("match_score").notNull(),
  reason: text("reason"),
  status: varchar("status", { length: 20 }).notNull().default("assigned"), // 'assigned' | 'accepted' | 'declined' | 'expired'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_assignments_lead").on(table.leadId),
  index("idx_assignments_agent").on(table.agentUserId),
  index("idx_assignments_org").on(table.orgId),
]);

// Stripe checkout sessions for wallet funding
export const stripeCheckoutSessions = pgTable("stripe_checkout_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }).notNull().unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Notifications log to prevent duplicates
export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  type: varchar("type", { length: 50 }).notNull().default("new_lead"),
  sentAt: timestamp("sent_at").defaultNow(),
}, (table) => [
  unique("uniq_notification_user_lead").on(table.userId, table.leadId, table.type),
]);

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  agentProfiles: many(agentProfiles),
  leads: many(leads),
  orders: many(orders),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(organizations, { fields: [orgMembers.orgId], references: [organizations.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));

export const agentProfilesRelations = relations(agentProfiles, ({ one }) => ({
  user: one(users, { fields: [agentProfiles.userId], references: [users.id] }),
  org: one(organizations, { fields: [agentProfiles.orgId], references: [organizations.id] }),
}));

export const leadAssignmentsRelations = relations(leadAssignments, ({ one }) => ({
  lead: one(leads, { fields: [leadAssignments.leadId], references: [leads.id] }),
  agent: one(users, { fields: [leadAssignments.agentUserId], references: [users.id] }),
  org: one(organizations, { fields: [leadAssignments.orgId], references: [organizations.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  agentProfile: one(agentProfiles, {
    fields: [users.id],
    references: [agentProfiles.userId],
  }),
  activeOrg: one(organizations, {
    fields: [users.activeOrgId],
    references: [organizations.id],
  }),
  orgMemberships: many(orgMembers),
  orders: many(orders),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  leads: many(leads),
  apiKeys: many(vendorApiKeys),
}));

export const vendorApiKeysRelations = relations(vendorApiKeys, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorApiKeys.vendorId],
    references: [vendors.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  vendor: one(vendors, {
    fields: [leads.vendorId],
    references: [vendors.id],
  }),
  purchaser: one(users, {
    fields: [leads.purchasedBy],
    references: [users.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  lead: one(leads, {
    fields: [orders.leadId],
    references: [leads.id],
  }),
}));

// ──────────────────────────────────────────────────────
// Saved lists — agents bookmark leads to revisit / share with a teammate.
// Org-scoped: a list belongs to an org so members of that org can see it.
// ──────────────────────────────────────────────────────
export const savedLists = pgTable("saved_lists", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_saved_lists_org").on(table.orgId),
  index("idx_saved_lists_owner").on(table.ownerUserId),
]);

export const savedListItems = pgTable("saved_list_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  listId: integer("list_id").notNull().references(() => savedLists.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at").defaultNow(),
}, (table) => [
  unique("uniq_saved_list_lead").on(table.listId, table.leadId),
  index("idx_saved_list_items_list").on(table.listId),
]);

export type InsertSavedList = typeof savedLists.$inferInsert;
export type SavedList = typeof savedLists.$inferSelect;
export type SavedListItem = typeof savedListItems.$inferSelect;

// ──────────────────────────────────────────────────────
// Phase 4 – Signal enrichment
// ──────────────────────────────────────────────────────

// Live SEO keyword signals (Google Search Console / DataForSEO)
export const keywordSignals = pgTable("keyword_signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  keyword: varchar("keyword", { length: 300 }).notNull(),
  source: varchar("source", { length: 50 }).notNull(), // 'gsc' | 'dataforseo' | 'seed'
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  position: decimal("position", { precision: 6, scale: 2 }).notNull().default("0"),
  opportunityScore: integer("opportunity_score").notNull().default(0),
  category: varchar("category", { length: 100 }),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => [
  unique("uniq_kw_source").on(table.keyword, table.source),
  index("idx_kw_opportunity").on(table.opportunityScore),
]);

// CMS Plan Finder public data: plan terminations, benefit changes, star ratings
export const cmsPlanSignals = pgTable("cms_plan_signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  planId: varchar("plan_id", { length: 100 }).notNull(),
  carrier: varchar("carrier", { length: 255 }),
  state: varchar("state", { length: 2 }).notNull(),
  county: varchar("county", { length: 100 }),
  signalType: varchar("signal_type", { length: 50 }).notNull(), // 'termination' | 'benefit_change' | 'star_rating'
  starRating: decimal("star_rating", { precision: 2, scale: 1 }),
  effectiveDate: timestamp("effective_date"),
  details: jsonb("details"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => [
  index("idx_cms_state").on(table.state),
  index("idx_cms_county").on(table.county),
  unique("uniq_cms_plan_signal").on(table.planId, table.signalType, table.effectiveDate),
]);

// Behavioral events from the client-side tracker SDK
export const behavioralEvents = pgTable("behavioral_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 50 }).notNull(), // 'page_view' | 'scroll_depth' | 'time_on_page' | 'tool_interaction' | 'cta_click'
  path: varchar("path", { length: 500 }),
  value: integer("value"), // numeric payload (e.g., scroll percent, seconds, count)
  metadata: jsonb("metadata"),
  userAgent: varchar("user_agent", { length: 500 }),
  ip: varchar("ip", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_events_session").on(table.sessionId),
  index("idx_events_lead").on(table.leadId),
  index("idx_events_type").on(table.eventType),
  index("idx_events_created").on(table.createdAt),
]);

// Content articles for the autonomous content engine
export const contentArticles = pgTable("content_articles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  excerpt: text("excerpt").notNull(),
  body: text("body").notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  seoTitle: varchar("seo_title", { length: 500 }),
  seoDescription: text("seo_description"),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_articles_slug").on(table.slug),
  index("idx_articles_published").on(table.published),
  index("idx_articles_category").on(table.category),
]);

export type InsertContentArticle = typeof contentArticles.$inferInsert;
export type ContentArticle = typeof contentArticles.$inferSelect;

export const insertContentArticleSchema = createInsertSchema(contentArticles);

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export type InsertUserProfile = typeof userProfiles.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;

export type InsertVendor = typeof vendors.$inferInsert;
export type Vendor = typeof vendors.$inferSelect;

export type InsertVendorApiKey = typeof vendorApiKeys.$inferInsert;
export type VendorApiKey = typeof vendorApiKeys.$inferSelect;

export type InsertLead = typeof leads.$inferInsert;
export type Lead = typeof leads.$inferSelect;

export type InsertOrder = typeof orders.$inferInsert;
export type Order = typeof orders.$inferSelect;

export type InsertStripeCheckoutSession = typeof stripeCheckoutSessions.$inferInsert;
export type StripeCheckoutSession = typeof stripeCheckoutSessions.$inferSelect;

export type InsertNotification = typeof notifications.$inferInsert;
export type Notification = typeof notifications.$inferSelect;

// Zod Schemas for validation
export const insertUserProfileSchema = createInsertSchema(userProfiles);
export const insertLeadSchema = createInsertSchema(leads);
export const insertOrderSchema = createInsertSchema(orders);

// ──────────────────────────────────────────────────────
// Phase 3 types & validation schemas
// ──────────────────────────────────────────────────────
export type InsertOrganization = typeof organizations.$inferInsert;
export type Organization = typeof organizations.$inferSelect;

export type InsertOrgMember = typeof orgMembers.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;

export type InsertAgentProfile = typeof agentProfiles.$inferInsert;
export type AgentProfile = typeof agentProfiles.$inferSelect;

export type InsertLeadAssignment = typeof leadAssignments.$inferInsert;
export type LeadAssignment = typeof leadAssignments.$inferSelect;

export const createOrgSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
});

export const agentOnboardingSchema = z.object({
  licensedStates: z.array(z.string().length(2)).min(1, "At least one licensed state required"),
  appointedCarriers: z.array(z.string().min(1)).default([]),
  territoryZips: z.array(z.string().min(3).max(10)).default([]),
  territoryCounties: z.array(z.string().min(1)).default([]),
  licenseNumber: z.string().min(1).max(100).optional(),
  licenseDocumentUrl: z.string().url().refine(
    u => u.startsWith("http://") || u.startsWith("https://"),
    "Must be an http(s) URL",
  ).optional().or(z.literal("")),
  capacityLimit: z.number().int().min(1).max(500).default(25),
  acceptingLeads: z.boolean().default(true),
});

export const subscriptionCheckoutSchema = z.object({
  tier: z.enum(["starter", "growth", "scale"]),
});

export type AgentOnboardingInput = z.infer<typeof agentOnboardingSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

// ──────────────────────────────────────────────────────
// Phase 4 types + validation
// ──────────────────────────────────────────────────────
export type InsertKeywordSignal = typeof keywordSignals.$inferInsert;
export type KeywordSignal = typeof keywordSignals.$inferSelect;

export type InsertCmsPlanSignal = typeof cmsPlanSignals.$inferInsert;
export type CmsPlanSignal = typeof cmsPlanSignals.$inferSelect;

export type InsertBehavioralEvent = typeof behavioralEvents.$inferInsert;
export type BehavioralEvent = typeof behavioralEvents.$inferSelect;

export const trackEventSchema = z.object({
  sessionId: z.string().min(8).max(64),
  leadId: z.number().int().optional(),
  eventType: z.enum(["page_view", "scroll_depth", "time_on_page", "tool_interaction", "cta_click"]),
  path: z.string().max(500).optional(),
  value: z.number().int().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;

// ──────────────────────────────────────────────────────
// Wave 0: marketplace economics + audit + disputes
// ──────────────────────────────────────────────────────

// Running balance per vendor in pending and paid states.
export const vendorBalances = pgTable("vendor_balances", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().unique().references(() => vendors.id, { onDelete: "cascade" }),
  pendingCents: integer("pending_cents").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// One row per credit (lead sale) or debit (refund / payout). Append-only ledger.
export const vendorPayouts = pgTable("vendor_payouts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  // Positive = credit (a sale earned this vendor money). Negative = debit (refund, payout, adjustment).
  amountCents: integer("amount_cents").notNull(),
  kind: varchar("kind", { length: 30 }).notNull(), // 'sale' | 'refund' | 'payout' | 'adjustment'
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  stripeTransferId: varchar("stripe_transfer_id", { length: 200 }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_vendor_payouts_vendor").on(table.vendorId),
  index("idx_vendor_payouts_kind").on(table.kind),
  index("idx_vendor_payouts_created").on(table.createdAt),
]);

// Append-only log of privileged admin actions (verify agent, mint key, flag lead, etc.)
export const adminAuditLog = pgTable("admin_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  targetKind: varchar("target_kind", { length: 40 }),
  targetId: varchar("target_id", { length: 100 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_audit_actor").on(table.actorUserId),
  index("idx_audit_action").on(table.action),
  index("idx_audit_created").on(table.createdAt),
]);

// Buyer-filed dispute on a purchased lead.
export const leadDisputes = pgTable("lead_disputes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  buyerUserId: varchar("buyer_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: varchar("reason", { length: 80 }).notNull(), // 'bad_contact' | 'duplicate' | 'fraud' | 'not_as_described' | 'other'
  notes: text("notes"),
  status: varchar("status", { length: 20 }).notNull().default("open"), // 'open' | 'approved' | 'denied'
  resolverUserId: varchar("resolver_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  refundCents: integer("refund_cents"),
  // Wave 6 (T2): AI dispute pre-classification cache.
  aiClassification: varchar("ai_classification", { length: 40 }), // 'likely_valid' | 'likely_invalid' | 'needs_review'
  aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
  autoReplacementOrderId: integer("auto_replacement_order_id").references(() => orders.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_disputes_status").on(table.status),
  index("idx_disputes_order").on(table.orderId),
  unique("uniq_dispute_per_order").on(table.orderId),
]);

export type VendorBalance = typeof vendorBalances.$inferSelect;
export type VendorPayout = typeof vendorPayouts.$inferSelect;
export type InsertVendorPayout = typeof vendorPayouts.$inferInsert;
export type AdminAuditEntry = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditEntry = typeof adminAuditLog.$inferInsert;
export type LeadDispute = typeof leadDisputes.$inferSelect;
export type InsertLeadDispute = typeof leadDisputes.$inferInsert;

export const disputeReasonSchema = z.enum(["bad_contact", "duplicate", "fraud", "not_as_described", "other"]);
export const createDisputeSchema = z.object({
  orderId: z.number().int().positive(),
  reason: disputeReasonSchema,
  notes: z.string().max(2000).optional(),
});

// Vendor ingestion payload schema
export const vendorLeadIngestSchema = z.object({
  type: z.enum(["Medicare Advantage", "Medicare Supplement", "Final Expense"]),
  source: z.string().min(1).max(100),
  exclusivity: z.enum(["Exclusive", "Shared (2)", "Shared (4)", "Aged"]),
  price: z.number().positive(),
  consumerAge: z.number().int().min(18).max(120),
  state: z.string().length(2).toUpperCase(),
  zipCode: z.string().min(5).max(10),
  consumerName: z.string().optional(),
  consumerPhone: z.string().optional(),
  consumerEmail: z.string().email().optional(),
  consumerAddress: z.string().optional(),
  income: z.string().optional(),
  hasCondition: z.boolean().optional(),
  homeowner: z.boolean().optional(),
  gender: z.enum(["M", "F"]).optional(),
  smoker: z.boolean().optional(),
  verified: z.boolean().optional(),
  trustedFormCertUrl: z.string().url().optional(),
});

export type VendorLeadIngest = z.infer<typeof vendorLeadIngestSchema>;

// ──────────────────────────────────────────────────────
// Wave 6 — Killer features (one big migration: 0004_killer_features.sql)
// All new tables for K1-K5, T1-T8, M1-M5, A1-A6, D1-D6, N1-N3 live here.
// ──────────────────────────────────────────────────────

// K1 — Speed-to-lead live auction. One row per claim attempt; resolved row wins.
export const leadClaims = pgTable("lead_claims", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  // The auction is opened at `auctionStartedAt`, closes after `windowMs`.
  // Multiple claim rows may be created during the window; only the resolver
  // picks one winner and writes resolvedAt + status='won'/'lost'.
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | won | lost | expired
  bidAmountCents: integer("bid_amount_cents"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_claims_lead").on(table.leadId),
  index("idx_claims_agent").on(table.agentUserId),
  index("idx_claims_status").on(table.status),
]);

// M1 — Surge pricing snapshot.
export const leadPriceHistory = pgTable("lead_price_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  priceCents: integer("price_cents").notNull(),
  reason: varchar("reason", { length: 50 }).notNull(), // 'initial' | 'surge' | 'cooldown' | 'manual'
  surgeMultiplier: decimal("surge_multiplier", { precision: 4, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_price_history_lead").on(table.leadId),
  index("idx_price_history_created").on(table.createdAt),
]);

// M2 — Lead bundles offered by vendor.
export const leadBundles = pgTable("lead_bundles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  priceCentsPerLead: integer("price_cents_per_lead").notNull(),
  totalLeadCount: integer("total_lead_count").notNull(),
  expiresAt: timestamp("expires_at"),
  status: varchar("status", { length: 20 }).notNull().default("open"), // open | sold | expired
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_bundles_vendor").on(table.vendorId),
  index("idx_bundles_status").on(table.status),
]);

export const leadBundleItems = pgTable("lead_bundle_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  bundleId: integer("bundle_id").notNull().references(() => leadBundles.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
}, (table) => [
  unique("uniq_bundle_lead").on(table.bundleId, table.leadId),
]);

// K2 — TCPA insurance: per-org policy + per-claim eligibility.
export const tcpaPolicies = pgTable("tcpa_policies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  carrierName: varchar("carrier_name", { length: 255 }),
  perClaimLimitCents: integer("per_claim_limit_cents").notNull().default(2500000), // $25,000 default
  aggregateLimitCents: integer("aggregate_limit_cents").notNull().default(10000000), // $100,000 default
  startedAt: timestamp("started_at").defaultNow(),
  endsAt: timestamp("ends_at"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | expired | cancelled
});

export const tcpaClaims = pgTable("tcpa_claims", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  policyId: integer("policy_id").notNull().references(() => tcpaPolicies.id),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  claimReason: text("claim_reason"),
  amountClaimedCents: integer("amount_claimed_cents").notNull(),
  amountPaidCents: integer("amount_paid_cents"),
  status: varchar("status", { length: 20 }).notNull().default("open"), // open | approved | denied | paid
  filedAt: timestamp("filed_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_tcpa_claims_status").on(table.status),
]);

// K3 — Twilio call + sms logs.
export const callLogs = pgTable("call_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  twilioSid: varchar("twilio_sid", { length: 100 }),
  status: varchar("status", { length: 30 }).notNull(), // queued|ringing|in-progress|completed|busy|no-answer|failed
  durationSec: integer("duration_sec"),
  recordingUrl: text("recording_url"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => [
  index("idx_calls_agent").on(table.agentUserId),
  index("idx_calls_lead").on(table.leadId),
]);

export const smsLogs = pgTable("sms_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  twilioSid: varchar("twilio_sid", { length: 100 }),
  direction: varchar("direction", { length: 10 }).notNull(), // 'out' | 'in'
  body: text("body").notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_sms_lead").on(table.leadId),
]);

// K3 — AI conversation assist: one row per assistant suggestion during a call.
export const conversationAssists = pgTable("conversation_assists", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  callLogId: integer("call_log_id").notNull().references(() => callLogs.id, { onDelete: "cascade" }),
  triggerPhrase: text("trigger_phrase"),
  suggestion: text("suggestion").notNull(),
  emittedAt: timestamp("emitted_at").defaultNow(),
});

// K3 — Stored call transcripts (also feeds training data).
export const transcripts = pgTable("transcripts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  callLogId: integer("call_log_id").notNull().unique().references(() => callLogs.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  createdAt: timestamp("created_at").defaultNow(),
});

// K4 — CRM connection + per-event sync log.
export const crmConnections = pgTable("crm_connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 30 }).notNull(), // 'hubspot'|'salesforce'|'ghl'|'pipedrive'
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes"),
  externalAccountId: varchar("external_account_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_crm_org_provider").on(table.orgId, table.provider),
]);

export const crmSyncEvents = pgTable("crm_sync_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  connectionId: integer("connection_id").notNull().references(() => crmConnections.id, { onDelete: "cascade" }),
  direction: varchar("direction", { length: 10 }).notNull(), // 'out' (lead→crm) | 'in' (disposition→here)
  resourceType: varchar("resource_type", { length: 40 }).notNull(), // 'contact'|'deal'|'note'|'task'
  resourceId: varchar("resource_id", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_crm_events_conn").on(table.connectionId),
]);

// K5 — Agent reputation events (raw stream) — score is computed via SQL.
export const agentReputationEvents = pgTable("agent_reputation_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  // accepted_assignment | declined_assignment | purchase | sale_closed | dispute_filed_against | dispute_approved | response_time_under_5m
  weight: integer("weight").notNull(), // +/- points
  relatedLeadId: integer("related_lead_id").references(() => leads.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_repu_agent").on(table.agentUserId),
  index("idx_repu_created").on(table.createdAt),
]);

// T3 — Flat-rate smart-match subscription.
export const smartMatchSubscriptions = pgTable("smart_match_subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  monthlyLeadQuota: integer("monthly_lead_quota").notNull(),
  monthlyPriceCents: integer("monthly_price_cents").notNull(),
  filterCriteria: jsonb("filter_criteria").notNull(), // { types, states, minMediscore, maxPriceCents, ... }
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  cyclesDelivered: integer("cycles_delivered").notNull().default(0),
  leadsDeliveredThisCycle: integer("leads_delivered_this_cycle").notNull().default(0),
  cycleStartedAt: timestamp("cycle_started_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_smartmatch_agent").on(table.agentUserId),
]);

// A2 — Per-agent spend cap (agency tier).
export const agentSpendCaps = pgTable("agent_spend_caps", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  monthlyLimitCents: integer("monthly_limit_cents").notNull(),
  currentSpendCents: integer("current_spend_cents").notNull().default(0),
  periodStartedAt: timestamp("period_started_at").defaultNow(),
});

// A3 — Bulk buy + smart fanout
export const bulkOrders = pgTable("bulk_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  buyerUserId: varchar("buyer_user_id").notNull().references(() => users.id),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  requestedCount: integer("requested_count").notNull(),
  filterCriteria: jsonb("filter_criteria").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("processing"),
  fanoutCompletedAt: timestamp("fanout_completed_at"),
  totalPriceCents: integer("total_price_cents"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_bulk_buyer").on(table.buyerUserId),
]);

export const bulkOrderItems = pgTable("bulk_order_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  bulkOrderId: integer("bulk_order_id").notNull().references(() => bulkOrders.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  assignedAgentUserId: varchar("assigned_agent_user_id").references(() => users.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
});

// A4 — Custom routing rules DSL.
export const routingRules = pgTable("routing_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  priority: integer("priority").notNull().default(100),
  conditions: jsonb("conditions").notNull(), // { allOf: [{ field, op, value }, ...] }
  action: jsonb("action").notNull(), // { assignTo: userId } | { boostScore: int } | { reject: true }
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_rules_org").on(table.orgId),
]);

// A5 — White-label agency branding.
export const orgBranding = pgTable("org_branding", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  customDomain: varchar("custom_domain", { length: 255 }),
  logoUrl: text("logo_url"),
  primaryColorHex: varchar("primary_color_hex", { length: 7 }),
  productName: varchar("product_name", { length: 100 }),
  supportEmail: varchar("support_email", { length: 255 }),
  enabled: boolean("enabled").notNull().default(false),
});

// D6 / T6 — Lead persona cache
export const leadPersonas = pgTable("lead_personas", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  persona: text("persona").notNull(),
  predictedObjections: jsonb("predicted_objections"),
  bestApproach: text("best_approach"),
  generatedAt: timestamp("generated_at").defaultNow(),
  modelUsed: varchar("model_used", { length: 100 }),
});

// D5 — AI-drafted outreach (email/SMS) cache
export const outreachDrafts = pgTable("outreach_drafts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 10 }).notNull(), // 'email' | 'sms'
  subject: text("subject"),
  body: text("body").notNull(),
  generatedAt: timestamp("generated_at").defaultNow(),
}, (table) => [
  index("idx_outreach_lead").on(table.leadId),
]);

// D3 — News-aware re-engagement events
export const newsEvents = pgTable("news_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  category: varchar("category", { length: 50 }).notNull(), // 'cms_announcement'|'plan_change'|'state_regulation'
  state: varchar("state", { length: 2 }),
  county: varchar("county", { length: 100 }),
  headline: text("headline").notNull(),
  summary: text("summary"),
  effectiveDate: timestamp("effective_date"),
  source: varchar("source", { length: 200 }),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => [
  index("idx_news_state").on(table.state),
  index("idx_news_category").on(table.category),
]);

// N1 — Public agency directory profile.
export const agencyProfiles = pgTable("agency_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  bio: text("bio"),
  specialties: text("specialties").array().notNull().default(sql`ARRAY[]::text[]`),
  carriers: text("carriers").array().notNull().default(sql`ARRAY[]::text[]`),
  publicEmail: varchar("public_email", { length: 255 }),
  publicPhone: varchar("public_phone", { length: 20 }),
  websiteUrl: text("website_url"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// N2 — Agent & vendor referral codes.
export const referralCodes = pgTable("referral_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ownerKind: varchar("owner_kind", { length: 10 }).notNull(), // 'agent' | 'vendor'
  rewardPct: decimal("reward_pct", { precision: 4, scale: 3 }).notNull(), // e.g., 0.100
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const referrals = pgTable("referrals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  codeId: integer("code_id").notNull().references(() => referralCodes.id),
  refereeUserId: varchar("referee_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending|qualified|paid
  qualifiedAt: timestamp("qualified_at"),
  rewardCents: integer("reward_cents"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_referral_per_referee").on(table.refereeUserId),
]);

// N3 — Marketplace integrations directory.
export const marketplaceIntegrations = pgTable("marketplace_integrations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  developer: varchar("developer", { length: 255 }),
  category: varchar("category", { length: 40 }).notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  installCount: integer("install_count").notNull().default(0),
  approved: boolean("approved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketplaceIntegrationInstalls = pgTable("marketplace_integration_installs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  integrationId: integer("integration_id").notNull().references(() => marketplaceIntegrations.id),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  config: jsonb("config"),
  installedAt: timestamp("installed_at").defaultNow(),
}, (table) => [
  unique("uniq_install").on(table.integrationId, table.orgId),
]);

// ──────────────────────────────────────────────────────
// Wave 6 — Relations
// ──────────────────────────────────────────────────────
export const leadClaimsRelations = relations(leadClaims, ({ one }) => ({
  lead: one(leads, { fields: [leadClaims.leadId], references: [leads.id] }),
  agent: one(users, { fields: [leadClaims.agentUserId], references: [users.id] }),
  org: one(organizations, { fields: [leadClaims.orgId], references: [organizations.id] }),
}));

export const leadPriceHistoryRelations = relations(leadPriceHistory, ({ one }) => ({
  lead: one(leads, { fields: [leadPriceHistory.leadId], references: [leads.id] }),
}));

export const leadBundlesRelations = relations(leadBundles, ({ one, many }) => ({
  vendor: one(vendors, { fields: [leadBundles.vendorId], references: [vendors.id] }),
  items: many(leadBundleItems),
}));

export const leadBundleItemsRelations = relations(leadBundleItems, ({ one }) => ({
  bundle: one(leadBundles, { fields: [leadBundleItems.bundleId], references: [leadBundles.id] }),
  lead: one(leads, { fields: [leadBundleItems.leadId], references: [leads.id] }),
}));

export const tcpaPoliciesRelations = relations(tcpaPolicies, ({ one, many }) => ({
  org: one(organizations, { fields: [tcpaPolicies.orgId], references: [organizations.id] }),
  claims: many(tcpaClaims),
}));

export const tcpaClaimsRelations = relations(tcpaClaims, ({ one }) => ({
  policy: one(tcpaPolicies, { fields: [tcpaClaims.policyId], references: [tcpaPolicies.id] }),
  order: one(orders, { fields: [tcpaClaims.orderId], references: [orders.id] }),
  agent: one(users, { fields: [tcpaClaims.agentUserId], references: [users.id] }),
}));

export const callLogsRelations = relations(callLogs, ({ one, many }) => ({
  agent: one(users, { fields: [callLogs.agentUserId], references: [users.id] }),
  lead: one(leads, { fields: [callLogs.leadId], references: [leads.id] }),
  transcript: one(transcripts, { fields: [callLogs.id], references: [transcripts.callLogId] }),
  assists: many(conversationAssists),
}));

export const smsLogsRelations = relations(smsLogs, ({ one }) => ({
  agent: one(users, { fields: [smsLogs.agentUserId], references: [users.id] }),
  lead: one(leads, { fields: [smsLogs.leadId], references: [leads.id] }),
}));

export const conversationAssistsRelations = relations(conversationAssists, ({ one }) => ({
  call: one(callLogs, { fields: [conversationAssists.callLogId], references: [callLogs.id] }),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  call: one(callLogs, { fields: [transcripts.callLogId], references: [callLogs.id] }),
}));

export const crmConnectionsRelations = relations(crmConnections, ({ one, many }) => ({
  org: one(organizations, { fields: [crmConnections.orgId], references: [organizations.id] }),
  events: many(crmSyncEvents),
}));

export const crmSyncEventsRelations = relations(crmSyncEvents, ({ one }) => ({
  connection: one(crmConnections, { fields: [crmSyncEvents.connectionId], references: [crmConnections.id] }),
}));

export const agentReputationEventsRelations = relations(agentReputationEvents, ({ one }) => ({
  agent: one(users, { fields: [agentReputationEvents.agentUserId], references: [users.id] }),
  lead: one(leads, { fields: [agentReputationEvents.relatedLeadId], references: [leads.id] }),
}));

export const smartMatchSubscriptionsRelations = relations(smartMatchSubscriptions, ({ one }) => ({
  agent: one(users, { fields: [smartMatchSubscriptions.agentUserId], references: [users.id] }),
  org: one(organizations, { fields: [smartMatchSubscriptions.orgId], references: [organizations.id] }),
}));

export const agentSpendCapsRelations = relations(agentSpendCaps, ({ one }) => ({
  agent: one(users, { fields: [agentSpendCaps.agentUserId], references: [users.id] }),
  org: one(organizations, { fields: [agentSpendCaps.orgId], references: [organizations.id] }),
}));

export const bulkOrdersRelations = relations(bulkOrders, ({ one, many }) => ({
  buyer: one(users, { fields: [bulkOrders.buyerUserId], references: [users.id] }),
  org: one(organizations, { fields: [bulkOrders.orgId], references: [organizations.id] }),
  items: many(bulkOrderItems),
}));

export const bulkOrderItemsRelations = relations(bulkOrderItems, ({ one }) => ({
  bulkOrder: one(bulkOrders, { fields: [bulkOrderItems.bulkOrderId], references: [bulkOrders.id] }),
  lead: one(leads, { fields: [bulkOrderItems.leadId], references: [leads.id] }),
  assignedAgent: one(users, { fields: [bulkOrderItems.assignedAgentUserId], references: [users.id] }),
  order: one(orders, { fields: [bulkOrderItems.orderId], references: [orders.id] }),
}));

export const routingRulesRelations = relations(routingRules, ({ one }) => ({
  org: one(organizations, { fields: [routingRules.orgId], references: [organizations.id] }),
}));

export const orgBrandingRelations = relations(orgBranding, ({ one }) => ({
  org: one(organizations, { fields: [orgBranding.orgId], references: [organizations.id] }),
}));

export const leadPersonasRelations = relations(leadPersonas, ({ one }) => ({
  lead: one(leads, { fields: [leadPersonas.leadId], references: [leads.id] }),
}));

export const outreachDraftsRelations = relations(outreachDrafts, ({ one }) => ({
  lead: one(leads, { fields: [outreachDrafts.leadId], references: [leads.id] }),
}));

export const agencyProfilesRelations = relations(agencyProfiles, ({ one }) => ({
  org: one(organizations, { fields: [agencyProfiles.orgId], references: [organizations.id] }),
}));

export const referralCodesRelations = relations(referralCodes, ({ one, many }) => ({
  owner: one(users, { fields: [referralCodes.ownerUserId], references: [users.id] }),
  referrals: many(referrals),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  code: one(referralCodes, { fields: [referrals.codeId], references: [referralCodes.id] }),
  referee: one(users, { fields: [referrals.refereeUserId], references: [users.id] }),
}));

export const marketplaceIntegrationsRelations = relations(marketplaceIntegrations, ({ many }) => ({
  installs: many(marketplaceIntegrationInstalls),
}));

export const marketplaceIntegrationInstallsRelations = relations(marketplaceIntegrationInstalls, ({ one }) => ({
  integration: one(marketplaceIntegrations, {
    fields: [marketplaceIntegrationInstalls.integrationId],
    references: [marketplaceIntegrations.id],
  }),
  org: one(organizations, { fields: [marketplaceIntegrationInstalls.orgId], references: [organizations.id] }),
}));

// ──────────────────────────────────────────────────────
// Wave 6 — Type exports + insert schemas
// ──────────────────────────────────────────────────────
export type InsertLeadClaim = typeof leadClaims.$inferInsert;
export type LeadClaim = typeof leadClaims.$inferSelect;
export type InsertLeadPriceHistory = typeof leadPriceHistory.$inferInsert;
export type LeadPriceHistory = typeof leadPriceHistory.$inferSelect;
export type InsertLeadBundle = typeof leadBundles.$inferInsert;
export type LeadBundle = typeof leadBundles.$inferSelect;
export type InsertLeadBundleItem = typeof leadBundleItems.$inferInsert;
export type LeadBundleItem = typeof leadBundleItems.$inferSelect;
export type InsertTcpaPolicy = typeof tcpaPolicies.$inferInsert;
export type TcpaPolicy = typeof tcpaPolicies.$inferSelect;
export type InsertTcpaClaim = typeof tcpaClaims.$inferInsert;
export type TcpaClaim = typeof tcpaClaims.$inferSelect;
export type InsertCallLog = typeof callLogs.$inferInsert;
export type CallLog = typeof callLogs.$inferSelect;
export type InsertSmsLog = typeof smsLogs.$inferInsert;
export type SmsLog = typeof smsLogs.$inferSelect;
export type InsertConversationAssist = typeof conversationAssists.$inferInsert;
export type ConversationAssist = typeof conversationAssists.$inferSelect;
export type InsertTranscript = typeof transcripts.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type InsertCrmConnection = typeof crmConnections.$inferInsert;
export type CrmConnection = typeof crmConnections.$inferSelect;
export type InsertCrmSyncEvent = typeof crmSyncEvents.$inferInsert;
export type CrmSyncEvent = typeof crmSyncEvents.$inferSelect;
export type InsertAgentReputationEvent = typeof agentReputationEvents.$inferInsert;
export type AgentReputationEvent = typeof agentReputationEvents.$inferSelect;
export type InsertSmartMatchSubscription = typeof smartMatchSubscriptions.$inferInsert;
export type SmartMatchSubscription = typeof smartMatchSubscriptions.$inferSelect;
export type InsertAgentSpendCap = typeof agentSpendCaps.$inferInsert;
export type AgentSpendCap = typeof agentSpendCaps.$inferSelect;
export type InsertBulkOrder = typeof bulkOrders.$inferInsert;
export type BulkOrder = typeof bulkOrders.$inferSelect;
export type InsertBulkOrderItem = typeof bulkOrderItems.$inferInsert;
export type BulkOrderItem = typeof bulkOrderItems.$inferSelect;
export type InsertRoutingRule = typeof routingRules.$inferInsert;
export type RoutingRule = typeof routingRules.$inferSelect;
export type InsertOrgBranding = typeof orgBranding.$inferInsert;
export type OrgBranding = typeof orgBranding.$inferSelect;
export type InsertLeadPersona = typeof leadPersonas.$inferInsert;
export type LeadPersona = typeof leadPersonas.$inferSelect;
export type InsertOutreachDraft = typeof outreachDrafts.$inferInsert;
export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type InsertNewsEvent = typeof newsEvents.$inferInsert;
export type NewsEvent = typeof newsEvents.$inferSelect;
export type InsertAgencyProfile = typeof agencyProfiles.$inferInsert;
export type AgencyProfile = typeof agencyProfiles.$inferSelect;
export type InsertReferralCode = typeof referralCodes.$inferInsert;
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;
export type Referral = typeof referrals.$inferSelect;
export type InsertMarketplaceIntegration = typeof marketplaceIntegrations.$inferInsert;
export type MarketplaceIntegration = typeof marketplaceIntegrations.$inferSelect;
export type InsertMarketplaceIntegrationInstall = typeof marketplaceIntegrationInstalls.$inferInsert;
export type MarketplaceIntegrationInstall = typeof marketplaceIntegrationInstalls.$inferSelect;

export const insertLeadClaimSchema = createInsertSchema(leadClaims);
export const insertLeadPriceHistorySchema = createInsertSchema(leadPriceHistory);
export const insertLeadBundleSchema = createInsertSchema(leadBundles);
export const insertLeadBundleItemSchema = createInsertSchema(leadBundleItems);
export const insertTcpaPolicySchema = createInsertSchema(tcpaPolicies);
export const insertTcpaClaimSchema = createInsertSchema(tcpaClaims);
export const insertCallLogSchema = createInsertSchema(callLogs);
export const insertSmsLogSchema = createInsertSchema(smsLogs);
export const insertConversationAssistSchema = createInsertSchema(conversationAssists);
export const insertTranscriptSchema = createInsertSchema(transcripts);
export const insertCrmConnectionSchema = createInsertSchema(crmConnections);
export const insertCrmSyncEventSchema = createInsertSchema(crmSyncEvents);
export const insertAgentReputationEventSchema = createInsertSchema(agentReputationEvents);
export const insertSmartMatchSubscriptionSchema = createInsertSchema(smartMatchSubscriptions);
export const insertAgentSpendCapSchema = createInsertSchema(agentSpendCaps);
export const insertBulkOrderSchema = createInsertSchema(bulkOrders);
export const insertBulkOrderItemSchema = createInsertSchema(bulkOrderItems);
export const insertRoutingRuleSchema = createInsertSchema(routingRules);
export const insertOrgBrandingSchema = createInsertSchema(orgBranding);
export const insertLeadPersonaSchema = createInsertSchema(leadPersonas);
export const insertOutreachDraftSchema = createInsertSchema(outreachDrafts);
export const insertNewsEventSchema = createInsertSchema(newsEvents);
export const insertAgencyProfileSchema = createInsertSchema(agencyProfiles);
export const insertReferralCodeSchema = createInsertSchema(referralCodes);
export const insertReferralSchema = createInsertSchema(referrals);
export const insertMarketplaceIntegrationSchema = createInsertSchema(marketplaceIntegrations);
export const insertMarketplaceIntegrationInstallSchema = createInsertSchema(marketplaceIntegrationInstalls);
