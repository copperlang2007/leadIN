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
import { setupWebSocket, broadcastNewLead, broadcastLeadAssignment, getActiveConnections } from "./websocket";
import { notifyUsersAboutNewLead } from "./emailNotifications";
import { getUncachableStripeClient } from "./stripeClient";
import { startContentEngine, generateAndPublishArticle } from "./contentGeneration";
import { checkDnc } from "./dncCompliance";
import { verifyTrustedFormCert } from "./trustedForm";
import { recomputeAndPersistMediScore, computeMediScore } from "./mediscore";
import { startSeoSignalCron, refreshKeywordSignals, getTopOpportunityKeywords } from "./seoSignals";
import { startCmsSignalCron, refreshCmsPlanSignals } from "./cmsPlanSignals";
import { startDncRecheckCron, runDncRecheck } from "./dncRecheck";
import { startEmailDigestCron, runDailyDigest } from "./emailDigest";
import { getFunnelSnapshot, getLeadAnalytics } from "./analytics";
import { trackEventSchema } from "@shared/schema";
import { takeToken, seenRecently, throttleFire } from "./rateLimit";
import { recordAudit, listAudit } from "./audit";
import { listVendorKeysHandler, revokeVendorKeyHandler } from "./vendorKeyRoutes";
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

// Gate: an org can use SaaS features when either on per_lead billing OR an
// active subscription. cancelled/past_due subscriptions are blocked.
async function requireActiveBilling(orgId: string): Promise<{ ok: boolean; reason?: string }> {
  const org = await storage.getOrganization(orgId);
  if (!org) return { ok: false, reason: "org not found" };
  if (org.billingMode === "per_lead") return { ok: true };
  if (org.subscriptionStatus === "active") return { ok: true };
  return { ok: false, reason: `subscription ${org.subscriptionStatus}` };
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
  startDncRecheckCron();
  startEmailDigestCron();

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
        try {
          const org = await storage.getOrgByStripeSubscription(sub.id);
          if (org) {
            const isCancelled = event.type === "customer.subscription.deleted" || sub.status === "canceled" || sub.status === "unpaid";
            const isActive = sub.status === "active" || sub.status === "trialing";
            await storage.updateOrgSubscription(org.id, {
              subscriptionStatus: isCancelled ? "cancelled" : isActive ? "active" : "past_due",
              ...(isCancelled ? { billingMode: "per_lead" as const } : {}),
            });
            console.log(`Org ${org.id} subscription ${sub.id} → ${sub.status}`);
          }
        } catch (e: any) {
          console.error("Subscription sync failed:", e?.message);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook error:", err.message);
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Health (unauthenticated, fast). Returns 503 when the DB is unreachable
  // so load balancers / uptime probes flip correctly. Don't include any
  // secrets or counts that an attacker could fingerprint.
  // ──────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    const start = Date.now();
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      const latencyMs = Date.now() - start;
      res.json({
        status: "ok",
        uptimeSec: Math.round(process.uptime()),
        dbLatencyMs: latencyMs,
        wsConnections: getActiveConnections(),
      });
    } catch (err: any) {
      res.status(503).json({
        status: "degraded",
        uptimeSec: Math.round(process.uptime()),
        error: "db_unreachable",
      });
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

      const includeDnc = String(req.query.includeDnc ?? "") === "true";
      const allLeads = await storage.getLeads(filters);
      const filtered = includeDnc ? allLeads : allLeads.filter(l => !l.dncFlagged);
      const finalLeads = filtered;

      let licensedStates: string[] = [];
      let preferredTypes: string[] = [];
      if (req.user?.claims?.sub) {
        const profile = await storage.getUserProfile(req.user.claims.sub);
        if (profile) {
          licensedStates = profile.licensedStates ?? [];
          preferredTypes = profile.preferredTypes ?? [];
        }
      }

      const enrichedLeads = finalLeads.map((lead) => {
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

      // Org scope: an order in org A must not unlock a lead from org B even
      // if a race / migration accidentally created such a row.
      if (lead.orgId) {
        const me = await storage.getUser(userId);
        if (me?.activeOrgId !== lead.orgId) {
          return res.status(403).json({ message: "Lead not available to your organization" });
        }
      }

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
      // 5 checkout creations per user per minute.
      if (!(await takeToken(`checkout:${userId}`, 5, 5 / 60))) {
        return res.status(429).json({ message: "Too many checkout attempts" });
      }
      const { amount } = req.body;

      if (!amount || amount < 10 || amount > 10000) {
        return res.status(400).json({ message: "Amount must be between $10 and $10,000" });
      }

      const stripe = await getUncachableStripeClient();

      // Prefer a trusted env-configured URL to avoid Host-header spoofing in
      // success/cancel redirects. Falls back to the request hostname only
      // when APP_URL is not set (dev / first-deploy).
      const baseUrl = process.env.APP_URL || `https://${req.hostname}`;
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

      // 600 leads / vendor / minute (10/sec sustained, 100/sec burst).
      if (!(await takeToken(`ingest:${vendor.id}`, 100, 10))) {
        return res.status(429).json({ message: "Vendor rate limit exceeded" });
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

      // Wave 2: verify TrustedForm cert (when supplied by the vendor).
      // If verification fails or no key is configured the lead is listed as
      // "vendor-claimed" rather than "verified".
      let tcpa: {
        tcpaVerifiedAt: Date | null;
        tcpaCertId: string | null;
        tcpaVerifiedSource: string | null;
      } = { tcpaVerifiedAt: null, tcpaCertId: null, tcpaVerifiedSource: null };
      if (data.trustedFormCertUrl) {
        const result = await verifyTrustedFormCert(data.trustedFormCertUrl);
        if (result.ok && result.certId) {
          tcpa = {
            tcpaVerifiedAt: new Date(),
            tcpaCertId: result.certId,
            tcpaVerifiedSource: "trustedform",
          };
        }
      }

      const lead = await storage.createLead({
        vendorId: vendor.id,
        // Phase 3: route the lead to the org tied to the API key (if any)
        orgId: vendor.orgId ?? null,
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
        ...tcpa,
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
      storage.routeLeadToBestAgent(lead.id)
        .then(assignment => {
          if (assignment) {
            broadcastLeadAssignment({
              agentUserId: assignment.agentUserId,
              leadId: assignment.leadId,
              matchScore: assignment.matchScore,
            });
          }
        })
        .catch(err => console.error("Routing error:", err));

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

  // List vendors so the org-admin UI can pick one when minting a key.
  app.get("/api/vendors", isAuthenticated, async (_req, res) => {
    try {
      const vendors = await storage.getVendors();
      res.json(vendors);
    } catch (err) {
      console.error("Error listing vendors:", err);
      res.status(500).json({ message: "Failed to list vendors" });
    }
  });

  // Mint a vendor API key bound to a vendor and (optionally) to the caller's
  // active org. Org owners/admins only. Returns the raw key ONCE.
  app.post("/api/orgs/:orgId/vendor-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const billing = await requireActiveBilling(orgId);
      if (!billing.ok) {
        return res.status(402).json({ message: `Billing inactive: ${billing.reason}` });
      }
      const vendorId = parseInt(req.body?.vendorId, 10);
      if (!Number.isFinite(vendorId)) {
        return res.status(400).json({ message: "vendorId is required" });
      }
      const { key, record } = await storage.createVendorApiKey(vendorId, orgId);
      recordAudit({
        actorUserId: userId,
        orgId,
        action: "vendor_key.mint",
        targetKind: "vendor",
        targetId: String(vendorId),
        metadata: { keyPrefix: record.keyPrefix },
      }).catch(err => console.error("[audit] failed:", err));
      res.status(201).json({ apiKey: key, keyId: record.id, keyPrefix: record.keyPrefix });
    } catch (err) {
      console.error("Error creating vendor API key:", err);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // List vendor API keys bound to this org. Owner/admin only.
  app.get("/api/orgs/:orgId/vendor-keys", isAuthenticated, async (req: any, res) => {
    try {
      const result = await listVendorKeysHandler({
        userId: req.user.claims.sub,
        orgId: req.params.orgId,
        storage,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("Error listing vendor API keys:", err);
      res.status(500).json({ message: "Failed to list API keys" });
    }
  });

  // Revoke a vendor API key. Owner/admin only. Key must belong to this org.
  app.delete("/api/orgs/:orgId/vendor-keys/:keyId", isAuthenticated, async (req: any, res) => {
    try {
      const result = await revokeVendorKeyHandler({
        userId: req.user.claims.sub,
        orgId: req.params.orgId,
        rawKeyId: req.params.keyId,
        storage,
        recordAudit,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("Error revoking vendor API key:", err);
      res.status(500).json({ message: "Failed to revoke API key" });
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

      // Preserve existing verification status on re-edit; first onboarding starts "pending".
      const existing = await storage.getAgentProfile(userId);
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
        acceptingLeads: d.acceptingLeads,
        verificationStatus: existing?.verificationStatus ?? "pending",
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

  // Agent accepts or declines an assignment. On decline the engine re-routes.
  app.patch("/api/agent/assignments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const assignmentId = parseInt(req.params.id, 10);
      const status = req.body?.status;
      if (status !== "accepted" && status !== "declined") {
        return res.status(400).json({ message: "status must be accepted|declined" });
      }
      const updated = await storage.setAssignmentStatus(assignmentId, userId, status);
      if (!updated) return res.status(404).json({ message: "Assignment not found" });

      if (status === "declined") {
        storage.routeLeadToBestAgent(updated.leadId)
          .then(next => {
            if (next) {
              broadcastLeadAssignment({
                agentUserId: next.agentUserId,
                leadId: next.leadId,
                matchScore: next.matchScore,
              });
            }
          })
          .catch(err => console.error("Re-route error:", err));
      }
      res.json(updated);
    } catch (err) {
      console.error("Error updating assignment:", err);
      res.status(500).json({ message: "Failed to update assignment" });
    }
  });

  // List agents in the caller's active org (owner/admin only)
  app.get("/api/orgs/:orgId/agents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) return res.status(403).json({ message: "Not a member" });
      const agents = await storage.listOrgAgents(orgId);
      // Strip the document URL for non-admins (PII-ish)
      const safe = (role === "owner" || role === "admin") ? agents : agents.map(a => ({ ...a, licenseDocumentUrl: null, licenseNumber: null }));
      res.json(safe);
    } catch (err) {
      console.error("Error listing org agents:", err);
      res.status(500).json({ message: "Failed to list agents" });
    }
  });

  // Org admin updates an agent's historical conversion rate. This feeds into
  // both the routing engine (conv bonus) and the agent dashboard's
  // estimated-commission display.
  app.patch("/api/agent/:userId/conversion-rate", isAuthenticated, async (req: any, res) => {
    try {
      const actorId = req.user.claims.sub;
      const targetUserId = req.params.userId;
      const rate = Number(req.body?.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        return res.status(400).json({ message: "rate must be a number between 0 and 1" });
      }
      const target = await storage.getAgentProfile(targetUserId);
      if (!target) return res.status(404).json({ message: "Agent profile not found" });
      const role = await storage.getUserOrgRole(actorId, target.orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const updated = await storage.setAgentConversionRate(targetUserId, rate);
      recordAudit({
        actorUserId: actorId,
        orgId: target.orgId,
        action: "agent.conversion_rate",
        targetKind: "user",
        targetId: targetUserId,
        metadata: { rate },
      }).catch(err => console.error("[audit] failed:", err));
      res.json(updated);
    } catch (err) {
      console.error("Error setting conversion rate:", err);
      res.status(500).json({ message: "Failed to update conversion rate" });
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
      recordAudit({
        actorUserId: actorId,
        orgId: target.orgId,
        action: "agent.verification",
        targetKind: "user",
        targetId: targetUserId,
        metadata: { status },
      }).catch(err => console.error("[audit] failed:", err));
      res.json(updated);
    } catch (err) {
      console.error("Error setting verification:", err);
      res.status(500).json({ message: "Failed to update verification" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Phase 3 – Stripe subscription billing (per-org)
  // ──────────────────────────────────────────────────────
  // Fallback inline pricing when STRIPE_PRICE_* env vars aren't configured.
  // Production should set the env vars so each subscription reuses a single
  // Stripe Product/Price instead of minting a new one per checkout.
  const SUBSCRIPTION_TIERS: Record<string, { name: string; monthlyCents: number; priceIdEnv: string }> = {
    starter: { name: "Starter (up to 3 agents)", monthlyCents: 9900, priceIdEnv: "STRIPE_PRICE_STARTER" },
    growth: { name: "Growth (up to 15 agents)", monthlyCents: 29900, priceIdEnv: "STRIPE_PRICE_GROWTH" },
    scale: { name: "Scale (unlimited agents)", monthlyCents: 79900, priceIdEnv: "STRIPE_PRICE_SCALE" },
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
      // Prefer a trusted env-configured URL to avoid Host-header spoofing in
      // success/cancel redirects. Falls back to the request hostname only
      // when APP_URL is not set (dev / first-deploy).
      const baseUrl = process.env.APP_URL || `https://${req.hostname}`;

      // Use the configured Stripe Price ID when available (recommended);
      // otherwise create an inline price_data line item so dev still works.
      const priceId = process.env[tier.priceIdEnv];
      const lineItem: any = priceId
        ? { price: priceId, quantity: 1 }
        : {
            price_data: {
              currency: "usd",
              recurring: { interval: "month" },
              product_data: { name: `LeadMarket ${tier.name}` },
              unit_amount: tier.monthlyCents,
            },
            quantity: 1,
          };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [lineItem],
        success_url: `${baseUrl}/?stripe=sub_success&org=${orgId}`,
        cancel_url: `${baseUrl}/?stripe=sub_cancelled`,
        metadata: { orgId, tier: validation.data.tier, kind: "subscription" },
      });

      res.json({ url: session.url, usedPriceId: !!priceId });
    } catch (err: any) {
      console.error("Error creating subscription checkout:", err);
      res.status(500).json({ message: err.message || "Failed to create subscription" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Saved lists — agents bookmark leads to revisit
  // ──────────────────────────────────────────────────────
  app.get("/api/saved-lists", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const me = await storage.getUser(userId);
      const lists = await storage.listSavedLists(userId, me?.activeOrgId ?? null);
      res.json(lists);
    } catch (err) {
      console.error("Error listing saved lists:", err);
      res.status(500).json({ message: "Failed to list saved lists" });
    }
  });

  app.post("/api/saved-lists", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const me = await storage.getUser(userId);
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "name required" });
      if (name.length > 200) return res.status(400).json({ message: "name too long" });
      const list = await storage.createSavedList({
        name,
        ownerUserId: userId,
        orgId: me?.activeOrgId ?? null,
      });
      res.status(201).json(list);
    } catch (err) {
      console.error("Error creating saved list:", err);
      res.status(500).json({ message: "Failed to create saved list" });
    }
  });

  app.get("/api/saved-lists/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await storage.getSavedListWithItems(id, req.user.claims.sub);
      if (!result) return res.status(404).json({ message: "List not found" });
      res.json(result);
    } catch (err) {
      console.error("Error fetching saved list:", err);
      res.status(500).json({ message: "Failed to fetch saved list" });
    }
  });

  app.post("/api/saved-lists/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leadId = parseInt(req.body?.leadId, 10);
      if (!Number.isFinite(leadId)) return res.status(400).json({ message: "leadId required" });
      await storage.addLeadToSavedList(id, leadId, req.user.claims.sub);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.message === "List not found" ? 404 : 500).json({ message: err.message || "Failed" });
    }
  });

  app.delete("/api/saved-lists/:id/items/:leadId", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leadId = parseInt(req.params.leadId, 10);
      await storage.removeLeadFromSavedList(id, leadId, req.user.claims.sub);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.message === "List not found" ? 404 : 500).json({ message: err.message || "Failed" });
    }
  });

  app.delete("/api/saved-lists/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteSavedList(id, req.user.claims.sub);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed" });
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
      const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);

      // 1) Rate limit per (sessionId, ip): 30 events/min, burst 60.
      if (!(await takeToken(`evt:${d.sessionId}:${ip}`, 60, 0.5))) {
        return res.status(429).json({ message: "Too many events" });
      }
      // 2) Per-IP global limit so an attacker can't rotate sessionId.
      if (!(await takeToken(`evt:ip:${ip}`, 300, 5))) {
        return res.status(429).json({ message: "Too many events" });
      }

      // 3) Dedupe: scroll milestones / page views must not double-count.
      // Key on (session, type, path, value) within 5s.
      const dedupeKey = `evt:${d.sessionId}:${d.eventType}:${d.path ?? ""}:${d.value ?? ""}:${d.leadId ?? ""}`;
      if (await seenRecently(dedupeKey, 5_000)) {
        return res.json({ ok: true, deduped: true });
      }

      // 4) Clamp numeric value so callers can't inject huge dwell times.
      let value = d.value;
      if (typeof value === "number") {
        value = Math.max(0, Math.min(3600, Math.round(value)));
      }

      const userId = req.user?.claims?.sub ?? null;

      // 5) Verify the user has scope to attribute an event to a specific lead.
      // For org-scoped leads, only members of the org may post events for it;
      // global-pool leads accept events from anyone.
      let leadId = d.leadId ?? null;
      if (leadId != null) {
        const targetLead = await storage.getLead(leadId);
        if (!targetLead) {
          leadId = null;
        } else if (targetLead.orgId) {
          const me = userId ? await storage.getUser(userId) : null;
          if (me?.activeOrgId !== targetLead.orgId) {
            // Strip the lead attribution rather than 403'ing — events are
            // still useful as session telemetry, just unattributed.
            leadId = null;
          }
        }
      }

      await storage.recordBehavioralEvent({
        sessionId: d.sessionId,
        leadId,
        userId,
        eventType: d.eventType,
        path: d.path,
        value,
        metadata: d.metadata,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 500),
        ip,
      });

      // 6) Throttle MediScore recomputes to at most once every 30s per lead.
      if (leadId && (await throttleFire(`mediscore:${leadId}`, 30_000))) {
        recomputeAndPersistMediScore(leadId).catch(() => {});
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

  // PM + Growth funnel snapshot. Admin-only because it's aggregated PII-adjacent.
  app.get("/api/admin/analytics/funnel", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const days = Math.max(1, Math.min(90, parseInt(String(req.query.days ?? "7"), 10)));
      const snapshot = await getFunnelSnapshot(days);
      res.json(snapshot);
    } catch (err: any) {
      console.error("Funnel error:", err);
      res.status(500).json({ message: err.message || "Failed" });
    }
  });

  app.get("/api/admin/analytics/leads", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const data = await getLeadAnalytics();
      res.json(data);
    } catch (err: any) {
      console.error("Lead analytics error:", err);
      res.status(500).json({ message: err.message || "Failed" });
    }
  });

  app.post("/api/admin/digest/run", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const result = await runDailyDigest();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed" });
    }
  });

  app.post("/api/admin/dnc/recheck", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const result = await runDncRecheck();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Recheck failed" });
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
      const flaggedValue = flagged ?? true;
      const lead = await storage.flagLead(leadId, flaggedValue);
      recordAudit({
        actorUserId: userId,
        action: "lead.flag",
        targetKind: "lead",
        targetId: String(leadId),
        metadata: { flagged: flaggedValue },
      }).catch(err => console.error("[audit] failed:", err));
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
      recordAudit({
        actorUserId: userId,
        action: "lead.remove",
        targetKind: "lead",
        targetId: String(leadId),
      }).catch(err => console.error("[audit] failed:", err));
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
      recordAudit({
        actorUserId: userId,
        action: "user.role_set",
        targetKind: "user",
        targetId: userId,
        metadata: { role: "admin" },
      }).catch(err => console.error("[audit] failed:", err));
      res.json({ message: "Admin role assigned", user: updatedUser });
    } catch (error) {
      console.error("Error seeding admin:", error);
      res.status(500).json({ message: "Failed to seed admin" });
    }
  });

  // Admin-only: read the privileged-action audit log.
  app.get("/api/admin/audit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const action = typeof req.query.action === "string" ? req.query.action : undefined;
      const actorUserId =
        typeof req.query.actorUserId === "string" ? req.query.actorUserId : undefined;
      const limitRaw = req.query.limit;
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      const entries = await listAudit({ action, actorUserId, limit });
      res.json(entries);
    } catch (error) {
      console.error("Error listing audit log:", error);
      res.status(500).json({ message: "Failed to list audit log" });
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
  // Vendor payouts (admin)
  // ──────────────────────────────────────────────────────

  // Snapshot of every vendor's running pending + paid balances.
  app.get("/api/admin/vendor-balances", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const balances = await storage.getVendorBalances();
      res.json(balances);
    } catch (err: any) {
      console.error("Vendor balances error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch vendor balances" });
    }
  });

  // Sweep all vendors above the threshold into a payout (marks paid).
  // Real Stripe Connect transfer is TODO — this just moves pending → paid
  // and writes a debit row to `vendor_payouts`.
  app.post("/api/admin/vendor-payouts/sweep", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const raw = req.body?.thresholdCents;
      const threshold = Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 5000;
      const result = await storage.sweepVendorPayouts(threshold);
      res.json(result);
    } catch (err: any) {
      console.error("Vendor payout sweep error:", err);
      res.status(500).json({ message: err.message || "Sweep failed" });
    }
  });

  // Per-vendor ledger view (recent payouts).
  app.get("/api/admin/vendor-payouts/:vendorId", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const vendorId = parseInt(req.params.vendorId, 10);
      if (!Number.isFinite(vendorId)) return res.status(400).json({ message: "Invalid vendorId" });
      const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit ?? "50"), 10) || 50));
      const log = await storage.getVendorPayoutLog(vendorId, limit);
      res.json(log);
    } catch (err: any) {
      console.error("Vendor payout log error:", err);
      res.status(500).json({ message: err.message || "Failed to fetch payout log" });
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

      type SitemapUrl = { loc: string; priority: string; changefreq: string; lastmod?: string };
      const staticUrls: SitemapUrl[] = [
        { loc: baseUrl, priority: "1.0", changefreq: "daily" },
        { loc: `${baseUrl}/pricing`, priority: "0.9", changefreq: "weekly" },
        { loc: `${baseUrl}/blog`, priority: "0.9", changefreq: "daily" },
      ];

      const articleUrls: SitemapUrl[] = articles.map((a) => ({
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
