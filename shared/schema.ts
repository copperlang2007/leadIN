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
  // MediScore = aggregated signal score (0-100), recomputed when signals change
  mediscore: integer("mediscore").notNull().default(0),
  mediscoreSignals: jsonb("mediscore_signals"),
  // Server-assigned session id when the source form fired (links behavioral events)
  sessionId: varchar("session_id", { length: 64 }),

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
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }).notNull().unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Notifications log to prevent duplicates
export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
});

export type VendorLeadIngest = z.infer<typeof vendorLeadIngestSchema>;
