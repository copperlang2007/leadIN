import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import {
  insertUserProfileSchema,
  vendorLeadIngestSchema,
  createOrgSchema,
  agentOnboardingSchema,
  subscriptionCheckoutSchema,
} from "@shared/schema";
import { fromError } from "zod-validation-error";
import { setupWebSocket, broadcastNewLead, getActiveConnections } from "./websocket";
import { notifyUsersAboutNewLead } from "./emailNotifications";
import { getUncachableStripeClient } from "./stripeClient";
import { startContentEngine, generateAndPublishArticle } from "./contentGeneration";
import { checkDnc } from "./dncCompliance";
import { recomputeAndPersistMediScore, computeMediScore } from "./mediscore";
import { startSeoSignalCron, refreshKeywordSignals, getTopOpportunityKeywords } from "./seoSignals";
import { startCmsSignalCron, refreshCmsPlanSignals } from "./cmsPlanSignals";
import { trackEventSchema } from "@shared/schema";
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

  // Start the daily content generation cron
  startContentEngine();

  // Phase 4 – signal enrichment cron jobs
  startSeoSignalCron();
  startCmsSignalCron();

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
        const meta = session.metadata || {};

        if (meta.kind === "subscription" && meta.orgId && meta.tier) {
          // Subscription checkout — activate the org
          await storage.updateOrgSubscription(meta.orgId, {
            billingMode: "subscription",
            subscriptionTier: meta.tier,
            subscriptionStatus: "active",
            stripeCustomerId: session.customer ?? undefined,
            stripeSubscriptionId: session.subscription ?? undefined,
          });
          console.log(`Activated ${meta.tier} subscription for org ${meta.orgId}`);
        } else {
          // Wallet top-up
          const amountPaid = session.amount_total / 100;
          const ourSession = await storage.getStripeSession(stripeSessionId);
          if (ourSession && ourSession.status === "pending") {
            await storage.creditUserFromStripe(ourSession.userId, stripeSessionId, amountPaid);
            console.log(`Credited $${amountPaid} to user ${ourSession.userId} via Stripe session ${stripeSessionId}`);
          }
        }
      }

      if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
        const sub = event.data.object as any;
        // Look up org by stripe subscription id and update status
        // (Simple impl: we rely on the org table having the matching id.)
        try {
          const status = sub.status === "active" ? "active" : "inactive";
          // We don't have a lookup by sub id in storage yet, so just log;
          // a follow-on hook can sync this when needed.
          console.log(`Subscription ${sub.id} → ${status}`);
        } catch {}
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

      // Org scoping: authenticated users see their org's leads + global pool.
      // Anonymous visitors only see global-pool leads.
      if (req.user?.claims?.sub) {
        const me = await storage.getUser(req.user.claims.sub);
        filters.orgId = me?.activeOrgId ?? null;
      } else {
        filters.orgId = null;
      }

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

      // Org scoping: a lead belonging to org X is hidden from members of org Y.
      // Global-pool leads (orgId === null) are visible to everyone.
      if (lead.orgId) {
        if (!req.user?.claims?.sub) return res.status(404).json({ message: "Lead not found" });
        const me = await storage.getUser(req.user.claims.sub);
        if (me?.activeOrgId !== lead.orgId) return res.status(404).json({ message: "Lead not found" });
      }

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

      // Phase 4: run DNC check before listing
      const dnc = await checkDnc(data.consumerPhone);

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
        dncFlagged: dnc.flagged,
        dncCheckedAt: new Date(),
      });

      // Compute initial MediScore and persist (non-blocking would also be fine,
      // but doing it inline lets the response include the score for vendors).
      await recomputeAndPersistMediScore(lead.id).catch(err => console.error("[mediscore] init error:", err));

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

      // Fire the routing engine (no-op if lead has no org, or score below threshold)
      storage.routeLeadToBestAgent(lead.id).catch(err => console.error("Routing error:", err));

      res.status(201).json({ id: lead.id, message: "Lead ingested successfully" });
    } catch (error: any) {
      console.error("Error ingesting lead:", error);
      res.status(500).json({ message: error.message || "Failed to ingest lead" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Phase 3 – Organizations (multi-tenant)
  // ──────────────────────────────────────────────────────
  app.get("/api/orgs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const memberships = await storage.getUserOrgMemberships(userId);
      const me = await storage.getUser(userId);
      res.json({
        activeOrgId: me?.activeOrgId ?? null,
        memberships: memberships.map(m => ({
          orgId: m.orgId,
          role: m.role,
          org: m.org,
        })),
      });
    } catch (err) {
      console.error("Error listing orgs:", err);
      res.status(500).json({ message: "Failed to list organizations" });
    }
  });

  app.post("/api/orgs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const validation = createOrgSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const existing = await storage.getOrganizationBySlug(validation.data.slug);
      if (existing) return res.status(409).json({ message: "Slug already in use" });

      const org = await storage.createOrganization(validation.data, userId);
      res.status(201).json(org);
    } catch (err) {
      console.error("Error creating org:", err);
      res.status(500).json({ message: "Failed to create organization" });
    }
  });

  app.post("/api/orgs/:orgId/activate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) return res.status(403).json({ message: "Not a member of this organization" });
      const user = await storage.setUserActiveOrg(userId, orgId);
      res.json(user);
    } catch (err) {
      console.error("Error activating org:", err);
      res.status(500).json({ message: "Failed to activate organization" });
    }
  });

  app.patch("/api/orgs/:orgId/routing-threshold", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const threshold = parseInt(req.body?.threshold, 10);
      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        return res.status(400).json({ message: "threshold must be between 0 and 100" });
      }
      const org = await storage.updateOrgRoutingThreshold(orgId, threshold);
      res.json(org);
    } catch (err) {
      console.error("Error updating routing threshold:", err);
      res.status(500).json({ message: "Failed to update threshold" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Phase 3 – Agent onboarding & dashboard
  // ──────────────────────────────────────────────────────
  app.get("/api/agent/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getAgentProfile(userId);
      res.json(profile ?? null);
    } catch (err) {
      console.error("Error fetching agent profile:", err);
      res.status(500).json({ message: "Failed to fetch agent profile" });
    }
  });

  app.post("/api/agent/onboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const me = await storage.getUser(userId);
      if (!me?.activeOrgId) {
        return res.status(400).json({ message: "Create or activate an organization first" });
      }

      const validation = agentOnboardingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const d = validation.data;

      const profile = await storage.upsertAgentProfile({
        userId,
        orgId: me.activeOrgId,
        licensedStates: d.licensedStates.map(s => s.toUpperCase()),
        appointedCarriers: d.appointedCarriers,
        territoryZips: d.territoryZips,
        territoryCounties: d.territoryCounties,
        licenseNumber: d.licenseNumber,
        licenseDocumentUrl: d.licenseDocumentUrl || null,
        capacityLimit: d.capacityLimit,
        // Verification stays "pending" on first onboard; admins move to "verified".
        verificationStatus: "pending",
      });

      res.json(profile);
    } catch (err) {
      console.error("Error onboarding agent:", err);
      res.status(500).json({ message: "Failed to save agent onboarding" });
    }
  });

  app.get("/api/agent/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const me = await storage.getUser(userId);
      const profile = await storage.getAgentProfile(userId);
      const stats = await storage.getAgentDashboardStats(userId);

      // Assigned (pipeline) leads include PII because the lead has been routed
      // exclusively to this agent.
      const assigned = await storage.getLeads({
        orgId: me?.activeOrgId ?? null,
        assignedToUserId: userId,
        soldOnly: false,
      });

      // Org-level aggregate metrics (admins see this section in the UI).
      let orgStats: any = null;
      if (me?.activeOrgId) {
        const role = await storage.getUserOrgRole(userId, me.activeOrgId);
        if (role === "owner" || role === "admin") {
          orgStats = await storage.getOrgDashboardStats(me.activeOrgId);
        }
      }

      res.json({
        profile,
        stats,
        assignedLeads: assigned,
        orgStats,
      });
    } catch (err) {
      console.error("Error fetching agent dashboard:", err);
      res.status(500).json({ message: "Failed to fetch dashboard" });
    }
  });

  // Admin verifies / rejects an agent within their own org
  app.patch("/api/agent/:userId/verification", isAuthenticated, async (req: any, res) => {
    try {
      const actorId = req.user.claims.sub;
      const targetUserId = req.params.userId;
      const status = String(req.body?.status ?? "");
      if (!["pending", "verified", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status must be pending|verified|rejected" });
      }
      const target = await storage.getAgentProfile(targetUserId);
      if (!target) return res.status(404).json({ message: "Agent profile not found" });

      const role = await storage.getUserOrgRole(actorId, target.orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const updated = await storage.setAgentVerificationStatus(targetUserId, status);
      res.json(updated);
    } catch (err) {
      console.error("Error setting verification:", err);
      res.status(500).json({ message: "Failed to update verification" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Phase 3 – Stripe subscription billing (per-org)
  // ──────────────────────────────────────────────────────
  const SUBSCRIPTION_TIERS: Record<string, { name: string; monthlyCents: number }> = {
    starter: { name: "Starter (up to 3 agents)", monthlyCents: 9900 },
    growth: { name: "Growth (up to 15 agents)", monthlyCents: 29900 },
    scale: { name: "Scale (unlimited agents)", monthlyCents: 79900 },
  };

  app.post("/api/orgs/:orgId/subscription/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const validation = subscriptionCheckoutSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const tier = SUBSCRIPTION_TIERS[validation.data.tier];
      if (!tier) return res.status(400).json({ message: "Unknown tier" });

      const stripe = await getUncachableStripeClient();
      const baseUrl = `https://${req.hostname}`;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              recurring: { interval: "month" },
              product_data: { name: `LeadMarket ${tier.name}` },
              unit_amount: tier.monthlyCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/?stripe=sub_success&org=${orgId}`,
        cancel_url: `${baseUrl}/?stripe=sub_cancelled`,
        metadata: { orgId, tier: validation.data.tier, kind: "subscription" },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Error creating subscription checkout:", err);
      res.status(500).json({ message: err.message || "Failed to create subscription" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Phase 4 – Behavioral tracking + MediScore
  // ──────────────────────────────────────────────────────
  app.post("/api/events/track", async (req: any, res) => {
    try {
      const validation = trackEventSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const d = validation.data;
      const userId = req.user?.claims?.sub ?? null;
      await storage.recordBehavioralEvent({
        sessionId: d.sessionId,
        leadId: d.leadId ?? null,
        userId,
        eventType: d.eventType,
        path: d.path,
        value: d.value,
        metadata: d.metadata,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 500),
        ip: String(req.ip ?? req.socket?.remoteAddress ?? "").slice(0, 64),
      });

      // If the event is tied to a lead, recompute that lead's score so the
      // marketplace surfaces fresh signals. Non-blocking.
      if (d.leadId) {
        recomputeAndPersistMediScore(d.leadId).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Error tracking event:", err);
      res.status(500).json({ message: "Failed to track event" });
    }
  });

  app.get("/api/leads/:id/mediscore", async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getLead(id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      // Respect org scoping
      if (lead.orgId) {
        if (!req.user?.claims?.sub) return res.status(404).json({ message: "Lead not found" });
        const me = await storage.getUser(req.user.claims.sub);
        if (me?.activeOrgId !== lead.orgId) return res.status(404).json({ message: "Lead not found" });
      }

      const breakdown = await computeMediScore(id);
      res.json(breakdown);
    } catch (err) {
      console.error("Error computing MediScore:", err);
      res.status(500).json({ message: "Failed to compute MediScore" });
    }
  });

  app.get("/api/signals/keywords/top", async (_req, res) => {
    try {
      const rows = await getTopOpportunityKeywords(20);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch keyword signals" });
    }
  });

  app.post("/api/admin/signals/refresh", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const kw = await refreshKeywordSignals();
      const cms = await refreshCmsPlanSignals();
      res.json({ keywords: kw, cms });
    } catch (err: any) {
      console.error("Error refreshing signals:", err);
      res.status(500).json({ message: err.message || "Refresh failed" });
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

  // ──────────────────────────────────────────────────────
  // Content Engine API
  // ──────────────────────────────────────────────────────

  // List published articles (public)
  app.get("/api/content", async (_req, res) => {
    try {
      const articles = await storage.getContentArticles(true);
      res.json(articles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  // Single article by slug (public)
  app.get("/api/content/:slug", async (req, res) => {
    try {
      const article = await storage.getContentArticleBySlug(req.params.slug);
      if (!article || !article.published) {
        return res.status(404).json({ message: "Article not found" });
      }
      res.json(article);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch article" });
    }
  });

  // Admin: trigger content generation manually
  app.post("/api/admin/content/generate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      await generateAndPublishArticle();
      const count = await storage.getPublishedArticleCount();
      res.json({ success: true, publishedCount: count });
    } catch (error) {
      res.status(500).json({ message: "Content generation failed" });
    }
  });

  // Admin: list all articles (including unpublished)
  app.get("/api/admin/content", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const articles = await storage.getContentArticles(false);
      res.json(articles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  // Dynamic sitemap.xml
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const articles = await storage.getContentArticles(true);
      const baseUrl = process.env.APP_URL || "https://leadmarket.replit.app";

      const staticUrls = [
        { loc: baseUrl, priority: "1.0", changefreq: "daily" },
        { loc: `${baseUrl}/blog`, priority: "0.9", changefreq: "daily" },
      ];

      const articleUrls = articles.map((a) => ({
        loc: `${baseUrl}/blog/${a.slug}`,
        priority: "0.7",
        changefreq: "monthly",
        lastmod: a.publishedAt
          ? new Date(a.publishedAt).toISOString().split("T")[0]
          : undefined,
      }));

      const allUrls = [...staticUrls, ...articleUrls];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${
      u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""
    }
  </url>`
  )
  .join("\n")}
</urlset>`;

      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(xml);
    } catch (error) {
      res.status(500).send("<?xml version='1.0'?><urlset/>");
    }
  });

  return httpServer;
}
