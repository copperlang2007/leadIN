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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leads = pgTable("leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
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
]);

export const orders = pgTable("orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_orders_user").on(table.userId),
  index("idx_orders_created").on(table.createdAt),
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
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
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

export const insertContentArticleSchema = createInsertSchema(contentArticles).omit({ id: true, createdAt: true, updatedAt: true });

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
