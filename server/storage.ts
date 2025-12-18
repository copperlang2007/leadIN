import {
  users,
  userProfiles,
  vendors,
  leads,
  orders,
  type User,
  type UpsertUser,
  type UserProfile,
  type InsertUserProfile,
  type Vendor,
  type Lead,
  type InsertLead,
  type Order,
  type InsertOrder,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

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
  
  // Lead operations
  getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
  }): Promise<(Lead & { vendor: Vendor })[]>;
  getLead(id: number): Promise<(Lead & { vendor: Vendor }) | undefined>;
  purchaseLead(leadId: number, userId: string): Promise<Order>;
  
  // Order operations
  getUserOrders(userId: string): Promise<(Order & { lead: Lead & { vendor: Vendor } })[]>;
  
  // Balance operations
  updateUserBalance(userId: string, amount: number): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
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

  // Lead operations
  async getLeads(filters?: {
    types?: string[];
    states?: string[];
    minPrice?: number;
    maxPrice?: number;
    soldOnly?: boolean;
  }): Promise<(Lead & { vendor: Vendor })[]> {
    let query = db
      .select()
      .from(leads)
      .leftJoin(vendors, eq(leads.vendorId, vendors.id))
      .where(eq(leads.sold, filters?.soldOnly ?? false))
      .orderBy(desc(leads.createdAt));

    const conditions = [eq(leads.sold, filters?.soldOnly ?? false)];

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

  async purchaseLead(leadId: number, userId: string): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Get the lead
      const [lead] = await tx
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .for("update");

      if (!lead) {
        throw new Error("Lead not found");
      }

      if (lead.sold) {
        throw new Error("Lead already sold");
      }

      // Get user
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        throw new Error("User not found");
      }

      const leadPrice = parseFloat(lead.price);
      const userBalance = parseFloat(user.balance);

      if (userBalance < leadPrice) {
        throw new Error("Insufficient balance");
      }

      // Deduct from user balance
      await tx
        .update(users)
        .set({
          balance: sql`${users.balance}::numeric - ${leadPrice}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Mark lead as sold
      await tx
        .update(leads)
        .set({
          sold: true,
          soldAt: new Date(),
          purchasedBy: userId,
        })
        .where(eq(leads.id, leadId));

      // Create order
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          leadId,
          price: lead.price,
          status: "completed",
        })
        .returning();

      return order;
    });
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
}

export const storage = new DatabaseStorage();
