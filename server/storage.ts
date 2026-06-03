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
  organizations,
  orgMembers,
  agentProfiles,
  leadAssignments,
  keywordSignals,
  cmsPlanSignals,
  behavioralEvents,
  savedLists,
  savedListItems,
  vendorBalances,
  vendorPayouts,
  leadDisputes,
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
  type Organization,
  type InsertOrganization,
  type OrgMember,
  type AgentProfile,
  type InsertAgentProfile,
  type LeadAssignment,
  type InsertBehavioralEvent,
  type BehavioralEvent,
  type SavedList,
  type InsertSavedList,
  type VendorPayout,
  type LeadDispute,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, inArray, desc, sql, gte, lt, count, sum, isNull } from "drizzle-orm";
import crypto from "crypto";
import Decimal from "decimal.js";
import { rankCandidates, type AgentCandidate } from "./routing";
import { withTxAdvisoryLock } from "./lib/lock";
import { splitRevenue } from "./vendorPayouts";
import {
  addRefundToBalance,
  clampRefundCents,
  computeRefundSplit,
  planVendorDebit,
  priceStringToCents,
  type DisputeReason,
} from "./disputes";

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
  getVendorByApiKey(apiKey: string): Promise<(Vendor & { orgId: string | null }) | undefined>;
  createVendorApiKey(vendorId: number, orgId?: string | null): Promise<{ key: string; record: VendorApiKey }>;
  revokeVendorApiKey(keyId: number): Promise<void>;
  listVendorApiKeys(orgId: string): Promise<Array<{
    id: number;
    vendorId: number;
    vendorName: string | null;
    keyPrefix: string;
    active: boolean;
    createdAt: Date | null;
    revokedAt: Date | null;
  }>>;

  // Lead operations
  getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
    includeRemoved?: boolean;
    orgId?: string | null;
    assignedToUserId?: string;
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

  // ──────────────────────────────────────────────────────
  // Phase 3: organizations, agents, routing, subscriptions
  // ──────────────────────────────────────────────────────
  createOrganization(data: InsertOrganization, ownerUserId: string): Promise<Organization>;
  getOrganization(orgId: string): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  setUserActiveOrg(userId: string, orgId: string | null): Promise<User>;
  getUserOrgMemberships(userId: string): Promise<(OrgMember & { org: Organization })[]>;
  getUserOrgRole(userId: string, orgId: string): Promise<string | null>;
  updateOrgRoutingThreshold(orgId: string, threshold: number): Promise<Organization>;
  updateOrgSubscription(orgId: string, fields: Partial<InsertOrganization>): Promise<Organization>;
  getOrgByStripeSubscription(subscriptionId: string): Promise<Organization | undefined>;

  getAgentProfile(userId: string): Promise<AgentProfile | undefined>;
  upsertAgentProfile(data: InsertAgentProfile): Promise<AgentProfile>;
  setAgentVerificationStatus(userId: string, status: string): Promise<AgentProfile>;
  setAgentConversionRate(userId: string, rate: number): Promise<AgentProfile>;
  updateAgentCapacity(
    userId: string,
    fields: { capacityLimit?: number; acceptingLeads?: boolean },
  ): Promise<AgentProfile>;
  listOrgAgents(orgId: string): Promise<(AgentProfile & { user: User; openLeads: number })[]>;

  routeLeadToBestAgent(leadId: number): Promise<LeadAssignment | null>;
  setAssignmentStatus(assignmentId: number, agentUserId: string, status: "accepted" | "declined"): Promise<LeadAssignment | null>;
  getAgentAssignments(agentUserId: string): Promise<(LeadAssignment & { lead: Lead & { vendor: Vendor } })[]>;
  getAgentDashboardStats(agentUserId: string): Promise<{
    openLeads: number;
    purchasedLeads: number;
    totalSpent: string;
    averageCpl: string;
    estimatedCommissions: string;
    conversionRate: string;
  }>;
  getOrgDashboardStats(orgId: string): Promise<{
    totalLeads: number;
    assignedLeads: number;
    soldLeads: number;
    totalSpent: string;
    activeAgents: number;
  }>;

  // Phase 4 – signal enrichment
  setLeadDncStatus(leadId: number, flagged: boolean): Promise<void>;
  setLeadSessionId(leadId: number, sessionId: string): Promise<void>;
  recordBehavioralEvent(data: InsertBehavioralEvent): Promise<BehavioralEvent>;
  getEventCountsForSession(sessionId: string): Promise<{ total: number; byType: Record<string, number> }>;
  attachSessionToLeadIfMatch(sessionId: string, phone: string | undefined, email: string | undefined): Promise<number | null>;

  // ──────────────────────────────────────────────────────
  // Wave 2: vendor payouts (revenue share + sweep ledger)
  // ──────────────────────────────────────────────────────
  creditVendorOnSale(
    orderId: number,
    leadId: number,
    vendorId: number,
    salePriceCents: number,
  ): Promise<{ credited: boolean; vendorCents: number }>;
  getVendorBalances(): Promise<{ vendor: Vendor; pendingCents: number; paidCents: number }[]>;
  sweepVendorPayouts(thresholdCents?: number): Promise<{
    vendorsPaid: number;
    totalCentsSwept: number;
    entries: { vendorId: number; amountCents: number; payoutId: number }[];
  }>;
  getVendorPayoutLog(vendorId: number, limit?: number): Promise<VendorPayout[]>;

  // ──────────────────────────────────────────────────────
  // Wave 4: buyer-filed disputes + refunds
  // ──────────────────────────────────────────────────────
  createDispute(input: {
    orderId: number;
    buyerUserId: string;
    reason: DisputeReason;
    notes?: string;
  }): Promise<LeadDispute>;
  getDispute(id: number): Promise<LeadDispute | undefined>;
  getDisputeByOrderId(orderId: number): Promise<LeadDispute | undefined>;
  listDisputes(filters?: {
    status?: string;
    buyerUserId?: string;
    limit?: number;
  }): Promise<LeadDispute[]>;
  approveDispute(
    disputeId: number,
    resolverUserId: string,
    refundCents: number,
  ): Promise<LeadDispute>;
  denyDispute(disputeId: number, resolverUserId: string): Promise<LeadDispute>;
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
  async getVendorByApiKey(apiKey: string): Promise<(Vendor & { orgId: string | null }) | undefined> {
    const prefix = apiKey.substring(0, 8);
    const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

    // Use both prefix (indexed) and hash for the lookup — the prefix narrows
    // the candidate set so the hash comparison only runs on a tiny subset.
    const [result] = await db
      .select()
      .from(vendorApiKeys)
      .leftJoin(vendors, eq(vendorApiKeys.vendorId, vendors.id))
      .where(
        and(
          eq(vendorApiKeys.keyPrefix, prefix),
          eq(vendorApiKeys.keyHash, hash),
          eq(vendorApiKeys.active, true)
        )
      );

    if (!result?.vendors) return undefined;
    return { ...result.vendors, orgId: result.vendor_api_keys.orgId ?? null };
  }

  async createVendorApiKey(vendorId: number, orgId: string | null = null): Promise<{ key: string; record: VendorApiKey }> {
    const rawKey = `vk_${crypto.randomBytes(32).toString("hex")}`;
    const prefix = rawKey.substring(0, 8);
    const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

    const [record] = await db
      .insert(vendorApiKeys)
      .values({ vendorId, orgId, keyHash: hash, keyPrefix: prefix })
      .returning();

    return { key: rawKey, record };
  }

  async revokeVendorApiKey(keyId: number): Promise<void> {
    await db
      .update(vendorApiKeys)
      .set({ active: false, revokedAt: new Date() })
      .where(eq(vendorApiKeys.id, keyId));
  }

  async listVendorApiKeys(orgId: string): Promise<Array<{
    id: number;
    vendorId: number;
    vendorName: string | null;
    keyPrefix: string;
    active: boolean;
    createdAt: Date | null;
    revokedAt: Date | null;
  }>> {
    const rows = await db
      .select({
        id: vendorApiKeys.id,
        vendorId: vendorApiKeys.vendorId,
        vendorName: vendors.name,
        keyPrefix: vendorApiKeys.keyPrefix,
        active: vendorApiKeys.active,
        createdAt: vendorApiKeys.createdAt,
        revokedAt: vendorApiKeys.revokedAt,
      })
      .from(vendorApiKeys)
      .leftJoin(vendors, eq(vendorApiKeys.vendorId, vendors.id))
      .where(eq(vendorApiKeys.orgId, orgId))
      .orderBy(desc(vendorApiKeys.createdAt));
    return rows;
  }

  // Lead operations
  async getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
    includeRemoved?: boolean;
    orgId?: string | null;
    assignedToUserId?: string;
  }): Promise<(Lead & { vendor: Vendor })[]> {
    const conditions: any[] = [eq(leads.sold, filters?.soldOnly ?? false)];

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

    // Org scoping: when an orgId is provided, show only that org's leads OR
    // unowned (global / legacy) leads. This prevents cross-tenant leakage.
    if (filters?.orgId !== undefined) {
      if (filters.orgId === null) {
        conditions.push(isNull(leads.orgId));
      } else {
        conditions.push(or(eq(leads.orgId, filters.orgId), isNull(leads.orgId))!);
      }
    }

    if (filters?.assignedToUserId) {
      conditions.push(eq(leads.assignedToUserId, filters.assignedToUserId));
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

      // Money math uses Decimal to avoid float rounding drift on
      // long-running wallets. The DB column is `numeric` so the SQL update
      // is exact too — we pass the canonical string form.
      const leadPrice = new Decimal(lead.price);
      const userBalance = new Decimal(user.balance);

      if (userBalance.lessThan(leadPrice)) throw new Error("Insufficient balance");

      const newBalance = userBalance.minus(leadPrice).toFixed(2);
      await tx
        .update(users)
        .set({
          balance: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx
        .update(leads)
        .set({ sold: true, soldAt: new Date(), purchasedBy: userId })
        .where(eq(leads.id, leadId));

      const [order] = await tx
        .insert(orders)
        .values({ userId, leadId, orgId: lead.orgId ?? null, price: lead.price, status: "completed" })
        .returning();

      // Credit the vendor's pending balance with their revenue share.
      // Use Decimal -> cents to avoid float drift; floor to whole cents.
      const salePriceCents = new Decimal(lead.price).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      await this.creditVendorOnSaleTx(tx, order.id, lead.id, lead.vendorId, salePriceCents);

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

  // ──────────────────────────────────────────────────────
  // Phase 3: organizations & multi-tenancy
  // ──────────────────────────────────────────────────────
  async createOrganization(data: InsertOrganization, ownerUserId: string): Promise<Organization> {
    return await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values(data).returning();
      await tx.insert(orgMembers).values({
        orgId: org.id,
        userId: ownerUserId,
        role: "owner",
      });
      // Set as active org if user has none
      const [user] = await tx.select().from(users).where(eq(users.id, ownerUserId));
      if (user && !user.activeOrgId) {
        await tx.update(users).set({ activeOrgId: org.id, updatedAt: new Date() }).where(eq(users.id, ownerUserId));
      }
      return org;
    });
  }

  async getOrganization(orgId: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    return org;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  }

  async setUserActiveOrg(userId: string, orgId: string | null): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ activeOrgId: orgId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getUserOrgMemberships(userId: string): Promise<(OrgMember & { org: Organization })[]> {
    const rows = await db
      .select()
      .from(orgMembers)
      .leftJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.userId, userId));
    return rows.map(r => ({ ...r.org_members, org: r.organizations! }));
  }

  async getUserOrgRole(userId: string, orgId: string): Promise<string | null> {
    const [m] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)));
    return m?.role ?? null;
  }

  async updateOrgRoutingThreshold(orgId: string, threshold: number): Promise<Organization> {
    const [org] = await db
      .update(organizations)
      .set({ routingScoreThreshold: threshold, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();
    return org;
  }

  async updateOrgSubscription(orgId: string, fields: Partial<InsertOrganization>): Promise<Organization> {
    const [org] = await db
      .update(organizations)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();
    return org;
  }

  async getOrgByStripeSubscription(subscriptionId: string): Promise<Organization | undefined> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.stripeSubscriptionId, subscriptionId));
    return org;
  }

  // ──────────────────────────────────────────────────────
  // Agent profiles
  // ──────────────────────────────────────────────────────
  async getAgentProfile(userId: string): Promise<AgentProfile | undefined> {
    const [p] = await db.select().from(agentProfiles).where(eq(agentProfiles.userId, userId));
    return p;
  }

  async upsertAgentProfile(data: InsertAgentProfile): Promise<AgentProfile> {
    const [p] = await db
      .insert(agentProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: agentProfiles.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return p;
  }

  async setAgentVerificationStatus(userId: string, status: string): Promise<AgentProfile> {
    const [p] = await db
      .update(agentProfiles)
      .set({ verificationStatus: status, updatedAt: new Date() })
      .where(eq(agentProfiles.userId, userId))
      .returning();
    return p;
  }

  async setAgentConversionRate(userId: string, rate: number): Promise<AgentProfile> {
    const clamped = Math.max(0, Math.min(1, rate));
    const [p] = await db
      .update(agentProfiles)
      .set({ conversionRate: clamped.toFixed(4), updatedAt: new Date() })
      .where(eq(agentProfiles.userId, userId))
      .returning();
    return p;
  }

  async updateAgentCapacity(
    userId: string,
    fields: { capacityLimit?: number; acceptingLeads?: boolean },
  ): Promise<AgentProfile> {
    const patch: Partial<AgentProfile> = { updatedAt: new Date() };
    if (typeof fields.capacityLimit === "number") {
      if (!Number.isInteger(fields.capacityLimit) || fields.capacityLimit < 1 || fields.capacityLimit > 500) {
        throw new Error("capacityLimit must be an integer between 1 and 500");
      }
      patch.capacityLimit = fields.capacityLimit;
    }
    if (typeof fields.acceptingLeads === "boolean") {
      patch.acceptingLeads = fields.acceptingLeads;
    }
    const [p] = await db
      .update(agentProfiles)
      .set(patch)
      .where(eq(agentProfiles.userId, userId))
      .returning();
    if (!p) throw new Error("Agent profile not found");
    return p;
  }

  async listOrgAgents(orgId: string): Promise<(AgentProfile & { user: User; openLeads: number })[]> {
    const rows = await db
      .select()
      .from(agentProfiles)
      .leftJoin(users, eq(agentProfiles.userId, users.id))
      .where(eq(agentProfiles.orgId, orgId));

    const result: (AgentProfile & { user: User; openLeads: number })[] = [];
    for (const r of rows) {
      if (!r.users) continue;
      const [c] = await db
        .select({ count: count() })
        .from(leads)
        .where(
          and(
            eq(leads.assignedToUserId, r.users.id),
            eq(leads.sold, false),
            eq(leads.removed, false),
          ),
        );
      result.push({
        ...r.agent_profiles,
        user: r.users,
        openLeads: Number(c?.count ?? 0),
      });
    }
    return result;
  }

  // ──────────────────────────────────────────────────────
  // Lead routing engine
  // Ranks eligible agents and assigns the lead to the best match.
  // Returns the assignment record, or null if no agent qualifies.
  // ──────────────────────────────────────────────────────
  async routeLeadToBestAgent(leadId: number): Promise<LeadAssignment | null> {
    // Pre-check outside the transaction. These reads are advisory — the
    // authoritative checks happen inside the lock below. Keeping them here
    // is a cheap fast-path that avoids opening a tx for obvious no-ops.
    const [preLead] = await db.select().from(leads).where(eq(leads.id, leadId));
    if (!preLead || preLead.sold || preLead.removed) return null;
    if (preLead.assignedToUserId) return null; // already routed
    if (!preLead.orgId) return null; // global pool leads aren't auto-routed

    // Serialize assignment per-org. Two concurrent ingests in the same
    // org used to be able to read identical open-lead counts and both
    // pick the same agent, blowing through capacity. We now take a
    // transaction-scoped advisory lock keyed on the org so the entire
    // enumerate → rank → assign cycle runs sequentially per org.
    return await db.transaction(async (tx) => {
      return await withTxAdvisoryLock(tx, `route:${preLead.orgId}`, async () => {
        // Re-fetch the lead under FOR UPDATE inside the lock. State may
        // have changed between the pre-check and lock acquisition.
        const [lead] = await tx
          .select()
          .from(leads)
          .where(eq(leads.id, leadId))
          .for("update");
        if (!lead || lead.sold || lead.removed) return null;
        if (lead.assignedToUserId) return null;
        if (!lead.orgId) return null;

        const [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, lead.orgId));
        if (!org) return null;

        // Gate: orgs without active billing don't get auto-routing.
        if (
          org.billingMode !== "per_lead" &&
          org.subscriptionStatus !== "active"
        )
          return null;

        if ((lead.compatibilityScore ?? 0) < org.routingScoreThreshold)
          return null;

        // Find eligible agents for this org
        const candidates = await tx
          .select()
          .from(agentProfiles)
          .leftJoin(users, eq(agentProfiles.userId, users.id))
          .where(
            and(
              eq(agentProfiles.orgId, lead.orgId),
              eq(agentProfiles.acceptingLeads, true),
              eq(agentProfiles.verificationStatus, "verified"),
            ),
          );

        // Hydrate candidates with their open-lead count, then delegate to the
        // pure ranker. The N+1 here is intentional and bounded by org size.
        // Counts are read inside the same tx + advisory lock so concurrent
        // assigners for this org cannot observe a stale view.
        const hydrated: AgentCandidate[] = [];
        for (const row of candidates) {
          if (!row.users) continue;
          const ap = row.agent_profiles;
          const [openCountRow] = await tx
            .select({ count: count() })
            .from(leads)
            .where(
              and(
                eq(leads.assignedToUserId, row.users.id),
                eq(leads.sold, false),
                eq(leads.removed, false),
              ),
            );
          hydrated.push({
            userId: row.users.id,
            licensedStates: ap.licensedStates,
            appointedCarriers: ap.appointedCarriers,
            territoryZips: ap.territoryZips,
            territoryCounties: ap.territoryCounties,
            capacityLimit: ap.capacityLimit,
            openLeadCount: Number(openCountRow?.count ?? 0),
            conversionRate: parseFloat(ap.conversionRate ?? "0"),
            acceptingLeads: ap.acceptingLeads,
            verified: ap.verificationStatus === "verified",
          });
        }

        const best = rankCandidates(
          {
            state: lead.state,
            zipCode: lead.zipCode,
            source: lead.source,
            compatibilityScore: lead.compatibilityScore ?? 50,
          },
          hydrated,
        );

        if (!best) return null;

        await tx
          .update(leads)
          .set({ assignedToUserId: best.userId, assignedAt: new Date() })
          .where(eq(leads.id, leadId));

        const [assignment] = await tx
          .insert(leadAssignments)
          .values({
            leadId,
            orgId: lead.orgId!,
            agentUserId: best.userId,
            matchScore: best.score,
            reason: best.reasons.join(", "),
            status: "assigned",
          })
          .returning();

        return assignment;
      });
    });
  }

  async setAssignmentStatus(
    assignmentId: number,
    agentUserId: string,
    status: "accepted" | "declined",
  ): Promise<LeadAssignment | null> {
    return await db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(leadAssignments)
        .where(and(eq(leadAssignments.id, assignmentId), eq(leadAssignments.agentUserId, agentUserId)))
        .for("update");
      if (!a) return null;
      if (a.status !== "assigned") return a; // idempotent

      const [updated] = await tx
        .update(leadAssignments)
        .set({ status })
        .where(eq(leadAssignments.id, assignmentId))
        .returning();

      // On decline, free the lead so the routing engine can re-route it.
      if (status === "declined") {
        await tx
          .update(leads)
          .set({ assignedToUserId: null, assignedAt: null })
          .where(eq(leads.id, a.leadId));
      }
      return updated;
    });
  }

  async getAgentAssignments(agentUserId: string): Promise<(LeadAssignment & { lead: Lead & { vendor: Vendor } })[]> {
    const rows = await db
      .select()
      .from(leadAssignments)
      .leftJoin(leads, eq(leadAssignments.leadId, leads.id))
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(eq(leadAssignments.agentUserId, agentUserId))
      .orderBy(desc(leadAssignments.createdAt));

    return rows
      .filter(r => r.leads && r.vendors)
      .map(r => ({
        ...r.lead_assignments,
        lead: { ...r.leads!, vendor: r.vendors! },
      }));
  }

  async getAgentDashboardStats(agentUserId: string): Promise<{
    openLeads: number;
    purchasedLeads: number;
    totalSpent: string;
    averageCpl: string;
    estimatedCommissions: string;
    conversionRate: string;
  }> {
    const [openRow] = await db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.assignedToUserId, agentUserId),
          eq(leads.sold, false),
          eq(leads.removed, false),
        ),
      );

    const [purchasedRow] = await db
      .select({ count: count(), total: sum(orders.price) })
      .from(orders)
      .where(eq(orders.userId, agentUserId));

    const purchased = Number(purchasedRow?.count ?? 0);
    const totalSpent = parseFloat(purchasedRow?.total ?? "0");
    const averageCpl = purchased > 0 ? (totalSpent / purchased) : 0;

    const profile = await this.getAgentProfile(agentUserId);
    const conv = parseFloat(profile?.conversionRate ?? "0");

    // Rough commission estimate: $400 avg first-year commission per closed lead
    const estimated = purchased * conv * 400;

    return {
      openLeads: Number(openRow?.count ?? 0),
      purchasedLeads: purchased,
      totalSpent: totalSpent.toFixed(2),
      averageCpl: averageCpl.toFixed(2),
      estimatedCommissions: estimated.toFixed(2),
      conversionRate: (conv * 100).toFixed(1),
    };
  }

  async getOrgDashboardStats(orgId: string): Promise<{
    totalLeads: number;
    assignedLeads: number;
    soldLeads: number;
    totalSpent: string;
    activeAgents: number;
  }> {
    const [totalRow] = await db.select({ count: count() }).from(leads).where(eq(leads.orgId, orgId));
    const [assignedRow] = await db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), sql`${leads.assignedToUserId} IS NOT NULL`));
    const [soldRow] = await db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.sold, true)));
    const [spendRow] = await db
      .select({ total: sum(orders.price) })
      .from(orders)
      .where(eq(orders.orgId, orgId));
    const [agentRow] = await db
      .select({ count: count() })
      .from(agentProfiles)
      .where(and(eq(agentProfiles.orgId, orgId), eq(agentProfiles.acceptingLeads, true)));

    return {
      totalLeads: Number(totalRow?.count ?? 0),
      assignedLeads: Number(assignedRow?.count ?? 0),
      soldLeads: Number(soldRow?.count ?? 0),
      totalSpent: (parseFloat(spendRow?.total ?? "0")).toFixed(2),
      activeAgents: Number(agentRow?.count ?? 0),
    };
  }

  // ──────────────────────────────────────────────────────
  // Phase 4: signal enrichment
  // ──────────────────────────────────────────────────────
  async setLeadDncStatus(leadId: number, flagged: boolean): Promise<void> {
    await db
      .update(leads)
      .set({ dncFlagged: flagged, dncCheckedAt: new Date() })
      .where(eq(leads.id, leadId));
  }

  async setLeadSessionId(leadId: number, sessionId: string): Promise<void> {
    await db.update(leads).set({ sessionId }).where(eq(leads.id, leadId));
  }

  async recordBehavioralEvent(data: InsertBehavioralEvent): Promise<BehavioralEvent> {
    const [event] = await db.insert(behavioralEvents).values(data).returning();
    return event;
  }

  async getEventCountsForSession(sessionId: string): Promise<{ total: number; byType: Record<string, number> }> {
    const rows = await db
      .select({ type: behavioralEvents.eventType, c: count() })
      .from(behavioralEvents)
      .where(eq(behavioralEvents.sessionId, sessionId))
      .groupBy(behavioralEvents.eventType);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const n = Number(r.c ?? 0);
      byType[r.type] = n;
      total += n;
    }
    return { total, byType };
  }

  // ──────────────────────────────────────────────────────
  // Saved lists
  // ──────────────────────────────────────────────────────
  async createSavedList(data: InsertSavedList): Promise<SavedList> {
    const [list] = await db.insert(savedLists).values(data).returning();
    return list;
  }

  async listSavedLists(userId: string, orgId: string | null): Promise<(SavedList & { itemCount: number })[]> {
    const conditions: any[] = [];
    if (orgId) {
      conditions.push(or(eq(savedLists.orgId, orgId), eq(savedLists.ownerUserId, userId))!);
    } else {
      conditions.push(eq(savedLists.ownerUserId, userId));
    }
    const lists = await db.select().from(savedLists).where(and(...conditions)).orderBy(desc(savedLists.createdAt));

    const result: (SavedList & { itemCount: number })[] = [];
    for (const l of lists) {
      const [c] = await db.select({ count: count() }).from(savedListItems).where(eq(savedListItems.listId, l.id));
      result.push({ ...l, itemCount: Number(c?.count ?? 0) });
    }
    return result;
  }

  async getSavedListWithItems(listId: number, userId: string): Promise<{ list: SavedList; leads: (Lead & { vendor: Vendor })[] } | null> {
    const [list] = await db.select().from(savedLists).where(eq(savedLists.id, listId));
    if (!list) return null;
    if (list.ownerUserId !== userId && list.orgId) {
      // Check membership
      const [m] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, list.orgId), eq(orgMembers.userId, userId)));
      if (!m) return null;
    } else if (list.ownerUserId !== userId) {
      return null;
    }
    const items = await db
      .select()
      .from(savedListItems)
      .leftJoin(leads, eq(savedListItems.leadId, leads.id))
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(eq(savedListItems.listId, listId));
    const leadRows = items.filter(r => r.leads && r.vendors).map(r => ({ ...r.leads!, vendor: r.vendors! }));
    return { list, leads: leadRows };
  }

  async addLeadToSavedList(listId: number, leadId: number, userId: string): Promise<void> {
    const [list] = await db.select().from(savedLists).where(eq(savedLists.id, listId));
    if (!list || list.ownerUserId !== userId) throw new Error("List not found");
    await db.insert(savedListItems).values({ listId, leadId }).onConflictDoNothing();
    await db.update(savedLists).set({ updatedAt: new Date() }).where(eq(savedLists.id, listId));
  }

  async removeLeadFromSavedList(listId: number, leadId: number, userId: string): Promise<void> {
    const [list] = await db.select().from(savedLists).where(eq(savedLists.id, listId));
    if (!list || list.ownerUserId !== userId) throw new Error("List not found");
    await db.delete(savedListItems).where(and(eq(savedListItems.listId, listId), eq(savedListItems.leadId, leadId)));
  }

  async deleteSavedList(listId: number, userId: string): Promise<void> {
    await db.delete(savedLists).where(and(eq(savedLists.id, listId), eq(savedLists.ownerUserId, userId)));
  }

  async attachSessionToLeadIfMatch(
    sessionId: string,
    phone: string | undefined,
    email: string | undefined,
  ): Promise<number | null> {
    if (!phone && !email) return null;
    const conditions: any[] = [];
    if (phone) conditions.push(eq(leads.consumerPhone, phone));
    if (email) conditions.push(eq(leads.consumerEmail, email));
    if (conditions.length === 0) return null;
    const [match] = await db
      .select()
      .from(leads)
      .where(or(...conditions)!)
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (!match) return null;
    await db.update(leads).set({ sessionId }).where(eq(leads.id, match.id));
    return match.id;
  }

  // ──────────────────────────────────────────────────────
  // Wave 2: vendor payouts
  //
  // The lifecycle:
  //   1. Buyer purchases a lead → `creditVendorOnSale` inserts a `sale`
  //      payout row (positive) and bumps `vendor_balances.pendingCents`.
  //   2. Admin runs `sweepVendorPayouts(threshold)` → for every vendor
  //      at/over the threshold, insert a `payout` row (negative) that
  //      zeroes pending and moves the amount into paid.
  //   3. Future: refunds will use a similar `creditVendorOnSale`-shaped
  //      method with a negative amount and `kind=refund` to back out a
  //      vendor's pending balance.
  //
  // Idempotency: `creditVendorOnSale` is keyed by orderId — re-running
  // a purchase webhook (or our own retry) MUST NOT double-credit.
  // ──────────────────────────────────────────────────────

  /**
   * Internal: same as `creditVendorOnSale` but participates in the caller's
   * transaction. Used by `purchaseLead` so the credit commits atomically
   * with the order row.
   */
  // Drizzle's tx type from db.transaction varies per driver; typing as
  // `any` keeps callers (including the existing `purchaseLead`) ergonomic.
  async creditVendorOnSaleTx(
    tx: any,
    orderId: number,
    leadId: number,
    vendorId: number,
    salePriceCents: number,
  ): Promise<{ credited: boolean; vendorCents: number }> {
    // Idempotency guard — bail if we've already recorded a `sale` for this order.
    const [existing] = await tx
      .select({ id: vendorPayouts.id })
      .from(vendorPayouts)
      .where(and(eq(vendorPayouts.orderId, orderId), eq(vendorPayouts.kind, "sale")))
      .limit(1);
    if (existing) {
      return { credited: false, vendorCents: 0 };
    }

    const { vendorCents } = splitRevenue(salePriceCents);
    if (vendorCents <= 0) {
      return { credited: false, vendorCents: 0 };
    }

    await tx.insert(vendorPayouts).values({
      vendorId,
      amountCents: vendorCents,
      kind: "sale",
      orderId,
      leadId,
    });

    // Upsert the running balance. ON CONFLICT updates pendingCents in place.
    await tx
      .insert(vendorBalances)
      .values({ vendorId, pendingCents: vendorCents, paidCents: 0 })
      .onConflictDoUpdate({
        target: vendorBalances.vendorId,
        set: {
          pendingCents: sql`${vendorBalances.pendingCents} + ${vendorCents}`,
          updatedAt: new Date(),
        },
      });

    return { credited: true, vendorCents };
  }

  /**
   * Public wrapper for callers outside the purchase transaction (refund
   * processors, manual adjustments, etc). Opens its own short transaction
   * so the ledger row + balance update commit together.
   */
  async creditVendorOnSale(
    orderId: number,
    leadId: number,
    vendorId: number,
    salePriceCents: number,
  ): Promise<{ credited: boolean; vendorCents: number }> {
    return await db.transaction(async (tx) => {
      return await this.creditVendorOnSaleTx(tx, orderId, leadId, vendorId, salePriceCents);
    });
  }

  async getVendorBalances(): Promise<{ vendor: Vendor; pendingCents: number; paidCents: number }[]> {
    // LEFT JOIN from vendors so vendors with no activity still show 0/0.
    const rows = await db
      .select()
      .from(vendors)
      .leftJoin(vendorBalances, eq(vendorBalances.vendorId, vendors.id))
      .orderBy(desc(vendorBalances.pendingCents));
    return rows.map(r => ({
      vendor: r.vendors,
      pendingCents: r.vendor_balances?.pendingCents ?? 0,
      paidCents: r.vendor_balances?.paidCents ?? 0,
    }));
  }

  async sweepVendorPayouts(thresholdCents: number = 5000): Promise<{
    vendorsPaid: number;
    totalCentsSwept: number;
    entries: { vendorId: number; amountCents: number; payoutId: number }[];
  }> {
    return await db.transaction(async (tx) => {
      // Find every vendor at/over the threshold. SELECT … FOR UPDATE so
      // a concurrent sweep can't double-pay the same balance row.
      const eligible = await tx
        .select()
        .from(vendorBalances)
        .where(gte(vendorBalances.pendingCents, thresholdCents))
        .for("update");

      const entries: { vendorId: number; amountCents: number; payoutId: number }[] = [];
      let totalCentsSwept = 0;

      for (const bal of eligible) {
        const amount = bal.pendingCents;
        if (amount <= 0) continue;

        // TODO(stripe): when Stripe Connect is wired, replace this with a
        // real Transfer call and persist `stripeTransferId` here.
        const [payoutRow] = await tx
          .insert(vendorPayouts)
          .values({
            vendorId: bal.vendorId,
            amountCents: -amount, // debit from vendor side of the ledger
            kind: "payout",
            note: `Sweep at threshold ${thresholdCents}c`,
          })
          .returning();

        await tx
          .update(vendorBalances)
          .set({
            pendingCents: 0,
            paidCents: sql`${vendorBalances.paidCents} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(vendorBalances.id, bal.id));

        entries.push({ vendorId: bal.vendorId, amountCents: amount, payoutId: payoutRow.id });
        totalCentsSwept += amount;
      }

      return { vendorsPaid: entries.length, totalCentsSwept, entries };
    });
  }

  async getVendorPayoutLog(vendorId: number, limit: number = 50): Promise<VendorPayout[]> {
    return await db
      .select()
      .from(vendorPayouts)
      .where(eq(vendorPayouts.vendorId, vendorId))
      .orderBy(desc(vendorPayouts.createdAt))
      .limit(limit);
  }

  // ──────────────────────────────────────────────────────
  // Wave 4: buyer-filed disputes + refunds
  //
  // Lifecycle:
  //   1. Buyer files dispute on their order — `createDispute` inserts a row
  //      (idempotent on the `uniq_dispute_per_order` constraint).
  //   2. Admin approves → `approveDispute` credits the buyer wallet, debits
  //      the vendor (pending first, then paid), and writes one negative
  //      `vendor_payouts` row with kind="refund".
  //   3. Admin denies → `denyDispute` just marks the row.
  //
  // Money math goes through the pure helpers in `./disputes.ts` so the
  // arithmetic stays unit-testable without a live DB.
  // ──────────────────────────────────────────────────────

  async createDispute(input: {
    orderId: number;
    buyerUserId: string;
    reason: DisputeReason;
    notes?: string;
  }): Promise<LeadDispute> {
    return await db.transaction(async (tx) => {
      // Verify the order belongs to the buyer.
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId));
      if (!order) throw new Error("Order not found");
      if (order.userId !== input.buyerUserId) {
        throw new Error("Order does not belong to this buyer");
      }

      // Idempotency: if a dispute already exists for this order, return it
      // rather than throwing. The `uniq_dispute_per_order` constraint makes
      // the upsert safe even under a race.
      const [existing] = await tx
        .select()
        .from(leadDisputes)
        .where(eq(leadDisputes.orderId, input.orderId));
      if (existing) return existing;

      const [dispute] = await tx
        .insert(leadDisputes)
        .values({
          orderId: input.orderId,
          leadId: order.leadId,
          buyerUserId: input.buyerUserId,
          reason: input.reason,
          notes: input.notes ?? null,
          status: "open",
        })
        .onConflictDoNothing({ target: leadDisputes.orderId })
        .returning();

      if (dispute) return dispute;

      // Conflict race — read the row that won.
      const [winner] = await tx
        .select()
        .from(leadDisputes)
        .where(eq(leadDisputes.orderId, input.orderId));
      if (!winner) throw new Error("Failed to create or read dispute");
      return winner;
    });
  }

  async getDispute(id: number): Promise<LeadDispute | undefined> {
    const [d] = await db.select().from(leadDisputes).where(eq(leadDisputes.id, id));
    return d;
  }

  async getDisputeByOrderId(orderId: number): Promise<LeadDispute | undefined> {
    const [d] = await db.select().from(leadDisputes).where(eq(leadDisputes.orderId, orderId));
    return d;
  }

  async listDisputes(filters: {
    status?: string;
    buyerUserId?: string;
    limit?: number;
  } = {}): Promise<LeadDispute[]> {
    const conditions: any[] = [];
    if (filters.status) conditions.push(eq(leadDisputes.status, filters.status));
    if (filters.buyerUserId) conditions.push(eq(leadDisputes.buyerUserId, filters.buyerUserId));
    const limit = Math.max(1, Math.min(100, filters.limit ?? 100));
    const q = db.select().from(leadDisputes);
    const filtered = conditions.length === 0 ? q : q.where(and(...conditions));
    return await filtered.orderBy(desc(leadDisputes.createdAt)).limit(limit);
  }

  /**
   * Debit a vendor for a refund: pull from `pendingCents` first, then from
   * `paidCents` if pending is insufficient. Insert one `vendor_payouts` row
   * with the total debit so the ledger stays single-source-of-truth.
   *
   * Runs inside the caller's transaction.
   */
  async debitVendorForRefundTx(
    tx: any,
    vendorId: number,
    vendorDebitCents: number,
    orderId: number,
    leadId: number,
  ): Promise<void> {
    if (vendorDebitCents <= 0) return;

    // Lock the balance row (or create it at zero so the plan still works).
    const [bal] = await tx
      .select()
      .from(vendorBalances)
      .where(eq(vendorBalances.vendorId, vendorId))
      .for("update");

    const pending = bal?.pendingCents ?? 0;
    const paid = bal?.paidCents ?? 0;

    const plan = planVendorDebit(vendorDebitCents, pending, paid);

    if (bal) {
      await tx
        .update(vendorBalances)
        .set({
          pendingCents: plan.newPendingCents,
          paidCents: plan.newPaidCents,
          updatedAt: new Date(),
        })
        .where(eq(vendorBalances.id, bal.id));
    } else {
      // No prior activity — create a zero row and drive paid negative.
      await tx.insert(vendorBalances).values({
        vendorId,
        pendingCents: plan.newPendingCents,
        paidCents: plan.newPaidCents,
      });
    }

    // One negative ledger row per refund.
    await tx.insert(vendorPayouts).values({
      vendorId,
      amountCents: -vendorDebitCents,
      kind: "refund",
      orderId,
      leadId,
      note: `Refund debit: -${(vendorDebitCents / 100).toFixed(2)} (pending ${plan.pendingDelta}, paid ${plan.paidDelta})`,
    });
  }

  async approveDispute(
    disputeId: number,
    resolverUserId: string,
    refundCents: number,
  ): Promise<LeadDispute> {
    return await db.transaction(async (tx) => {
      const [dispute] = await tx
        .select()
        .from(leadDisputes)
        .where(eq(leadDisputes.id, disputeId))
        .for("update");
      if (!dispute) throw new Error("Dispute not found");
      if (dispute.status !== "open") {
        // Idempotent: re-approving an already-approved dispute returns the
        // existing row. Deny -> approve transition is rejected to keep the
        // ledger one-way.
        if (dispute.status === "approved") return dispute;
        throw new Error(`Dispute is ${dispute.status} and cannot be approved`);
      }

      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, dispute.orderId))
        .for("update");
      if (!order) throw new Error("Order not found");

      const [lead] = await tx
        .select()
        .from(leads)
        .where(eq(leads.id, dispute.leadId));
      if (!lead) throw new Error("Lead not found");

      // Clamp refund to the order price so we never refund more than was
      // paid. Caller may request more; we silently floor it.
      const orderPriceCents = priceStringToCents(order.price);
      const finalRefundCents = clampRefundCents(refundCents, orderPriceCents);

      // 1) Mark the dispute resolved.
      const [updated] = await tx
        .update(leadDisputes)
        .set({
          status: "approved",
          resolverUserId,
          resolvedAt: new Date(),
          refundCents: finalRefundCents,
        })
        .where(eq(leadDisputes.id, disputeId))
        .returning();

      // 2) Credit buyer's wallet — Decimal math, no float drift.
      // If buyerUserId is null (the buyer was GDPR-deleted), skip the wallet
      // credit; the vendor is still debited so the ledger stays consistent.
      if (finalRefundCents > 0) {
        const buyerUserId = dispute.buyerUserId;
        if (buyerUserId) {
          const [buyer] = await tx
            .select()
            .from(users)
            .where(eq(users.id, buyerUserId))
            .for("update");
          if (buyer) {
            const newBalance = addRefundToBalance(buyer.balance, finalRefundCents);
            await tx
              .update(users)
              .set({ balance: newBalance, updatedAt: new Date() })
              .where(eq(users.id, buyerUserId));
          }
        }

        // 3) Debit the vendor at rev-share fraction; remainder is platform write-off.
        const { vendorDebitCents } = computeRefundSplit(finalRefundCents);
        if (vendorDebitCents > 0) {
          await this.debitVendorForRefundTx(
            tx,
            lead.vendorId,
            vendorDebitCents,
            order.id,
            lead.id,
          );
        }
      }

      return updated;
    });
  }

  async denyDispute(disputeId: number, resolverUserId: string): Promise<LeadDispute> {
    return await db.transaction(async (tx) => {
      const [dispute] = await tx
        .select()
        .from(leadDisputes)
        .where(eq(leadDisputes.id, disputeId))
        .for("update");
      if (!dispute) throw new Error("Dispute not found");
      // Idempotent: re-denying a denied dispute returns it unchanged. Approved
      // disputes can't transition back to denied.
      if (dispute.status === "denied") return dispute;
      if (dispute.status === "approved") {
        throw new Error("Dispute is already approved and cannot be denied");
      }

      const [updated] = await tx
        .update(leadDisputes)
        .set({
          status: "denied",
          resolverUserId,
          resolvedAt: new Date(),
        })
        .where(eq(leadDisputes.id, disputeId))
        .returning();
      return updated;
    });
  }
}

export const storage = new DatabaseStorage();
