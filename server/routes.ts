import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertUserProfileSchema, vendorLeadIngestSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { setupWebSocket, broadcastNewLead, getActiveConnections } from "./websocket";
import { notifyUsersAboutNewLead } from "./emailNotifications";
import { getUncachableStripeClient } from "./stripeClient";
import { z } from "zod";

function computeCompatibilityScore(
  leadState: string,
  leadType: string,
  licensedStates: string[],
  preferredTypes: string[]
): number {
  let score = 50;
  if (licensedStates.length > 0) {
    score = licensedStates.includes(leadState) ? 85 : 35;
  }
  if (preferredTypes.length > 0 && preferredTypes.includes(leadType)) {
    score = Math.min(100, score + 12);
  }
  return score;
}

function stripPII(lead: any) {
  const { consumerName, consumerPhone, consumerEmail, consumerAddress, ...rest } = lead;
  return {
    ...rest,
    consumerName: null,
    consumerPhone: null,
    consumerEmail: null,
    consumerAddress: null,
    piiGated: true,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  // Set up WebSocket server
  setupWebSocket(httpServer);

  // ──────────────────────────────────────────────────────
  // Stripe Webhook (raw body required – register BEFORE json middleware in index.ts)
  // ──────────────────────────────────────────────────────
  app.post("/api/stripe/webhook", async (req: any, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }

    try {
      const stripe = await getUncachableStripeClient();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        return res.status(500).json({ error: "Stripe webhook secret not configured" });
      }

      const rawBody = req.rawBody as Buffer;
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const stripeSessionId = session.id;
        const amountPaid = session.amount_total / 100; // convert cents to dollars

        // Find our session record
        const ourSession = await storage.getStripeSession(stripeSessionId);
        if (ourSession && ourSession.status === "pending") {
          await storage.creditUserFromStripe(ourSession.userId, stripeSessionId, amountPaid);
          console.log(`Credited $${amountPaid} to user ${ourSession.userId} via Stripe session ${stripeSessionId}`);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook error:", err.message);
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Auth Routes
  // ──────────────────────────────────────────────────────
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const profile = await storage.getUserProfile(userId);
      res.json({ ...user, profile: profile || null });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Profile Routes
  // ──────────────────────────────────────────────────────
  app.get("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile) return res.json({ userId, licensedStates: [], preferredTypes: [] });
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  async function handleProfileUpsert(req: any, res: any) {
    try {
      const userId = req.user.claims.sub;
      const validation = insertUserProfileSchema.safeParse({ ...req.body, userId });
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const profile = await storage.upsertUserProfile(validation.data);
      res.json(profile);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  }

  app.put("/api/profile", isAuthenticated, handleProfileUpsert);
  app.patch("/api/profile", isAuthenticated, handleProfileUpsert);

  // Notification preferences
  app.patch("/api/profile/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled must be a boolean" });
      }
      const user = await storage.updateNotificationPreference(userId, enabled);
      res.json(user);
    } catch (error) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ message: "Failed to update notification preference" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Leads Routes
  // ──────────────────────────────────────────────────────
  app.get("/api/leads", async (req: any, res) => {
    try {
      const { types, states, minPrice, maxPrice } = req.query;
      const filters: any = {};
      if (types) filters.types = Array.isArray(types) ? types : [types];
      if (states) filters.states = Array.isArray(states) ? states : [states];
      if (minPrice) filters.minPrice = parseFloat(minPrice as string);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice as string);

      const allLeads = await storage.getLeads(filters);

      let licensedStates: string[] = [];
      let preferredTypes: string[] = [];
      if (req.user?.claims?.sub) {
        const profile = await storage.getUserProfile(req.user.claims.sub);
        if (profile) {
          licensedStates = profile.licensedStates ?? [];
          preferredTypes = profile.preferredTypes ?? [];
        }
      }

      const enrichedLeads = allLeads.map((lead) => {
        const withScore = (licensedStates.length > 0 || preferredTypes.length > 0)
          ? { ...lead, compatibilityScore: computeCompatibilityScore(lead.state, lead.type, licensedStates, preferredTypes) }
          : lead;
        // Strip PII from listing
        return stripPII(withScore);
      });

      res.json(enrichedLeads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.get("/api/leads/:id", async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getLead(id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      let licensedStates: string[] = [];
      let preferredTypes: string[] = [];
      if (req.user?.claims?.sub) {
        const profile = await storage.getUserProfile(req.user.claims.sub);
        if (profile) {
          licensedStates = profile.licensedStates ?? [];
          preferredTypes = profile.preferredTypes ?? [];
        }
      }

      const withScore = (licensedStates.length > 0 || preferredTypes.length > 0)
        ? { ...lead, compatibilityScore: computeCompatibilityScore(lead.state, lead.type, licensedStates, preferredTypes) }
        : lead;

      // Strip PII - it stays gated until /reveal
      res.json(stripPII(withScore));
    } catch (error) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  // PII reveal endpoint - only for purchased leads
  app.get("/api/leads/:id/reveal", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);

      // Check if user has purchased this lead
      const order = await storage.getOrderForLead(userId, leadId);
      if (!order) {
        return res.status(403).json({ message: "Purchase this lead to reveal consumer information" });
      }

      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      // Return full lead with PII
      res.json(lead);
    } catch (error) {
      console.error("Error revealing lead PII:", error);
      res.status(500).json({ message: "Failed to reveal lead information" });
    }
  });

  app.post("/api/leads/:id/purchase", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);
      const order = await storage.purchaseLead(leadId, userId);
      res.json(order);
    } catch (error: any) {
      console.error("Error purchasing lead:", error);
      res.status(400).json({ message: error.message || "Failed to purchase lead" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Orders Routes
  // ──────────────────────────────────────────────────────
  app.get("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orders = await storage.getUserOrders(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // CSV export for orders
  app.get("/api/orders/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orders = await storage.getUserOrders(userId);

      const csvHeaders = [
        "Order ID",
        "Date",
        "Lead ID",
        "Lead Type",
        "State",
        "Zip Code",
        "Consumer Name",
        "Consumer Phone",
        "Consumer Email",
        "Consumer Address",
        "Price",
        "Exclusivity",
        "Source",
        "Consumer Age",
        "Gender",
        "Income",
        "Smoker",
        "Homeowner",
        "Has Condition",
        "Vendor",
        "Verified",
        "Status",
      ];

      const csvRows = orders.map(order => {
        const lead = order.lead;
        return [
          order.id,
          order.createdAt ? new Date(order.createdAt).toISOString() : "",
          lead.id,
          lead.type,
          lead.state,
          lead.zipCode,
          lead.consumerName || "",
          lead.consumerPhone || "",
          lead.consumerEmail || "",
          lead.consumerAddress || "",
          parseFloat(order.price).toFixed(2),
          lead.exclusivity,
          lead.source,
          lead.consumerAge,
          lead.gender || "",
          lead.income || "",
          lead.smoker ? "Yes" : "No",
          lead.homeowner ? "Yes" : "No",
          lead.hasCondition ? "Yes" : "No",
          lead.vendor?.name || "",
          lead.verified ? "Yes" : "No",
          order.status,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });

      const csv = [csvHeaders.join(","), ...csvRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="orders-${Date.now()}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting orders:", error);
      res.status(500).json({ message: "Failed to export orders" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Balance / Stripe Checkout Routes
  // ──────────────────────────────────────────────────────
  // Direct balance top-up is intentionally disabled.
  // All wallet funding must go through Stripe checkout to ensure financial integrity.
  app.post("/api/balance/add", (_req, res) => {
    res.status(410).json({ message: "This endpoint has been removed. Use POST /api/stripe/create-checkout to fund your wallet." });
  });

  app.post("/api/stripe/create-checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { amount } = req.body;

      if (!amount || amount < 10 || amount > 10000) {
        return res.status(400).json({ message: "Amount must be between $10 and $10,000" });
      }

      const stripe = await getUncachableStripeClient();

      const baseUrl = `https://${req.hostname}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "LeadMarket Wallet Deposit",
                description: `Add $${amount.toFixed(2)} to your LeadMarket wallet`,
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?stripe=cancelled`,
        metadata: { userId, amount: amount.toString() },
      });

      // Store the pending session
      await storage.createStripeSession({
        userId,
        stripeSessionId: session.id,
        amount: amount.toString(),
        status: "pending",
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Error creating Stripe checkout:", error);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });

  // Verify Stripe session status (for polling after success redirect)
  app.get("/api/stripe/session/:sessionId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { sessionId } = req.params;

      const session = await storage.getStripeSession(sessionId);
      if (!session || session.userId !== userId) {
        return res.status(404).json({ message: "Session not found" });
      }

      res.json({ status: session.status, amount: session.amount });
    } catch (error) {
      console.error("Error fetching Stripe session:", error);
      res.status(500).json({ message: "Failed to fetch session" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Vendor Ingestion API
  // ──────────────────────────────────────────────────────
  app.post("/api/v1/leads/ingest", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"] as string;
      if (!apiKey) {
        return res.status(401).json({ message: "API key required (X-Api-Key header)" });
      }

      const vendor = await storage.getVendorByApiKey(apiKey);
      if (!vendor) {
        return res.status(401).json({ message: "Invalid or inactive API key" });
      }

      const validation = vendorLeadIngestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }

      const data = validation.data;

      // Duplicate check: same phone + type already available
      const isDuplicate = await storage.checkDuplicateLead(data.consumerPhone, data.type);
      if (isDuplicate) {
        return res.status(409).json({ message: "Duplicate lead: same phone and type already available" });
      }

      // Build provenance log
      const now = new Date();
      const provenance = [
        {
          date: now.toISOString(),
          action: "Lead Ingested via API",
          actor: `Vendor: ${vendor.name}`,
          icon: "check",
        },
        {
          date: new Date(now.getTime() + 1000).toISOString(),
          action: "Field Validation Passed",
          actor: "System",
          icon: "lock",
        },
        {
          date: new Date(now.getTime() + 2000).toISOString(),
          action: "Duplicate Check Cleared",
          actor: "System",
          icon: "eye",
        },
      ];

      const lead = await storage.createLead({
        vendorId: vendor.id,
        type: data.type,
        source: data.source,
        exclusivity: data.exclusivity,
        price: data.price.toString(),
        consumerAge: data.consumerAge,
        state: data.state.toUpperCase(),
        zipCode: data.zipCode,
        consumerName: data.consumerName,
        consumerPhone: data.consumerPhone,
        consumerEmail: data.consumerEmail,
        consumerAddress: data.consumerAddress,
        income: data.income,
        hasCondition: data.hasCondition,
        homeowner: data.homeowner,
        gender: data.gender,
        smoker: data.smoker,
        verified: data.verified ?? false,
        provenance,
        sold: false,
      });

      // Broadcast new lead via WebSocket (non-PII data only)
      broadcastNewLead({
        id: lead.id,
        type: lead.type,
        state: lead.state,
        zipCode: lead.zipCode,
        price: lead.price,
        exclusivity: lead.exclusivity,
        verified: lead.verified,
        vendorName: vendor.name,
        createdAt: lead.createdAt?.toISOString() ?? null,
      });

      // Send email notifications asynchronously
      notifyUsersAboutNewLead({
        id: lead.id,
        type: lead.type,
        state: lead.state,
        price: lead.price,
        exclusivity: lead.exclusivity,
        vendorName: vendor.name,
      }).catch(err => console.error("Notification error:", err));

      res.status(201).json({ id: lead.id, message: "Lead ingested successfully" });
    } catch (error: any) {
      console.error("Error ingesting lead:", error);
      res.status(500).json({ message: error.message || "Failed to ingest lead" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Admin Routes
  // ──────────────────────────────────────────────────────

  function isAdmin(req: any, res: any, next: any) {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // We'll check role from DB in each handler for security
    next();
  }

  app.get("/api/admin/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const stats = await storage.getPlatformStats();
      res.json({
        ...stats,
        activeWebSocketConnections: getActiveConnections(),
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/admin/leads", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allLeads = await storage.getAllLeadsAdmin();
      res.json(allLeads);
    } catch (error) {
      console.error("Error fetching admin leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.patch("/api/admin/leads/:id/flag", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const leadId = parseInt(req.params.id);
      const { flagged } = req.body;
      const lead = await storage.flagLead(leadId, flagged ?? true);
      res.json(lead);
    } catch (error) {
      console.error("Error flagging lead:", error);
      res.status(500).json({ message: "Failed to flag lead" });
    }
  });

  app.delete("/api/admin/leads/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const leadId = parseInt(req.params.id);
      const lead = await storage.removeLead(leadId);
      res.json(lead);
    } catch (error) {
      console.error("Error removing lead:", error);
      res.status(500).json({ message: "Failed to remove lead" });
    }
  });

  // Platform status metrics (real-time ingestion stats)
  app.get("/api/admin/platform-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const stats = await storage.getPlatformStats();
      const activeWs = getActiveConnections();

      // Compute ingestion throughput and verification pass rate
      const ingestionStats = await storage.getIngestionStats();

      res.json({
        totalLeads: stats.totalLeads,
        totalRevenue: stats.totalRevenue,
        soldLeads: stats.soldLeads,
        availableLeads: stats.availableLeads,
        liquidity: stats.totalLeads > 0
          ? Math.round((stats.availableLeads / stats.totalLeads) * 100)
          : 0,
        activeWebSocketConnections: activeWs,
        topVendors: stats.topVendors,
        ingestedToday: ingestionStats.ingestedToday,
        verificationPassRate: ingestionStats.verificationPassRate,
      });
    } catch (error) {
      console.error("Error fetching platform status:", error);
      res.status(500).json({ message: "Failed to fetch platform status" });
    }
  });

  // One-time admin seeding: only works when zero admins exist in the platform
  app.post("/api/admin/seed-admin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Gate: refuse if any admin already exists
      const adminCount = await storage.countAdminUsers();
      if (adminCount > 0) {
        return res.status(403).json({ message: "An admin already exists. This endpoint is disabled." });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updatedUser = await storage.setUserRole(userId, "admin");
      res.json({ message: "Admin role assigned", user: updatedUser });
    } catch (error) {
      console.error("Error seeding admin:", error);
      res.status(500).json({ message: "Failed to seed admin" });
    }
  });

  // Broadcast recent leads (for seed data or newly ingested leads not yet broadcast)
  // Only admins can trigger this. Broadcasts up to the last 20 unsold leads.
  app.post("/api/admin/broadcast-recent-leads", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const recentLeads = await storage.getLeads({ soldOnly: false });
      const toBroadcast = recentLeads.slice(0, 20);
      for (const lead of toBroadcast) {
        broadcastNewLead({
          id: lead.id,
          type: lead.type,
          state: lead.state,
          zipCode: lead.zipCode,
          price: lead.price,
          exclusivity: lead.exclusivity,
          verified: lead.verified,
          vendorName: lead.vendor?.name ?? "Unknown",
          createdAt: lead.createdAt ? lead.createdAt.toISOString() : null,
        });
      }

      res.json({ message: `Broadcasted ${toBroadcast.length} leads` });
    } catch (error) {
      console.error("Error broadcasting leads:", error);
      res.status(500).json({ message: "Failed to broadcast leads" });
    }
  });

  // Check current user's admin status
  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json({ isAdmin: user?.role === "admin" });
    } catch (error) {
      res.status(500).json({ message: "Failed to check admin status" });
    }
  });

  return httpServer;
}
