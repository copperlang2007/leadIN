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
  // Wave 12a (CM2): rolling state-by-state compliance score 0-100.
  complianceScore: integer("compliance_score").notNull().default(0),
  // Wave 12a (CO1): AEP orchestrator state. 'idle'|'preparing'|'running'|'paused'|'completed'
  aepCampaignStatus: varchar("aep_campaign_status", { length: 20 }),
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
  // Wave 12a (MM7): streaks + daily challenges
  streakCount: integer("streak_count").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at"),
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

  // ──── Wave 12a: vertical expansion + pricing modes ────
  // 'medicare'|'aca'|'mortgage_protection'|'auto'|'home'|'commercial'|'annuity'|'pet'|'final_expense'
  vertical: varchar("vertical", { length: 30 }).notNull().default("medicare"),
  // 'per_lead'|'pay_per_close'|'subscription_match'
  pricingMode: varchar("pricing_mode", { length: 20 }).notNull().default("per_lead"),

  // Status
  sold: boolean("sold").notNull().default(false),
  flagged: boolean("flagged").notNull().default(false),
  removed: boolean("removed").notNull().default(false),
  soldAt: timestamp("sold_at"),
  purchasedBy: varchar("purchased_by").references(() => users.id),

  // ──── M6: Second-Look Re-list ────
  // When an unsold lead ages past the freshness window, the repricer decays
  // `price` and records the sticker value here so the UI can show "was $X"
  // and the next decay is computed from the original, not the discounted, price.
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
  secondLook: boolean("second_look").notNull().default(false),
  repricedAt: timestamp("repriced_at"),

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

// DB-backed idempotency for inbound webhook events. The two existing
// in-memory trackers in server/lib/eventIdempotency.ts (stripe +
// crm-reputation) only dedup within a single process; multi-pod
// deploys can re-fire side effects when the same event lands on a
// different replica. This table is the cross-pod source of truth.
//
// `source` is the namespace (e.g. "stripe", "crm-reputation:hubspot")
// so multiple producers can share the table without collision risk.
// `key` is whatever the producer uses to identify the event (Stripe
// event id, `${provider}:${externalId}` for CRM, etc.).
//
// Idempotency contract: a duplicate INSERT … ON CONFLICT DO NOTHING
// returns rowCount=0, atomically, across all pods.
export const webhookIdempotency = pgTable("webhook_idempotency", {
  source: varchar("source", { length: 64 }).notNull(),
  key: varchar("key", { length: 256 }).notNull(),
  seenAt: timestamp("seen_at").notNull().defaultNow(),
}, (table) => [
  unique("uniq_webhook_idempotency").on(table.source, table.key),
  // Periodic cleanup query filters on seenAt; index keeps the prune
  // cheap once the table has thousands of rows.
  index("idx_webhook_idempotency_seen_at").on(table.seenAt),
]);

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

// In-app notification center. Distinct from `notifications` above, which is an
// email-dedup ledger keyed to leads. Harvested from the leadmarket sibling repo
// (see docs/adr/0001-repo-consolidation-strategy.md): arbitrary per-user,
// readable in-app messages.
export const userNotifications = pgTable("user_notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("info"), // info | success | warning | error
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_notifications_user").on(table.userId),
]);

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;

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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const agentSpendCaps = pgTable("agent_spend_caps", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  monthlyLimitCents: integer("monthly_limit_cents").notNull(),
  currentSpendCents: integer("current_spend_cents").notNull().default(0),
  periodStartedAt: timestamp("period_started_at").defaultNow(),
});

// A3 — Bulk buy + smart fanout
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const bulkOrderItems = pgTable("bulk_order_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  bulkOrderId: integer("bulk_order_id").notNull().references(() => bulkOrders.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  assignedAgentUserId: varchar("assigned_agent_user_id").references(() => users.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
});

// A4 — Custom routing rules DSL.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const referralCodes = pgTable("referral_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ownerKind: varchar("owner_kind", { length: 10 }).notNull(), // 'agent' | 'vendor'
  rewardPct: decimal("reward_pct", { precision: 4, scale: 3 }).notNull(), // e.g., 0.100
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
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

// ══════════════════════════════════════════════════════════════════════════
// Wave 12a — Second batch foundation (one big migration: 0005_second_batch.sql)
// 50 new tables across 9 categories. Subsequent waves 12b-18 branch off this.
// Feature flag prefix: FEATURE_* (see shared/featureFlags.ts)
// ══════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────
// Fintech (6 tables) — F1-F5
// ──────────────────────────────────────────────────────

// F2 — Lead-backed credit line. balanceCents positive = available credit remaining.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const creditLines = pgTable("credit_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  limitCents: integer("limit_cents").notNull(),
  balanceCents: integer("balance_cents").notNull().default(0),
  aprBps: integer("apr_bps").notNull().default(0), // basis points (10000 = 100%)
  status: varchar("status", { length: 20 }).notNull().default("active"), // 'active'|'suspended'|'closed'|'default'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_credit_lines_user").on(table.userId),
  index("idx_credit_lines_org").on(table.orgId),
]);

// F2 — One row per charge / repayment / interest entry against a credit line.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const creditRepayments = pgTable("credit_repayments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  lineId: integer("line_id").notNull().references(() => creditLines.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  kind: varchar("kind", { length: 20 }).notNull(), // 'charge'|'payment'|'interest'
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_credit_repayments_line").on(table.lineId),
  index("idx_credit_repayments_kind").on(table.kind),
]);

// F3 — Commission escrow: held funds released to agent or vendor on a schedule.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const commissionEscrows = pgTable("commission_escrows", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  amountCents: integer("amount_cents").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("held"),
  // 'held'|'released_to_agent'|'released_to_vendor'
  releaseAt: timestamp("release_at"),
  releasedAt: timestamp("released_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_commission_escrows_agent").on(table.agentUserId),
  index("idx_commission_escrows_status").on(table.status),
]);

// F1 — Pay-per-close: agent reserves the lead, only pays on close.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const payPerCloseOrders = pgTable("pay_per_close_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("reserved"),
  // 'reserved'|'closed'|'expired'|'refunded'
  reservedAt: timestamp("reserved_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  closePriceCents: integer("close_price_cents"),
}, (table) => [
  index("idx_ppc_agent").on(table.agentUserId),
  index("idx_ppc_status").on(table.status),
]);

// F4 — Per-order refund insurance policy purchased at checkout.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const refundInsurancePolicies = pgTable("refund_insurance_policies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  premiumPaidCents: integer("premium_paid_cents").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'expired'|'claimed'|'cancelled'
  refundIssuedCents: integer("refund_issued_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_refund_ins_status").on(table.status),
]);

// F5 — Issued wallet debit cards (via Stripe Issuing).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const walletCards = pgTable("wallet_cards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeCardId: varchar("stripe_card_id", { length: 255 }).notNull().unique(),
  last4: varchar("last4", { length: 4 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'frozen'|'cancelled'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_wallet_cards_user").on(table.userId),
]);

// ──────────────────────────────────────────────────────
// Compliance moat (6 tables) — CM1-CM6 + CO1
// ──────────────────────────────────────────────────────

// CM1 — DOI (Department of Insurance) complaints filed against an agent/org.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const doiComplaints = pgTable("doi_complaints", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  state: varchar("state", { length: 2 }).notNull(),
  complaintNumber: varchar("complaint_number", { length: 100 }),
  filedAt: timestamp("filed_at").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("open"),
  // 'open'|'responded'|'closed'|'settled'|'dismissed'
  summary: text("summary"),
  defensePacketId: integer("defense_packet_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_doi_complaints_org").on(table.orgId),
  index("idx_doi_complaints_state").on(table.state),
  index("idx_doi_complaints_status").on(table.status),
]);

// CM1 — Auto-generated defense packet (PDF + evidence bundle) for a complaint.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const defensePackets = pgTable("defense_packets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  complaintId: integer("complaint_id").references(() => doiComplaints.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  packetUrl: text("packet_url"),
  evidenceJson: jsonb("evidence_json"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // 'draft'|'generated'|'submitted'
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_defense_packets_org").on(table.orgId),
  index("idx_defense_packets_complaint").on(table.complaintId),
]);

// CM4 — "Certified by LeadMarket" issued certifications.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const complianceCertifications = pgTable("compliance_certifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  certKind: varchar("cert_kind", { length: 40 }).notNull(),
  // 'tcpa_clean'|'cms_mippa'|'state_doi'|'pii_iso'
  level: varchar("level", { length: 20 }).notNull().default("bronze"), // 'bronze'|'silver'|'gold'
  scorePct: integer("score_pct").notNull().default(0),
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  badgeUrl: text("badge_url"),
}, (table) => [
  index("idx_compliance_certs_org").on(table.orgId),
  unique("uniq_compliance_cert").on(table.orgId, table.certKind),
]);

// CM3 — CMS MIPPA marketing-material filings.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const cmsFilings = pgTable("cms_filings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  filingKind: varchar("filing_kind", { length: 40 }).notNull(),
  // 'sob'|'enrollment_kit'|'ad_script'|'website'
  materialUrl: text("material_url"),
  submittedAt: timestamp("submitted_at"),
  cmsId: varchar("cms_id", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // 'draft'|'submitted'|'approved'|'rejected'
  reviewNotes: text("review_notes"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_cms_filings_org").on(table.orgId),
  index("idx_cms_filings_status").on(table.status),
]);

// CM6 — PII retention policies per org for GDPR/CCPA auto-deletion timer.
export const piiRetentionPolicies = pgTable("pii_retention_policies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  leadPiiDays: integer("lead_pii_days").notNull().default(365),
  recordingDays: integer("recording_days").notNull().default(180),
  transcriptDays: integer("transcript_days").notNull().default(365),
  autoDeleteEnabled: boolean("auto_delete_enabled").notNull().default(true),
  lastSweepAt: timestamp("last_sweep_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CM5 / TCPA watchdog: realtime events flagged by the compliance monitor.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const tcpaWatchdogEvents = pgTable("tcpa_watchdog_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  eventKind: varchar("event_kind", { length: 40 }).notNull(),
  // 'after_hours_dial'|'dnc_attempt'|'missing_consent'|'two_party_state_no_notice'
  severity: varchar("severity", { length: 10 }).notNull().default("warn"), // 'info'|'warn'|'critical'
  details: jsonb("details"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_watchdog_org").on(table.orgId),
  index("idx_watchdog_severity").on(table.severity),
  index("idx_watchdog_created").on(table.createdAt),
]);

// ──────────────────────────────────────────────────────
// Marketplace mechanics (12 tables) — MM1-MM8 + M6
// ──────────────────────────────────────────────────────

// MM1 — Reverse auction (buyer specifies criteria, vendors bid).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const reverseAuctions = pgTable("reverse_auctions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  buyerUserId: varchar("buyer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  criteriaJson: jsonb("criteria_json").notNull(),
  maxBidCents: integer("max_bid_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  // 'open'|'awarded'|'cancelled'|'expired'
  closesAt: timestamp("closes_at").notNull(),
  awardedBidId: integer("awarded_bid_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_reverse_auctions_buyer").on(table.buyerUserId),
  index("idx_reverse_auctions_status").on(table.status),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const reverseAuctionBids = pgTable("reverse_auction_bids", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  auctionId: integer("auction_id").notNull().references(() => reverseAuctions.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  bidCents: integer("bid_cents").notNull(),
  leadCount: integer("lead_count").notNull(),
  noteText: text("note_text"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'withdrawn'|'won'|'lost'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_reverse_bids_auction").on(table.auctionId),
  index("idx_reverse_bids_vendor").on(table.vendorId),
]);

// MM2 — Wishlist: buyer subscribes to a criteria + gets notified on match.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const wishlists = pgTable("wishlists", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  name: varchar("name", { length: 200 }).notNull(),
  criteriaJson: jsonb("criteria_json").notNull(),
  maxPriceCents: integer("max_price_cents"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_wishlists_user").on(table.userId),
  index("idx_wishlists_active").on(table.active),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const wishlistMatches = pgTable("wishlist_matches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  wishlistId: integer("wishlist_id").notNull().references(() => wishlists.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  notifiedAt: timestamp("notified_at"),
  purchased: boolean("purchased").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_wishlist_match").on(table.wishlistId, table.leadId),
  index("idx_wishlist_matches_wishlist").on(table.wishlistId),
]);

// MM3 — Trade-in credit: agent returns a stale lead for partial credit.
export const leadTradeInCredits = pgTable("lead_tradein_credits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  creditCents: integer("credit_cents").notNull(),
  reason: varchar("reason", { length: 60 }),
  status: varchar("status", { length: 20 }).notNull().default("issued"),
  // 'issued'|'redeemed'|'expired'
  redeemedAt: timestamp("redeemed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_tradein_agent").on(table.agentUserId),
]);

// MM4 — Lead share syndication group.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadShares = pgTable("lead_shares", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  splitPct: decimal("split_pct", { precision: 5, scale: 2 }).notNull().default("50.00"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_lead_shares_owner").on(table.ownerUserId),
  index("idx_lead_shares_lead").on(table.leadId),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadShareMembers = pgTable("lead_share_members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  shareId: integer("share_id").notNull().references(() => leadShares.id, { onDelete: "cascade" }),
  memberUserId: varchar("member_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_share_member").on(table.shareId, table.memberUserId),
  index("idx_share_members_user").on(table.memberUserId),
]);

// MM5 — Lead X-ray: cached aggregate stats per lead.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadXrayStats = pgTable("lead_xray_stats", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  views: integer("views").notNull().default(0),
  uniqueViewers: integer("unique_viewers").notNull().default(0),
  avgDwellSec: integer("avg_dwell_sec").notNull().default(0),
  similarSoldCount: integer("similar_sold_count").notNull().default(0),
  similarAvgCloseRatePct: integer("similar_avg_close_rate_pct").notNull().default(0),
  computedAt: timestamp("computed_at").defaultNow(),
}, (table) => [
  index("idx_lead_xray_lead").on(table.leadId),
]);

// MM6 — Verified review (post-close).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const vendorReviews = pgTable("vendor_reviews", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  reviewerUserId: varchar("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(), // 1-5
  body: text("body"),
  verified: boolean("verified").notNull().default(false),
  helpfulCount: integer("helpful_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_vendor_reviews_vendor").on(table.vendorId),
  index("idx_vendor_reviews_rating").on(table.rating),
  unique("uniq_vendor_review_per_order").on(table.orderId),
]);

// MM7 — Agent streak ledger (one row per day with activity).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const agentStreaks = pgTable("agent_streaks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  streakDate: timestamp("streak_date").notNull(),
  activityCount: integer("activity_count").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_agent_streak_day").on(table.agentUserId, table.streakDate),
  index("idx_agent_streaks_agent").on(table.agentUserId),
]);

// MM7 — Daily challenges (issued and completed).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const dailyChallenges = pgTable("daily_challenges", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  challengeKind: varchar("challenge_kind", { length: 40 }).notNull(),
  // 'first_call_under_2m'|'three_dispositions'|'five_dials'|'one_sale'
  targetValue: integer("target_value").notNull(),
  currentValue: integer("current_value").notNull().default(0),
  rewardCents: integer("reward_cents").notNull().default(0),
  forDate: timestamp("for_date").notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_daily_challenges_agent").on(table.agentUserId),
  index("idx_daily_challenges_date").on(table.forDate),
  unique("uniq_daily_challenge").on(table.agentUserId, table.challengeKind, table.forDate),
]);

// MM7 — Agent achievements (lifetime badges).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const agentAchievements = pgTable("agent_achievements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  achievementKey: varchar("achievement_key", { length: 60 }).notNull(),
  // 'first_sale'|'100_sales'|'streak_30'|'top_closer_state'
  earnedAt: timestamp("earned_at").defaultNow(),
  meta: jsonb("meta"),
}, (table) => [
  unique("uniq_agent_achievement").on(table.agentUserId, table.achievementKey),
  index("idx_achievements_agent").on(table.agentUserId),
]);

// MM8 — "Won deals" public feed posts.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const winsFeedPosts = pgTable("wins_feed_posts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
  headline: varchar("headline", { length: 280 }).notNull(),
  amountCents: integer("amount_cents"),
  state: varchar("state", { length: 2 }),
  isPublic: boolean("is_public").notNull().default(true),
  reactionsCount: integer("reactions_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_wins_feed_created").on(table.createdAt),
  index("idx_wins_feed_agent").on(table.agentUserId),
]);

// ──────────────────────────────────────────────────────
// Voice/AR (4 tables) — VR1, VR3, VR4, VR5
// ──────────────────────────────────────────────────────

// VR1 — Video call escalation sessions (LiveKit / Twilio Video).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const videoCallSessions = pgTable("video_call_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  callLogId: integer("call_log_id").references(() => callLogs.id, { onDelete: "set null" }),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  roomSid: varchar("room_sid", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  // 'created'|'in_progress'|'completed'|'failed'
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  recordingUrl: text("recording_url"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_video_call_agent").on(table.agentUserId),
  index("idx_video_call_lead").on(table.leadId),
]);

// VR3 — Voice clone for personalized voicemail drops.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const voiceClones = pgTable("voice_clones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  providerVoiceId: varchar("provider_voice_id", { length: 200 }),
  provider: varchar("provider", { length: 30 }).notNull().default("elevenlabs"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // 'pending'|'training'|'ready'|'failed'
  sampleUrl: text("sample_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VR5 — AI-narrated audio tour cache per lead.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadAudioTours = pgTable("lead_audio_tours", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  audioUrl: text("audio_url").notNull(),
  transcript: text("transcript"),
  durationSec: integer("duration_sec"),
  generatedAt: timestamp("generated_at").defaultNow(),
});

// VR4 — Sentiment snapshots from call streams (every N seconds).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const sentimentSnapshots = pgTable("sentiment_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  callLogId: integer("call_log_id").notNull().references(() => callLogs.id, { onDelete: "cascade" }),
  offsetSec: integer("offset_sec").notNull(),
  sentimentScore: decimal("sentiment_score", { precision: 4, scale: 3 }).notNull(), // -1.000..1.000
  emotion: varchar("emotion", { length: 30 }),
  // 'neutral'|'happy'|'angry'|'sad'|'confused'|'interested'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_sentiment_call").on(table.callLogId),
]);

// ──────────────────────────────────────────────────────
// Embedded SaaS (3 tables) — ES1, ES2, ES4
// ──────────────────────────────────────────────────────

// ES1 — Embeddable quote widget configs.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const quoteWidgets = pgTable("quote_widgets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  widgetKey: varchar("widget_key", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  vertical: varchar("vertical", { length: 30 }).notNull().default("medicare"),
  themeJson: jsonb("theme_json"),
  enabled: boolean("enabled").notNull().default(true),
  embedsCount: integer("embeds_count").notNull().default(0),
  submitsCount: integer("submits_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_quote_widgets_org").on(table.orgId),
]);

// ES2 — No-code landing pages.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const landingPages = pgTable("landing_pages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  blocksJson: jsonb("blocks_json").notNull(),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  viewsCount: integer("views_count").notNull().default(0),
  leadsCount: integer("leads_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_landing_pages_org").on(table.orgId),
  index("idx_landing_pages_published").on(table.published),
]);

// ES4 — Provisioned Twilio phone numbers (per agent or org).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const provisionedPhoneNumbers = pgTable("provisioned_phone_numbers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  agentUserId: varchar("agent_user_id").references(() => users.id, { onDelete: "set null" }),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
  twilioSid: varchar("twilio_sid", { length: 100 }),
  capabilities: text("capabilities").array().notNull().default(sql`ARRAY[]::text[]`),
  // 'voice'|'sms'|'mms'
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'released'|'suspended'
  monthlyCostCents: integer("monthly_cost_cents"),
  provisionedAt: timestamp("provisioned_at").defaultNow(),
}, (table) => [
  index("idx_phone_numbers_org").on(table.orgId),
  index("idx_phone_numbers_agent").on(table.agentUserId),
]);

// ──────────────────────────────────────────────────────
// Data products (4 tables) — DP1-DP4
// ──────────────────────────────────────────────────────

// DP3 — MediScore API keys (B2B consumers).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const mediscoreApiKeys = pgTable("mediscore_api_keys", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  monthlyQuota: integer("monthly_quota").notNull().default(10000),
  pricePerCallCents: integer("price_per_call_cents").notNull().default(5),
  active: boolean("active").notNull().default(true),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mediscore_api_keys_prefix").on(table.keyPrefix),
]);

// DP3 — MediScore API usage log.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const mediscoreApiUsage = pgTable("mediscore_api_usage", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  apiKeyId: integer("api_key_id").notNull().references(() => mediscoreApiKeys.id, { onDelete: "cascade" }),
  endpoint: varchar("endpoint", { length: 100 }).notNull(),
  statusCode: integer("status_code").notNull(),
  latencyMs: integer("latency_ms"),
  billedCents: integer("billed_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mediscore_usage_key").on(table.apiKeyId),
  index("idx_mediscore_usage_created").on(table.createdAt),
]);

// DP1/DP2 — Saleable data products (datasets, reports).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const dataProducts = pgTable("data_products", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(),
  // 'dataset'|'report'|'api'|'dashboard'
  description: text("description"),
  priceCents: integer("price_cents").notNull().default(0),
  cadence: varchar("cadence", { length: 20 }), // 'one_time'|'monthly'|'quarterly'|'annual'
  sampleUrl: text("sample_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_data_products_kind").on(table.kind),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const dataProductSubscriptions = pgTable("data_product_subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: integer("product_id").notNull().references(() => dataProducts.id, { onDelete: "cascade" }),
  subscriberUserId: varchar("subscriber_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'paused'|'cancelled'
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_data_product_sub").on(table.productId, table.subscriberUserId),
  index("idx_data_product_subs_user").on(table.subscriberUserId),
]);

// ──────────────────────────────────────────────────────
// Owned media (7 tables) — OM1, OM2, OM3, OM4, OM7
// ──────────────────────────────────────────────────────

// OM1 — Compliance webinars.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const webinars = pgTable("webinars", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  presenter: varchar("presenter", { length: 255 }),
  startsAt: timestamp("starts_at").notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  zoomUrl: text("zoom_url"),
  replayUrl: text("replay_url"),
  ceCredits: decimal("ce_credits", { precision: 3, scale: 1 }),
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  // 'scheduled'|'live'|'completed'|'cancelled'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_webinars_starts").on(table.startsAt),
  index("idx_webinars_status").on(table.status),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const webinarRegistrations = pgTable("webinar_registrations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  webinarId: integer("webinar_id").notNull().references(() => webinars.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }).notNull(),
  attended: boolean("attended").notNull().default(false),
  certificateUrl: text("certificate_url"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_webinar_reg").on(table.webinarId, table.email),
  index("idx_webinar_regs_user").on(table.userId),
]);

// OM2 — Daily AI news brief.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const newsBriefs = pgTable("news_briefs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  briefDate: timestamp("brief_date").notNull(),
  headline: varchar("headline", { length: 500 }).notNull(),
  summary: text("summary").notNull(),
  storiesJson: jsonb("stories_json"),
  audioUrl: text("audio_url"),
  publishedAt: timestamp("published_at"),
  viewsCount: integer("views_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_news_brief_date").on(table.briefDate),
  index("idx_news_briefs_published").on(table.publishedAt),
]);

// OM4 — Affiliates publishing program.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const affiliates = pgTable("affiliates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  affiliateCode: varchar("affiliate_code", { length: 30 }).notNull().unique(),
  payoutMethod: varchar("payout_method", { length: 20 }).notNull().default("stripe"),
  taxFormUrl: text("tax_form_url"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // 'pending'|'active'|'suspended'|'cancelled'
  totalEarnedCents: integer("total_earned_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const affiliatePayouts = pgTable("affiliate_payouts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  affiliateId: integer("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // 'pending'|'paid'|'failed'
  stripeTransferId: varchar("stripe_transfer_id", { length: 200 }),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_affiliate_payouts_aff").on(table.affiliateId),
  index("idx_affiliate_payouts_status").on(table.status),
]);

// OM7 — Mentor matches.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const mentorMatches = pgTable("mentor_matches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  mentorUserId: varchar("mentor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  menteeUserId: varchar("mentee_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("proposed"),
  // 'proposed'|'accepted'|'declined'|'completed'|'cancelled'
  matchScore: integer("match_score").notNull().default(0),
  sessionsHeld: integer("sessions_held").notNull().default(0),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_mentor_mentee").on(table.mentorUserId, table.menteeUserId),
  index("idx_mentor_matches_mentor").on(table.mentorUserId),
  index("idx_mentor_matches_mentee").on(table.menteeUserId),
]);

// OM3 — Agent Academy certifications earned.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const agentCertifications = pgTable("agent_certifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agentUserId: varchar("agent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  certKey: varchar("cert_key", { length: 60 }).notNull(),
  // 'medicare_basic'|'aca_advanced'|'tcpa_specialist'|'agency_owner'
  scorePct: integer("score_pct").notNull().default(0),
  passedAt: timestamp("passed_at"),
  certificateUrl: text("certificate_url"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_agent_cert").on(table.agentUserId, table.certKey),
  index("idx_agent_certs_agent").on(table.agentUserId),
]);

// ──────────────────────────────────────────────────────
// Dev ecosystem (3 tables) — DE2, DE4
// ──────────────────────────────────────────────────────

// DE2 — Public webhooks subscribed by orgs/integrations.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const publicWebhooks = pgTable("public_webhooks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  targetUrl: text("target_url").notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  eventTypes: text("event_types").array().notNull().default(sql`ARRAY[]::text[]`),
  // 'lead.created'|'lead.sold'|'order.created'|'dispute.opened'|...
  active: boolean("active").notNull().default(true),
  lastDeliveredAt: timestamp("last_delivered_at"),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_public_webhooks_org").on(table.orgId),
  index("idx_public_webhooks_active").on(table.active),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  webhookId: integer("webhook_id").notNull().references(() => publicWebhooks.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  payload: jsonb("payload").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  attempt: integer("attempt").notNull().default(1),
  succeeded: boolean("succeeded").notNull().default(false),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_webhook_deliveries_hook").on(table.webhookId),
  index("idx_webhook_deliveries_created").on(table.createdAt),
]);

// DE4 — SDK install metrics (telemetry from npm/TS SDK).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const sdkInstallMetrics = pgTable("sdk_install_metrics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sdkName: varchar("sdk_name", { length: 60 }).notNull(),
  sdkVersion: varchar("sdk_version", { length: 30 }).notNull(),
  installSource: varchar("install_source", { length: 30 }), // 'npm'|'cdn'|'github'
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  count: integer("count").notNull().default(1),
  reportedAt: timestamp("reported_at").defaultNow(),
}, (table) => [
  index("idx_sdk_install_name").on(table.sdkName),
  index("idx_sdk_install_reported").on(table.reportedAt),
]);

// ──────────────────────────────────────────────────────
// Out-there (5 tables) — OT1, OT3, OT4, OT5, OT6
// ──────────────────────────────────────────────────────

// OT1 — Obituary scraper signals → final expense pipeline.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const obituarySignals = pgTable("obituary_signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  source: varchar("source", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }),
  county: varchar("county", { length: 100 }),
  decedentInitials: varchar("decedent_initials", { length: 8 }),
  age: integer("age"),
  publishedAt: timestamp("published_at"),
  rawSnippet: text("raw_snippet"),
  contactability: integer("contactability").notNull().default(0), // 0-100 heuristic
  convertedToLeadId: integer("converted_to_lead_id").references(() => leads.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_obituary_state").on(table.state),
  index("idx_obituary_published").on(table.publishedAt),
]);

// OT3 — Lead options/futures: option contract definitions.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadOptions = pgTable("lead_options", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  writerVendorId: integer("writer_vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  strikeCents: integer("strike_cents").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  criteriaJson: jsonb("criteria_json").notNull(),
  premiumCents: integer("premium_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  // 'open'|'bought'|'exercised'|'expired'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_lead_options_status").on(table.status),
  index("idx_lead_options_expires").on(table.expiresAt),
]);

// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const leadOptionContracts = pgTable("lead_option_contracts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  optionId: integer("option_id").notNull().references(() => leadOptions.id, { onDelete: "cascade" }),
  holderUserId: varchar("holder_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  paidPremiumCents: integer("paid_premium_cents").notNull(),
  exercisedAt: timestamp("exercised_at"),
  exerciseLeadId: integer("exercise_lead_id").references(() => leads.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // 'active'|'exercised'|'expired'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_lead_option_contracts_holder").on(table.holderUserId),
  index("idx_lead_option_contracts_option").on(table.optionId),
]);

// OT4 — Direct mail marketplace orders.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const directMailOrders = pgTable("direct_mail_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  buyerUserId: varchar("buyer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "set null" }),
  campaignName: varchar("campaign_name", { length: 200 }).notNull(),
  targetCount: integer("target_count").notNull(),
  zipsJson: jsonb("zips_json").notNull(),
  pieceTemplate: varchar("piece_template", { length: 60 }),
  pricePerPieceCents: integer("price_per_piece_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // 'draft'|'submitted'|'printing'|'mailed'|'delivered'|'cancelled'
  mailedAt: timestamp("mailed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_direct_mail_buyer").on(table.buyerUserId),
  index("idx_direct_mail_status").on(table.status),
]);

// OT5 — Carrier-direct binding pipelines (per org per carrier).
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const carrierDirectPipelines = pgTable("carrier_direct_pipelines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  carrierName: varchar("carrier_name", { length: 255 }).notNull(),
  carrierProductCode: varchar("carrier_product_code", { length: 100 }),
  pipelineKey: varchar("pipeline_key", { length: 100 }).notNull(),
  apiEndpoint: text("api_endpoint"),
  apiCredentialsJson: jsonb("api_credentials_json"),
  status: varchar("status", { length: 20 }).notNull().default("inactive"),
  // 'inactive'|'active'|'error'|'paused'
  bindingsCount: integer("bindings_count").notNull().default(0),
  lastBindingAt: timestamp("last_binding_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uniq_carrier_pipeline").on(table.orgId, table.pipelineKey),
  index("idx_carrier_pipelines_org").on(table.orgId),
]);

// OT6 — Language packs for the Spanish-language (and future) vertical.
// @roadmap: not yet wired — no server references. See docs/SCHEMA-STATUS.md
export const languagePacks = pgTable("language_packs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  locale: varchar("locale", { length: 10 }).notNull().unique(),
  // 'es-US'|'es-MX'|'zh-CN'|'vi-VN'|...
  displayName: varchar("display_name", { length: 100 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  translationsJson: jsonb("translations_json").notNull(),
  coveragePct: integer("coverage_pct").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ══════════════════════════════════════════════════════════════════════════
// Wave 12a — Relations
// ══════════════════════════════════════════════════════════════════════════
export const creditLinesRelations = relations(creditLines, ({ one, many }) => ({
  user: one(users, { fields: [creditLines.userId], references: [users.id] }),
  org: one(organizations, { fields: [creditLines.orgId], references: [organizations.id] }),
  repayments: many(creditRepayments),
}));

export const creditRepaymentsRelations = relations(creditRepayments, ({ one }) => ({
  line: one(creditLines, { fields: [creditRepayments.lineId], references: [creditLines.id] }),
  order: one(orders, { fields: [creditRepayments.orderId], references: [orders.id] }),
}));

export const commissionEscrowsRelations = relations(commissionEscrows, ({ one }) => ({
  order: one(orders, { fields: [commissionEscrows.orderId], references: [orders.id] }),
  agent: one(users, { fields: [commissionEscrows.agentUserId], references: [users.id] }),
}));

export const payPerCloseOrdersRelations = relations(payPerCloseOrders, ({ one }) => ({
  lead: one(leads, { fields: [payPerCloseOrders.leadId], references: [leads.id] }),
  agent: one(users, { fields: [payPerCloseOrders.agentUserId], references: [users.id] }),
}));

export const refundInsurancePoliciesRelations = relations(refundInsurancePolicies, ({ one }) => ({
  order: one(orders, { fields: [refundInsurancePolicies.orderId], references: [orders.id] }),
}));

export const walletCardsRelations = relations(walletCards, ({ one }) => ({
  user: one(users, { fields: [walletCards.userId], references: [users.id] }),
}));

export const doiComplaintsRelations = relations(doiComplaints, ({ one }) => ({
  org: one(organizations, { fields: [doiComplaints.orgId], references: [organizations.id] }),
  agent: one(users, { fields: [doiComplaints.agentUserId], references: [users.id] }),
}));

export const defensePacketsRelations = relations(defensePackets, ({ one }) => ({
  complaint: one(doiComplaints, { fields: [defensePackets.complaintId], references: [doiComplaints.id] }),
  org: one(organizations, { fields: [defensePackets.orgId], references: [organizations.id] }),
}));

export const reverseAuctionsRelations = relations(reverseAuctions, ({ one, many }) => ({
  buyer: one(users, { fields: [reverseAuctions.buyerUserId], references: [users.id] }),
  bids: many(reverseAuctionBids),
}));

export const reverseAuctionBidsRelations = relations(reverseAuctionBids, ({ one }) => ({
  auction: one(reverseAuctions, { fields: [reverseAuctionBids.auctionId], references: [reverseAuctions.id] }),
  vendor: one(vendors, { fields: [reverseAuctionBids.vendorId], references: [vendors.id] }),
}));

export const wishlistsRelations = relations(wishlists, ({ one, many }) => ({
  user: one(users, { fields: [wishlists.userId], references: [users.id] }),
  matches: many(wishlistMatches),
}));

export const wishlistMatchesRelations = relations(wishlistMatches, ({ one }) => ({
  wishlist: one(wishlists, { fields: [wishlistMatches.wishlistId], references: [wishlists.id] }),
  lead: one(leads, { fields: [wishlistMatches.leadId], references: [leads.id] }),
}));

export const leadSharesRelations = relations(leadShares, ({ one, many }) => ({
  owner: one(users, { fields: [leadShares.ownerUserId], references: [users.id] }),
  lead: one(leads, { fields: [leadShares.leadId], references: [leads.id] }),
  members: many(leadShareMembers),
}));

export const leadShareMembersRelations = relations(leadShareMembers, ({ one }) => ({
  share: one(leadShares, { fields: [leadShareMembers.shareId], references: [leadShares.id] }),
  member: one(users, { fields: [leadShareMembers.memberUserId], references: [users.id] }),
}));

export const vendorReviewsRelations = relations(vendorReviews, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorReviews.vendorId], references: [vendors.id] }),
  reviewer: one(users, { fields: [vendorReviews.reviewerUserId], references: [users.id] }),
  order: one(orders, { fields: [vendorReviews.orderId], references: [orders.id] }),
}));

export const webinarsRelations = relations(webinars, ({ many }) => ({
  registrations: many(webinarRegistrations),
}));

export const webinarRegistrationsRelations = relations(webinarRegistrations, ({ one }) => ({
  webinar: one(webinars, { fields: [webinarRegistrations.webinarId], references: [webinars.id] }),
  user: one(users, { fields: [webinarRegistrations.userId], references: [users.id] }),
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  user: one(users, { fields: [affiliates.userId], references: [users.id] }),
  payouts: many(affiliatePayouts),
}));

export const affiliatePayoutsRelations = relations(affiliatePayouts, ({ one }) => ({
  affiliate: one(affiliates, { fields: [affiliatePayouts.affiliateId], references: [affiliates.id] }),
}));

export const publicWebhooksRelations = relations(publicWebhooks, ({ one, many }) => ({
  org: one(organizations, { fields: [publicWebhooks.orgId], references: [organizations.id] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(publicWebhooks, { fields: [webhookDeliveries.webhookId], references: [publicWebhooks.id] }),
}));

export const leadOptionsRelations = relations(leadOptions, ({ one, many }) => ({
  writer: one(vendors, { fields: [leadOptions.writerVendorId], references: [vendors.id] }),
  contracts: many(leadOptionContracts),
}));

export const leadOptionContractsRelations = relations(leadOptionContracts, ({ one }) => ({
  option: one(leadOptions, { fields: [leadOptionContracts.optionId], references: [leadOptions.id] }),
  holder: one(users, { fields: [leadOptionContracts.holderUserId], references: [users.id] }),
  exerciseLead: one(leads, { fields: [leadOptionContracts.exerciseLeadId], references: [leads.id] }),
}));

// ══════════════════════════════════════════════════════════════════════════
// Wave 12a — Type exports + insert schemas
// ══════════════════════════════════════════════════════════════════════════
export type InsertCreditLine = typeof creditLines.$inferInsert;
export type CreditLine = typeof creditLines.$inferSelect;
export type InsertCreditRepayment = typeof creditRepayments.$inferInsert;
export type CreditRepayment = typeof creditRepayments.$inferSelect;
export type InsertCommissionEscrow = typeof commissionEscrows.$inferInsert;
export type CommissionEscrow = typeof commissionEscrows.$inferSelect;
export type InsertPayPerCloseOrder = typeof payPerCloseOrders.$inferInsert;
export type PayPerCloseOrder = typeof payPerCloseOrders.$inferSelect;
export type InsertRefundInsurancePolicy = typeof refundInsurancePolicies.$inferInsert;
export type RefundInsurancePolicy = typeof refundInsurancePolicies.$inferSelect;
export type InsertWalletCard = typeof walletCards.$inferInsert;
export type WalletCard = typeof walletCards.$inferSelect;

export type InsertDoiComplaint = typeof doiComplaints.$inferInsert;
export type DoiComplaint = typeof doiComplaints.$inferSelect;
export type InsertDefensePacket = typeof defensePackets.$inferInsert;
export type DefensePacket = typeof defensePackets.$inferSelect;
export type InsertComplianceCertification = typeof complianceCertifications.$inferInsert;
export type ComplianceCertification = typeof complianceCertifications.$inferSelect;
export type InsertCmsFiling = typeof cmsFilings.$inferInsert;
export type CmsFiling = typeof cmsFilings.$inferSelect;
export type InsertPiiRetentionPolicy = typeof piiRetentionPolicies.$inferInsert;
export type PiiRetentionPolicy = typeof piiRetentionPolicies.$inferSelect;
export type InsertTcpaWatchdogEvent = typeof tcpaWatchdogEvents.$inferInsert;
export type TcpaWatchdogEvent = typeof tcpaWatchdogEvents.$inferSelect;

export type InsertReverseAuction = typeof reverseAuctions.$inferInsert;
export type ReverseAuction = typeof reverseAuctions.$inferSelect;
export type InsertReverseAuctionBid = typeof reverseAuctionBids.$inferInsert;
export type ReverseAuctionBid = typeof reverseAuctionBids.$inferSelect;
export type InsertWishlist = typeof wishlists.$inferInsert;
export type Wishlist = typeof wishlists.$inferSelect;
export type InsertWishlistMatch = typeof wishlistMatches.$inferInsert;
export type WishlistMatch = typeof wishlistMatches.$inferSelect;
export type InsertLeadTradeInCredit = typeof leadTradeInCredits.$inferInsert;
export type LeadTradeInCredit = typeof leadTradeInCredits.$inferSelect;
export type InsertLeadShare = typeof leadShares.$inferInsert;
export type LeadShare = typeof leadShares.$inferSelect;
export type InsertLeadShareMember = typeof leadShareMembers.$inferInsert;
export type LeadShareMember = typeof leadShareMembers.$inferSelect;
export type InsertLeadXrayStats = typeof leadXrayStats.$inferInsert;
export type LeadXrayStats = typeof leadXrayStats.$inferSelect;
export type InsertVendorReview = typeof vendorReviews.$inferInsert;
export type VendorReview = typeof vendorReviews.$inferSelect;
export type InsertAgentStreak = typeof agentStreaks.$inferInsert;
export type AgentStreak = typeof agentStreaks.$inferSelect;
export type InsertDailyChallenge = typeof dailyChallenges.$inferInsert;
export type DailyChallenge = typeof dailyChallenges.$inferSelect;
export type InsertAgentAchievement = typeof agentAchievements.$inferInsert;
export type AgentAchievement = typeof agentAchievements.$inferSelect;
export type InsertWinsFeedPost = typeof winsFeedPosts.$inferInsert;
export type WinsFeedPost = typeof winsFeedPosts.$inferSelect;

export type InsertVideoCallSession = typeof videoCallSessions.$inferInsert;
export type VideoCallSession = typeof videoCallSessions.$inferSelect;
export type InsertVoiceClone = typeof voiceClones.$inferInsert;
export type VoiceClone = typeof voiceClones.$inferSelect;
export type InsertLeadAudioTour = typeof leadAudioTours.$inferInsert;
export type LeadAudioTour = typeof leadAudioTours.$inferSelect;
export type InsertSentimentSnapshot = typeof sentimentSnapshots.$inferInsert;
export type SentimentSnapshot = typeof sentimentSnapshots.$inferSelect;

export type InsertQuoteWidget = typeof quoteWidgets.$inferInsert;
export type QuoteWidget = typeof quoteWidgets.$inferSelect;
export type InsertLandingPage = typeof landingPages.$inferInsert;
export type LandingPage = typeof landingPages.$inferSelect;
export type InsertProvisionedPhoneNumber = typeof provisionedPhoneNumbers.$inferInsert;
export type ProvisionedPhoneNumber = typeof provisionedPhoneNumbers.$inferSelect;

export type InsertMediscoreApiKey = typeof mediscoreApiKeys.$inferInsert;
export type MediscoreApiKey = typeof mediscoreApiKeys.$inferSelect;
export type InsertMediscoreApiUsage = typeof mediscoreApiUsage.$inferInsert;
export type MediscoreApiUsage = typeof mediscoreApiUsage.$inferSelect;
export type InsertDataProduct = typeof dataProducts.$inferInsert;
export type DataProduct = typeof dataProducts.$inferSelect;
export type InsertDataProductSubscription = typeof dataProductSubscriptions.$inferInsert;
export type DataProductSubscription = typeof dataProductSubscriptions.$inferSelect;

export type InsertWebinar = typeof webinars.$inferInsert;
export type Webinar = typeof webinars.$inferSelect;
export type InsertWebinarRegistration = typeof webinarRegistrations.$inferInsert;
export type WebinarRegistration = typeof webinarRegistrations.$inferSelect;
export type InsertNewsBrief = typeof newsBriefs.$inferInsert;
export type NewsBrief = typeof newsBriefs.$inferSelect;
export type InsertAffiliate = typeof affiliates.$inferInsert;
export type Affiliate = typeof affiliates.$inferSelect;
export type InsertAffiliatePayout = typeof affiliatePayouts.$inferInsert;
export type AffiliatePayout = typeof affiliatePayouts.$inferSelect;
export type InsertMentorMatch = typeof mentorMatches.$inferInsert;
export type MentorMatch = typeof mentorMatches.$inferSelect;
export type InsertAgentCertification = typeof agentCertifications.$inferInsert;
export type AgentCertification = typeof agentCertifications.$inferSelect;

export type InsertPublicWebhook = typeof publicWebhooks.$inferInsert;
export type PublicWebhook = typeof publicWebhooks.$inferSelect;
export type InsertWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertSdkInstallMetric = typeof sdkInstallMetrics.$inferInsert;
export type SdkInstallMetric = typeof sdkInstallMetrics.$inferSelect;

export type InsertObituarySignal = typeof obituarySignals.$inferInsert;
export type ObituarySignal = typeof obituarySignals.$inferSelect;
export type InsertLeadOption = typeof leadOptions.$inferInsert;
export type LeadOption = typeof leadOptions.$inferSelect;
export type InsertLeadOptionContract = typeof leadOptionContracts.$inferInsert;
export type LeadOptionContract = typeof leadOptionContracts.$inferSelect;
export type InsertDirectMailOrder = typeof directMailOrders.$inferInsert;
export type DirectMailOrder = typeof directMailOrders.$inferSelect;
export type InsertCarrierDirectPipeline = typeof carrierDirectPipelines.$inferInsert;
export type CarrierDirectPipeline = typeof carrierDirectPipelines.$inferSelect;
export type InsertLanguagePack = typeof languagePacks.$inferInsert;
export type LanguagePack = typeof languagePacks.$inferSelect;

export const insertCreditLineSchema = createInsertSchema(creditLines);
export const insertCreditRepaymentSchema = createInsertSchema(creditRepayments);
export const insertCommissionEscrowSchema = createInsertSchema(commissionEscrows);
export const insertPayPerCloseOrderSchema = createInsertSchema(payPerCloseOrders);
export const insertRefundInsurancePolicySchema = createInsertSchema(refundInsurancePolicies);
export const insertWalletCardSchema = createInsertSchema(walletCards);
export const insertDoiComplaintSchema = createInsertSchema(doiComplaints);
export const insertDefensePacketSchema = createInsertSchema(defensePackets);
export const insertComplianceCertificationSchema = createInsertSchema(complianceCertifications);
export const insertCmsFilingSchema = createInsertSchema(cmsFilings);
export const insertPiiRetentionPolicySchema = createInsertSchema(piiRetentionPolicies);
export const insertTcpaWatchdogEventSchema = createInsertSchema(tcpaWatchdogEvents);
export const insertReverseAuctionSchema = createInsertSchema(reverseAuctions);
export const insertReverseAuctionBidSchema = createInsertSchema(reverseAuctionBids);
export const insertWishlistSchema = createInsertSchema(wishlists);
export const insertWishlistMatchSchema = createInsertSchema(wishlistMatches);
export const insertLeadTradeInCreditSchema = createInsertSchema(leadTradeInCredits);
export const insertLeadShareSchema = createInsertSchema(leadShares);
export const insertLeadShareMemberSchema = createInsertSchema(leadShareMembers);
export const insertLeadXrayStatsSchema = createInsertSchema(leadXrayStats);
export const insertVendorReviewSchema = createInsertSchema(vendorReviews);
export const insertAgentStreakSchema = createInsertSchema(agentStreaks);
export const insertDailyChallengeSchema = createInsertSchema(dailyChallenges);
export const insertAgentAchievementSchema = createInsertSchema(agentAchievements);
export const insertWinsFeedPostSchema = createInsertSchema(winsFeedPosts);
export const insertVideoCallSessionSchema = createInsertSchema(videoCallSessions);
export const insertVoiceCloneSchema = createInsertSchema(voiceClones);
export const insertLeadAudioTourSchema = createInsertSchema(leadAudioTours);
export const insertSentimentSnapshotSchema = createInsertSchema(sentimentSnapshots);
export const insertQuoteWidgetSchema = createInsertSchema(quoteWidgets);
export const insertLandingPageSchema = createInsertSchema(landingPages);
export const insertProvisionedPhoneNumberSchema = createInsertSchema(provisionedPhoneNumbers);
export const insertMediscoreApiKeySchema = createInsertSchema(mediscoreApiKeys);
export const insertMediscoreApiUsageSchema = createInsertSchema(mediscoreApiUsage);
export const insertDataProductSchema = createInsertSchema(dataProducts);
export const insertDataProductSubscriptionSchema = createInsertSchema(dataProductSubscriptions);
export const insertWebinarSchema = createInsertSchema(webinars);
export const insertWebinarRegistrationSchema = createInsertSchema(webinarRegistrations);
export const insertNewsBriefSchema = createInsertSchema(newsBriefs);
export const insertAffiliateSchema = createInsertSchema(affiliates);
export const insertAffiliatePayoutSchema = createInsertSchema(affiliatePayouts);
export const insertMentorMatchSchema = createInsertSchema(mentorMatches);
export const insertAgentCertificationSchema = createInsertSchema(agentCertifications);
export const insertPublicWebhookSchema = createInsertSchema(publicWebhooks);
export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveries);
export const insertSdkInstallMetricSchema = createInsertSchema(sdkInstallMetrics);
export const insertObituarySignalSchema = createInsertSchema(obituarySignals);
export const insertLeadOptionSchema = createInsertSchema(leadOptions);
export const insertLeadOptionContractSchema = createInsertSchema(leadOptionContracts);
export const insertDirectMailOrderSchema = createInsertSchema(directMailOrders);
export const insertCarrierDirectPipelineSchema = createInsertSchema(carrierDirectPipelines);
export const insertLanguagePackSchema = createInsertSchema(languagePacks);

// Durable, versioned MediScore calibrated weights. The calibration job appends
// a new row each run; the app loads the latest at boot so learned weights
// survive restarts and are shared across instances (replacing the in-memory-only
// holder as the source of truth).
export const mediscoreWeights = pgTable("mediscore_weights", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  weights: jsonb("weights").notNull(), // Record<signalKey, number>
  sampleSize: integer("sample_size").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  baseRate: decimal("base_rate", { precision: 6, scale: 5 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mediscore_weights_created").on(table.createdAt),
]);

export type MediscoreWeightsRow = typeof mediscoreWeights.$inferSelect;
export type InsertMediscoreWeights = typeof mediscoreWeights.$inferInsert;
export const insertMediscoreWeightsSchema = createInsertSchema(mediscoreWeights);
