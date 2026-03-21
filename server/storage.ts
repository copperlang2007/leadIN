import {
  users,
  userProfiles,
  vendors,
  vendorApiKeys,
  leads,
  orders,
  stripeCheckoutSessions,
  notifications,
  contentArticles,
  type User,
  type UpsertUser,
  type UserProfile,
  type InsertUserProfile,
  type Vendor,
  type VendorApiKey,
  type Lead,
  type InsertLead,
  type Order,
  type InsertOrder,
  type StripeCheckoutSession,
  type InsertStripeCheckoutSession,
  type ContentArticle,
  type InsertContentArticle,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, inArray, desc, sql, gte, lt, count, sum } from "drizzle-orm";
import crypto from "crypto";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // User profile operations
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile>;

  // Vendor operations
  getVendors(): Promise<Vendor[]>;
  getVendor(id: number): Promise<Vendor | undefined>;

  // Vendor API key operations
  getVendorByApiKey(apiKey: string): Promise<Vendor | undefined>;
  createVendorApiKey(vendorId: number): Promise<{ key: string; record: VendorApiKey }>;

  // Lead operations
  getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
    includeRemoved?: boolean;
  }): Promise<(Lead & { vendor: Vendor })[]>;
  getLead(id: number): Promise<(Lead & { vendor: Vendor }) | undefined>;
  createLead(data: InsertLead): Promise<Lead>;
  purchaseLead(leadId: number, userId: string): Promise<Order>;
  checkDuplicateLead(phone: string | undefined, type: string): Promise<boolean>;
  flagLead(id: number, flagged: boolean): Promise<Lead>;
  removeLead(id: number): Promise<Lead>;

  // Order operations
  getUserOrders(userId: string): Promise<(Order & { lead: Lead & { vendor: Vendor } })[]>;
  getOrderForLead(userId: string, leadId: number): Promise<Order | undefined>;

  // Balance operations
  updateUserBalance(userId: string, amount: number): Promise<User>;

  // Stripe operations
  createStripeSession(data: InsertStripeCheckoutSession): Promise<StripeCheckoutSession>;
  getStripeSession(stripeSessionId: string): Promise<StripeCheckoutSession | undefined>;
  updateStripeSessionStatus(stripeSessionId: string, status: string): Promise<StripeCheckoutSession>;
  creditUserFromStripe(userId: string, stripeSessionId: string, amount: number): Promise<User>;

  // Notification operations
  getMatchingUsersForLead(leadType: string, leadState: string): Promise<User[]>;
  recordNotification(userId: string, leadId: number): Promise<void>;
  hasNotification(userId: string, leadId: number): Promise<boolean>;

  // Admin operations
  countAdminUsers(): Promise<number>;
  getPlatformStats(): Promise<{
    totalLeads: number;
    totalRevenue: string;
    soldLeads: number;
    availableLeads: number;
    topVendors: { vendorId: number; name: string; leadCount: number }[];
  }>;
  getIngestionStats(): Promise<{
    ingestedToday: number;
    verificationPassRate: number;
  }>;
  getAllLeadsAdmin(): Promise<(Lead & { vendor: Vendor })[]>;
  setUserRole(userId: string, role: string): Promise<User>;

  // Notification preferences
  updateNotificationPreference(userId: string, enabled: boolean): Promise<User>;

  // Content article operations
  getContentArticles(publishedOnly?: boolean): Promise<ContentArticle[]>;
  getContentArticleBySlug(slug: string): Promise<ContentArticle | undefined>;
  createContentArticle(data: InsertContentArticle): Promise<ContentArticle>;
  updateContentArticle(id: number, updates: Partial<InsertContentArticle>): Promise<ContentArticle>;
  getPublishedArticleCount(): Promise<number>;
  slugExists(slug: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // On first-ever registration, auto-assign admin role (guarded by countAdminUsers check)
    let roleOverride: string | undefined;
    if (userData.id) {
      const existingUser = await this.getUser(userData.id);
      if (!existingUser) {
        const adminCount = await this.countAdminUsers();
        if (adminCount === 0) {
          roleOverride = "admin";
        }
      }
    }

    const insertData = roleOverride ? { ...userData, role: roleOverride } : userData;
    const [user] = await db
      .insert(users)
      .values(insertData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // User profile operations
  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return profile;
  }

  async upsertUserProfile(profileData: InsertUserProfile): Promise<UserProfile> {
    const [profile] = await db
      .insert(userProfiles)
      .values(profileData)
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...profileData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return profile;
  }

  // Vendor operations
  async getVendors(): Promise<Vendor[]> {
    return await db.select().from(vendors);
  }

  async getVendor(id: number): Promise<Vendor | undefined> {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
    return vendor;
  }

  // Vendor API key operations
  async getVendorByApiKey(apiKey: string): Promise<Vendor | undefined> {
    const prefix = apiKey.substring(0, 8);
    const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

    const [result] = await db
      .select()
      .from(vendorApiKeys)
      .leftJoin(vendors, eq(vendorApiKeys.vendorId, vendors.id))
      .where(
        and(
          eq(vendorApiKeys.keyHash, hash),
          eq(vendorApiKeys.active, true)
        )
      );

    return result?.vendors ?? undefined;
  }

  async createVendorApiKey(vendorId: number): Promise<{ key: string; record: VendorApiKey }> {
    const rawKey = `vk_${crypto.randomBytes(32).toString("hex")}`;
    const prefix = rawKey.substring(0, 8);
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

    const [record] = await db
      .insert(vendorApiKeys)
      .values({ vendorId, keyHash: hash, keyPrefix: prefix })
      .returning();

    return { key: rawKey, record };
  }

  // Lead operations
  async getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
    includeRemoved?: boolean;
  }): Promise<(Lead & { vendor: Vendor })[]> {
    const conditions = [eq(leads.sold, filters?.soldOnly ?? false)];

    if (!filters?.includeRemoved) {
      conditions.push(eq(leads.removed, false));
    }

    if (filters?.types && filters.types.length > 0) {
      conditions.push(inArray(leads.type, filters.types));
    }

    if (filters?.states && filters.states.length > 0) {
      conditions.push(inArray(leads.state, filters.states));
    }

    if (filters?.minPrice !== undefined) {
      conditions.push(sql`${leads.price}::numeric >= ${filters.minPrice}`);
    }

    if (filters?.maxPrice !== undefined) {
      conditions.push(sql`${leads.price}::numeric <= ${filters.maxPrice}`);
    }

    const results = await db
      .select()
      .from(leads)
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));

    return results.map(row => ({
      ...row.leads,
      vendor: row.vendors!,
    }));
  }

  async getLead(id: number): Promise<(Lead & { vendor: Vendor }) | undefined> {
    const [result] = await db
      .select()
      .from(leads)
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(eq(leads.id, id));

    if (!result) return undefined;

    return {
      ...result.leads,
      vendor: result.vendors!,
    };
  }

  async createLead(data: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  }

  async purchaseLead(leadId: number, userId: string): Promise<Order> {
    return await db.transaction(async (tx) => {
      const [lead] = await tx
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .for("update");

      if (!lead) throw new Error("Lead not found");
      if (lead.sold) throw new Error("Lead already sold");
      if (lead.removed) throw new Error("Lead is no longer available");

      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) throw new Error("User not found");

      const leadPrice = parseFloat(lead.price);
      const userBalance = parseFloat(user.balance);

      if (userBalance < leadPrice) throw new Error("Insufficient balance");

      await tx
        .update(users)
        .set({
          balance: sql`${users.balance}::numeric - ${leadPrice}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx
        .update(leads)
        .set({ sold: true, soldAt: new Date(), purchasedBy: userId })
        .where(eq(leads.id, leadId));

      const [order] = await tx
        .insert(orders)
        .values({ userId, leadId, price: lead.price, status: "completed" })
        .returning();

      return order;
    });
  }

  async checkDuplicateLead(phone: string | undefined, type: string): Promise<boolean> {
    if (!phone) return false;
    const [existing] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.consumerPhone, phone),
          eq(leads.type, type),
          eq(leads.sold, false)
        )
      );
    return !!existing;
  }

  async flagLead(id: number, flagged: boolean): Promise<Lead> {
    const [lead] = await db
      .update(leads)
      .set({ flagged })
      .where(eq(leads.id, id))
      .returning();
    return lead;
  }

  async removeLead(id: number): Promise<Lead> {
    const [lead] = await db
      .update(leads)
      .set({ removed: true })
      .where(eq(leads.id, id))
      .returning();
    return lead;
  }

  // Order operations
  async getUserOrders(userId: string): Promise<(Order & { lead: Lead & { vendor: Vendor } })[]> {
    const results = await db
      .select()
      .from(orders)
      .leftJoin(leads, eq(orders.leadId, leads.id))
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));

    return results.map(row => ({
      ...row.orders,
      lead: {
        ...row.leads!,
        vendor: row.vendors!,
      },
    }));
  }

  async getOrderForLead(userId: string, leadId: number): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.leadId, leadId)
        )
      );
    return order;
  }

  // Balance operations
  async updateUserBalance(userId: string, amount: number): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        balance: sql`${users.balance}::numeric + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return user;
  }

  // Stripe operations
  async createStripeSession(data: InsertStripeCheckoutSession): Promise<StripeCheckoutSession> {
    const [session] = await db.insert(stripeCheckoutSessions).values(data).returning();
    return session;
  }

  async getStripeSession(stripeSessionId: string): Promise<StripeCheckoutSession | undefined> {
    const [session] = await db
      .select()
      .from(stripeCheckoutSessions)
      .where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId));
    return session;
  }

  async updateStripeSessionStatus(stripeSessionId: string, status: string): Promise<StripeCheckoutSession> {
    const [session] = await db
      .update(stripeCheckoutSessions)
      .set({ status })
      .where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId))
      .returning();
    return session;
  }

  async creditUserFromStripe(userId: string, stripeSessionId: string, amount: number): Promise<User> {
    return await db.transaction(async (tx) => {
      // Idempotency guard: only transition from 'pending' -> 'completed'.
      // If the session is already 'completed', this update returns 0 rows and we skip crediting.
      const [updated] = await tx
        .update(stripeCheckoutSessions)
        .set({ status: "completed" })
        .where(
          and(
            eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId),
            eq(stripeCheckoutSessions.status, "pending")
          )
        )
        .returning();

      if (!updated) {
        // Session already processed — return current user without double-crediting
        const [currentUser] = await tx.select().from(users).where(eq(users.id, userId));
        return currentUser;
      }

      // Credit user balance only when transitioning from pending -> completed
      const [user] = await tx
        .update(users)
        .set({
          balance: sql`${users.balance}::numeric + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      return user;
    });
  }

  // Notification operations
  async getMatchingUsersForLead(leadType: string, leadState: string): Promise<User[]> {
    const results = await db
      .select()
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(users.notificationsEnabled, true));

    return results
      .filter(row => {
        const profile = row.user_profiles;
        if (!profile) return false;
        const stateMatch = !profile.licensedStates?.length || profile.licensedStates.includes(leadState);
        const typeMatch = !profile.preferredTypes?.length || profile.preferredTypes.includes(leadType);
        return stateMatch && typeMatch;
      })
      .map(row => row.users);
  }

  async recordNotification(userId: string, leadId: number): Promise<void> {
    try {
      await db
        .insert(notifications)
        .values({ userId, leadId, type: "new_lead" })
        .onConflictDoNothing();
    } catch {
      // Ignore duplicate notification errors
    }
  }

  async hasNotification(userId: string, leadId: number): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.leadId, leadId),
          eq(notifications.type, "new_lead")
        )
      );
    return !!existing;
  }

  // Admin operations
  async getPlatformStats(): Promise<{
    totalLeads: number;
    totalRevenue: string;
    soldLeads: number;
    availableLeads: number;
    topVendors: { vendorId: number; name: string; leadCount: number }[];
  }> {
    const totalLeadsResult = await db.select({ count: count() }).from(leads);
    const soldLeadsResult = await db.select({ count: count() }).from(leads).where(eq(leads.sold, true));
    const availableLeadsResult = await db.select({ count: count() }).from(leads).where(and(eq(leads.sold, false), eq(leads.removed, false)));
    const revenueResult = await db.select({ total: sum(orders.price) }).from(orders);

    const topVendorsResult = await db
      .select({
        vendorId: leads.vendorId,
        name: vendors.name,
        leadCount: count(leads.id),
      })
      .from(leads)
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .groupBy(leads.vendorId, vendors.name)
      .orderBy(desc(count(leads.id)))
      .limit(5);

    return {
      totalLeads: totalLeadsResult[0]?.count || 0,
      totalRevenue: revenueResult[0]?.total || "0",
      soldLeads: soldLeadsResult[0]?.count || 0,
      availableLeads: availableLeadsResult[0]?.count || 0,
      topVendors: topVendorsResult.map(v => ({
        vendorId: v.vendorId,
        name: v.name || "Unknown",
        leadCount: Number(v.leadCount),
      })),
    };
  }

  async getAllLeadsAdmin(): Promise<(Lead & { vendor: Vendor })[]> {
    const results = await db
      .select()
      .from(leads)
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .orderBy(desc(leads.createdAt))
      .limit(500);

    return results.map(row => ({
      ...row.leads,
      vendor: row.vendors!,
    }));
  }

  async countAdminUsers(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, "admin"));
    return result?.count ?? 0;
  }

  async getIngestionStats(): Promise<{ ingestedToday: number; verificationPassRate: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count leads ingested today
    const [todayResult] = await db
      .select({ count: count() })
      .from(leads)
      .where(gte(leads.createdAt, today));

    const ingestedToday = todayResult?.count ?? 0;

    // Calculate verification pass rate: fraction of leads that are verified
    const [totalResult] = await db.select({ count: count() }).from(leads);
    const [verifiedResult] = await db
      .select({ count: count() })
      .from(leads)
      .where(eq(leads.verified, true));

    const total = totalResult?.count ?? 0;
    const verified = verifiedResult?.count ?? 0;
    const verificationPassRate = total > 0 ? Math.round((verified / total) * 100) : 0;

    return { ingestedToday, verificationPassRate };
  }

  async setUserRole(userId: string, role: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async updateNotificationPreference(userId: string, enabled: boolean): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ notificationsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Content article operations
  async getContentArticles(publishedOnly = true): Promise<ContentArticle[]> {
    const query = db
      .select()
      .from(contentArticles)
      .orderBy(desc(contentArticles.publishedAt));
    if (publishedOnly) {
      return db
        .select()
        .from(contentArticles)
        .where(eq(contentArticles.published, true))
        .orderBy(desc(contentArticles.publishedAt));
    }
    return query;
  }

  async getContentArticleBySlug(slug: string): Promise<ContentArticle | undefined> {
    const [article] = await db
      .select()
      .from(contentArticles)
      .where(eq(contentArticles.slug, slug));
    return article;
  }

  async createContentArticle(data: InsertContentArticle): Promise<ContentArticle> {
    const [article] = await db
      .insert(contentArticles)
      .values(data)
      .returning();
    return article;
  }

  async updateContentArticle(id: number, updates: Partial<InsertContentArticle>): Promise<ContentArticle> {
    const [article] = await db
      .update(contentArticles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contentArticles.id, id))
      .returning();
    return article;
  }

  async getPublishedArticleCount(): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(contentArticles)
      .where(eq(contentArticles.published, true));
    return result?.count ?? 0;
  }

  async slugExists(slug: string): Promise<boolean> {
    const [result] = await db
      .select({ id: contentArticles.id })
      .from(contentArticles)
      .where(eq(contentArticles.slug, slug));
    return !!result;
  }
}

export const storage = new DatabaseStorage();
