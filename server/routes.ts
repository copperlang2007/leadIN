import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { addToComparison, removeFromComparison } from "./leadComparison";
import {
  insertUserProfileSchema,
  vendorLeadIngestSchema,
  createOrgSchema,
  agentOnboardingSchema,
  subscriptionCheckoutSchema,
  createDisputeSchema,
  reportOutcomeSchema,
} from "@shared/schema";
import { QUOTE_TCPA_DISCLOSURE } from "@shared/consent";
import { normalizePhone, assessEmail } from "./leadValidation";
import { THROTTLED_DAILY_INGEST_CAP } from "./vendorEnforcement";
import { fromError } from "zod-validation-error";
import { setupWebSocket, broadcastNewLead, broadcastLeadAssignment, getActiveConnections, broadcastAssistSuggestion } from "./websocket";
import { startCallForLead, processTranscriptChunk } from "./dialer";
import { gateCallAgainstDnc } from "./dncAtDial";
import { verifyWebhook as verifyTwilioWebhook, twilioWebhookUrl, isTwilioLive } from "./lib/twilio";
import {
  sendOutreach,
  listTemplates as listSmsTemplates,
  isStopMessage,
  UnknownTemplateError,
  InvalidPlaceholderError,
  MissingPurchaseError,
  OptedOutError,
  RateLimitExceededError,
  NoConsumerPhoneError,
} from "./smsOutreach";
import { notifyUsersAboutNewLead } from "./emailNotifications";
import { getUncachableStripeClient } from "./stripeClient";
import { startContentEngine, generateAndPublishArticle } from "./contentGeneration";
import { checkDnc } from "./dncCompliance";
import { verifyTrustedFormCert, ERR_NO_API_KEY as TRUSTEDFORM_ERR_NO_API_KEY } from "./trustedForm";
import { recomputeAndPersistMediScore, computeMediScore } from "./mediscore";
import { buildBuyerRoiReport, type RoiRecord } from "./buyerRoi";
import { priceLead, computeDemandIndex } from "./intentPricing";
import { isWithinCallingHours } from "./callingHours";
import { evaluateQuote, type PlanType } from "./quoteEngine";
import { issueCertificateForLead, verifyWithConfiguredKey } from "./complianceCertService";
import { evaluatePing, verifyOffer, getPingPostSecret, type PingAttributes } from "./pingPost";
import { runMediscoreCalibration, startMediscoreCalibrationCron, loadPersistedCalibration } from "./mediscoreCalibrationJob";
import { getActiveCalibratedWeightsMeta } from "./mediscoreActiveWeights";
import { createHash } from "node:crypto";
import { startSeoSignalCron, refreshKeywordSignals, getTopOpportunityKeywords } from "./seoSignals";
import { startCmsSignalCron, refreshCmsPlanSignals } from "./cmsPlanSignals";
import { startDncRecheckCron, runDncRecheck } from "./dncRecheck";
import { startEmailDigestCron, runDailyDigest } from "./emailDigest";
import { startNiprRenewalCron, verifyAgentLicense } from "./niprSync";
import { startSecondLookCron } from "./secondLook";
import {
  attemptDeliveryForLead,
  startSmartMatchCycleCron,
  SMART_MATCH_TIERS,
} from "./smartMatch";
import { getFunnelSnapshot, getLeadAnalytics } from "./analytics";
import { trackEventSchema } from "@shared/schema";
import { MAX_BULK_PURCHASE, MAX_TRUST_VENDOR_IDS } from "@shared/constants";
import { takeToken, seenRecently, throttleFire } from "./rateLimit";
import { isValidReferralCode } from "./referrals";
import { ERR_SAVED_SEARCH_CAP } from "./savedSearch";
import { recordAudit, listAudit, recordLeadRevealAudit } from "./audit";
import { deleteAccount } from "./gdprDelete";
import { listVendorKeysHandler, revokeVendorKeyHandler } from "./vendorKeyRoutes";
import { handleInboundWebhook } from "./crmSync";
import { listProviders, getAdapter as getCrmAdapter } from "./lib/crm";
import { validateRoleChange } from "./adminUsers";
import { purchaseNotification, walletFundedNotification } from "./userNotificationMessages";
import type { SavedSearchCriteria } from "@shared/schema";
import { stripeWebhookIdempotency, markSeenOnceDb, startIdempotencyPruneCron } from "./lib/eventIdempotency";
import { verifyCrmWebhook } from "./lib/crmWebhookAuth";
import { verifyByProvider as verifyCrmByProvider } from "./lib/crmNativeAuth";
import { getMetricsSnapshot } from "./lib/metrics";
import { getComplianceServiceStatus, pingComplianceService } from "./complianceService";
import { logError } from "./lib/safeError";
import { log } from "./logger";
import { captureException } from "./lib/sentry";
import { buildBlogSitemap } from "./lib/blogSitemap";
import { getTopAgentsForOrg, REPUTATION_WEIGHTS, REPUTATION_WINDOW_DAYS } from "./reputation";
import {
  autoIssueReplacement,
  proposeReplacementCredit,
  type ReplacementDeps,
} from "./leadReplacement";
import { getPersonaForLead } from "./leadPersona";
import { buildCompliance, generateSuggestions } from "./dialerCopilot";
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

// ──────────────────────────────────────────────────────
// Health handlers (exported for handler-level tests in routes.health.test.ts).
// Public /api/health is rate-limited and only returns {status}; admin
// /api/admin/health returns the detailed view (uptime / latency / ws count).
// ──────────────────────────────────────────────────────
export async function publicHealthHandler(req: any, res: any) {
  const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);
  if (!(await takeToken(`health:${ip}`, 60, 1))) {
    return res.status(429).json({ status: "rate_limited" });
  }
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "degraded" });
  }
}

export async function adminHealthHandler(req: any, res: any) {
  const user = await storage.getUser(req.user.claims.sub);
  if (user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  // Deploy identifier: any of GIT_COMMIT_SHA (generic), the
  // Railway-injected RAILWAY_GIT_COMMIT_SHA, or the Vercel-injected
  // VERCEL_GIT_COMMIT_SHA. Short-form the SHA to 7 chars so it's
  // pasteable into a grep / GitHub URL. Falls back to "unknown"
  // when running outside a CI build (local dev).
  const fullSha =
    process.env.GIT_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    null;
  const commit = fullSha ? fullSha.slice(0, 7) : "unknown";
  const environment = process.env.NODE_ENV ?? "development";
  const start = Date.now();
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return res.json({
      status: "ok",
      uptimeSec: Math.round(process.uptime()),
      dbLatencyMs: Date.now() - start,
      wsConnections: getActiveConnections(),
      nodeVersion: process.version,
      commit,
      environment,
    });
  } catch {
    return res.status(503).json({
      status: "degraded",
      uptimeSec: Math.round(process.uptime()),
      error: "db_unreachable",
      commit,
      environment,
    });
  }
}

function stripPII(lead: any) {
  const {
    consumerName: _name,
    consumerPhone: _phone,
    consumerEmail: _email,
    consumerAddress: _addr,
    // Consent capture details are consumer PII too (IP + browser identify the
    // person); pre-purchase buyers only get the fact/time consent exists.
    consentIp: _cip,
    consentUserAgent: _cua,
    ...rest
  } = lead;
  return {
    ...rest,
    consumerName: null,
    consumerPhone: null,
    consumerEmail: null,
    consumerAddress: null,
    consentIp: null,
    consentUserAgent: null,
    piiGated: true,
  };
}

// Shared lead-creation pipeline used by both the direct ingest endpoint and the
// ping-post `/post` endpoint, so there is a single source of truth for dedup,
// DNC, TrustedForm, MediScore, broadcast, notify, and routing side-effects.
async function ingestLeadForVendor(
  vendor: { id: number; name: string; orgId: string | null },
  data: z.infer<typeof vendorLeadIngestSchema>,
  opts?: {
    /** First-party consent evidence captured by the platform itself (quote funnel). */
    consent?: { timestamp: Date; ip?: string; userAgent?: string; disclosureText?: string; sourceUrl?: string };
    /** True when the platform originated the lead (not a vendor submission). */
    firstParty?: boolean;
  },
): Promise<{ status: number; body: any }> {
  // Trust enforcement gate: suspended vendors can't ingest at all; throttled
  // vendors are capped per UTC day. Status is maintained by
  // applyVendorEnforcement on dispute resolution.
  const vendorRow = await storage.getVendor(vendor.id);
  if (vendorRow?.status === "suspended") {
    return {
      status: 403,
      body: { message: `Vendor suspended: ${vendorRow.statusReason ?? "elevated dispute rate"}` },
    };
  }
  if (vendorRow?.status === "throttled") {
    const midnightUtc = new Date();
    midnightUtc.setUTCHours(0, 0, 0, 0);
    const todayCount = await storage.countVendorLeadsSince(vendor.id, midnightUtc);
    if (todayCount >= THROTTLED_DAILY_INGEST_CAP) {
      return {
        status: 429,
        body: {
          message: `Vendor throttled (${vendorRow.statusReason ?? "elevated dispute rate"}): daily cap of ${THROTTLED_DAILY_INGEST_CAP} leads reached`,
        },
      };
    }
  }

  // Contact-quality gate: a present-but-invalid phone or a disposable email is
  // junk contact data — reject at the door instead of scoring and selling it.
  if (data.consumerPhone && !normalizePhone(data.consumerPhone)) {
    return { status: 422, body: { message: "Invalid consumer phone: not a valid US/CA (NANP) number" } };
  }
  if (data.consumerEmail) {
    const emailQuality = assessEmail(data.consumerEmail);
    if (emailQuality.disposable) {
      return { status: 422, body: { message: "Disposable email domains are not accepted; omit the email or provide a real one" } };
    }
  }

  // Duplicate check: same consumer (normalized phone) already listed, or sold
  // in the last 30 days — across all lead types.
  const isDuplicate = await storage.checkDuplicateLead(data.consumerPhone, data.type);
  if (isDuplicate) {
    return { status: 409, body: { message: "Duplicate lead: this phone number is already listed or was sold within the last 30 days" } };
  }

  const now = new Date();
  const provenance = [
    { date: now.toISOString(), action: "Lead Ingested via API", actor: `Vendor: ${vendor.name}`, icon: "check" },
    { date: new Date(now.getTime() + 1000).toISOString(), action: "Field Validation Passed", actor: "System", icon: "lock" },
    { date: new Date(now.getTime() + 2000).toISOString(), action: "Duplicate Check Cleared", actor: "System", icon: "eye" },
  ];

  // Structured consent evidence: first-party capture (opts) wins; otherwise
  // vendor-supplied evidence from the ingest payload. Recorded both in the
  // dedicated columns (queryable, MediScore-visible) and the provenance
  // timeline (buyer-visible).
  const consentEvidence = opts?.consent
    ?? (data.consent
      ? {
          timestamp: new Date(data.consent.timestamp),
          ip: data.consent.ip,
          userAgent: data.consent.userAgent,
          disclosureText: data.consent.disclosureText,
          sourceUrl: data.consent.sourceUrl,
        }
      : undefined);
  if (consentEvidence) {
    provenance.push({
      date: consentEvidence.timestamp.toISOString(),
      action: "TCPA Consent Captured",
      actor: opts?.firstParty ? "Platform: Quote Funnel" : `Vendor: ${vendor.name}`,
      icon: "lock",
    });
  }

  const dnc = await checkDnc(data.consumerPhone);

  let tcpa: { tcpaVerifiedAt: Date | null; tcpaCertId: string | null; tcpaVerifiedSource: string | null } = {
    tcpaVerifiedAt: null,
    tcpaCertId: null,
    tcpaVerifiedSource: null,
  };
  if (data.trustedFormCertUrl) {
    const result = await verifyTrustedFormCert(data.trustedFormCertUrl);
    if (result.ok && result.certId) {
      tcpa = { tcpaVerifiedAt: new Date(), tcpaCertId: result.certId, tcpaVerifiedSource: "trustedform" };
    } else if (result.error && result.error !== TRUSTEDFORM_ERR_NO_API_KEY) {
      // The lead still ingests as vendor-claimed-but-unverified — but a
      // verification FAILURE (rejected cert, bad key, expired cert, network
      // error) is materially different from "no key configured in dev", and
      // was previously dropped silently. Surface it WITH vendor context so
      // an operator can tell a misconfigured TrustedForm key / a specific
      // vendor sending junk certs from a healthy unverified-by-design flow.
      logError(
        `trustedform verification failed (vendor ${vendor.id})`,
        new Error(result.error),
      );
    }
  }

  const lead = await storage.createLead({
    vendorId: vendor.id,
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
    consentTimestamp: consentEvidence?.timestamp ?? null,
    consentIp: consentEvidence?.ip ?? null,
    consentUserAgent: consentEvidence?.userAgent ?? null,
    consentDisclosureText: consentEvidence?.disclosureText ?? null,
    consentSourceUrl: consentEvidence?.sourceUrl ?? null,
    firstParty: opts?.firstParty ?? false,
  });

  await recomputeAndPersistMediScore(lead.id).catch(err => logError("[mediscore] init error:", err));

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

  notifyUsersAboutNewLead({
    id: lead.id,
    type: lead.type,
    state: lead.state,
    price: lead.price,
    exclusivity: lead.exclusivity,
    vendorName: vendor.name,
  }).catch(err => logError("Notification error:", err));

  // Saved-search alerts — fire-and-forget, never block or break ingest. Re-fetch
  // the lead first so the matcher sees the FINALIZED mediscore: the recompute
  // above persists it to the DB row but doesn't mutate the in-memory `lead`, so
  // a `minMediscore` search would otherwise miss every freshly-ingested lead.
  storage
    .getLead(lead.id)
    .then(finalized => finalized && storage.notifyMatchingSavedSearches(finalized))
    .catch(err => logError("Saved-search notify error:", err));

  storage.routeLeadToBestAgent(lead.id)
    .then(assignment => {
      if (assignment && assignment.agentUserId) {
        broadcastLeadAssignment({
          agentUserId: assignment.agentUserId,
          leadId: assignment.leadId,
          matchScore: assignment.matchScore,
        });
      }
    })
    .catch(err => logError("Routing error:", err));

  (async () => {
    try {
      const fresh = await storage.getLead(lead.id);
      if (!fresh) return;
      const delivery = await attemptDeliveryForLead(fresh);
      if (delivery) {
        broadcastLeadAssignment({ agentUserId: delivery.agentUserId, leadId: lead.id, matchScore: 100 });
      }
    } catch (err: any) {
      logError("[smart-match] post-ingest delivery error:", err);
    }
  })();

  return { status: 201, body: { id: lead.id, message: "Lead ingested successfully" } };
}

// Shared auth/rate-limit/secret gate for the ping-post endpoints. Returns the
// vendor + HMAC secret, or null after having sent the appropriate error
// response — so /ping and /post stay byte-for-byte consistent.
async function authVendorForPingPost(
  req: any,
  res: any,
  bucket: string,
  refill: number,
  burst: number,
): Promise<{ vendor: { id: number; name: string; orgId: string | null }; secret: string } | null> {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    res.status(401).json({ message: "API key required (X-Api-Key header)" });
    return null;
  }
  const vendor = await storage.getVendorByApiKey(apiKey);
  if (!vendor) {
    res.status(401).json({ message: "Invalid or inactive API key" });
    return null;
  }
  if (!(await takeToken(`${bucket}:${vendor.id}`, refill, burst))) {
    res.status(429).json({ message: "Vendor rate limit exceeded" });
    return null;
  }
  const secret = getPingPostSecret();
  if (!secret) {
    res.status(503).json({ message: "Ping-post not configured" });
    return null;
  }
  return { vendor: { id: vendor.id, name: vendor.name, orgId: vendor.orgId ?? null }, secret };
}

// Max active saved searches per user — bounds notification fan-out per ingest.
const MAX_SAVED_SEARCHES = 25;

// Validation for saved-search criteria (wishlist). Every field is optional, but
// the criteria must (a) constrain on at least one non-empty filter — an empty
// or all-empty object would match every lead and spam the owner on each ingest
// — and (b) not invert the price band (minPrice <= maxPrice), which would be a
// permanently dead search.
const savedSearchCriteriaSchema = z.object({
  types: z.array(z.string().min(1)).optional(),
  states: z.array(z.string().min(1)).optional(),
  minPrice: z.number().finite().nonnegative().optional(),
  maxPrice: z.number().finite().nonnegative().optional(),
  minMediscore: z.number().finite().min(0).max(100).optional(),
  verifiedOnly: z.boolean().optional(),
}).strict()
  .refine(
    (c) => c.minPrice == null || c.maxPrice == null || c.minPrice <= c.maxPrice,
    { message: "minPrice must be <= maxPrice", path: ["minPrice"] },
  )
  .refine(
    // Require at least one EFFECTIVE filter. Mirrors leadMatchesCriteria: a
    // minPrice/minMediscore of 0 and verifiedOnly:false are no-ops there, so
    // accepting them would install a match-all search that notifies the owner
    // on every ingest. (maxPrice is always a real upper bound, even at 0.)
    (c) =>
      (c.types?.length ?? 0) > 0 ||
      (c.states?.length ?? 0) > 0 ||
      (c.minPrice != null && c.minPrice > 0) ||
      c.maxPrice != null ||
      (c.minMediscore != null && c.minMediscore > 0) ||
      c.verifiedOnly === true,
    { message: "At least one effective filter is required" },
  );

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
  startNiprRenewalCron();
  // Wave 7 (T3) — daily reset of smart-match monthly cycles.
  startSmartMatchCycleCron();
  // Drop webhook_idempotency rows older than 7d. Sits at 04:00 after
  // the rest so log lines don't interleave with data-retention sweeps.
  startIdempotencyPruneCron();
  // Load any persisted calibrated weights, then schedule weekly recalibration.
  loadPersistedCalibration().catch(err => logError("[mediscore] load-at-boot error:", err));
  startMediscoreCalibrationCron();
  // M6 — hourly re-list of aging unsold inventory at a decaying price.
  startSecondLookCron();

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

      // Idempotency guard: Stripe retries on slow / failed responses.
      // First sighting → process; subsequent → respond 200 immediately
      // without re-running side effects.
      // markSeenOnceDb is the cross-pod source of truth; the in-memory
      // stripeWebhookIdempotency is a hot-path short-circuit that skips
      // the DB round-trip for events this pod already processed.
      if (!(await markSeenOnceDb("stripe", event.id, stripeWebhookIdempotency))) {
        console.log(`Stripe webhook duplicate (event ${event.id}, type ${event.type}) — skipping`);
        return res.json({ received: true, duplicate: true });
      }

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
          if (ourSession && ourSession.status === "pending" && ourSession.userId) {
            await storage.creditUserFromStripe(ourSession.userId, stripeSessionId, amountPaid);
            console.log(`Credited $${amountPaid} to user ${ourSession.userId} via Stripe session ${stripeSessionId}`);
            // In-app notification (fire-and-forget — never block the webhook).
            storage
              .createUserNotification(walletFundedNotification(ourSession.userId, amountPaid))
              .catch((err) => logError("Error creating wallet notification:", err));
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
          logError("Subscription sync failed:", e);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      logError("Stripe webhook error:", err);
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Public health (unauthenticated, rate-limited). Returns ONLY {status} so
  // we don't leak deploy fingerprints (uptime) or active WS counts to
  // unauthenticated callers. Still runs SELECT 1 so load balancers / uptime
  // probes get a real liveness signal (200 healthy / 503 degraded).
  // ──────────────────────────────────────────────────────
  app.get("/api/health", publicHealthHandler);

  // Admin health — the detailed view (uptime, db latency, ws count,
  // node version). Behind isAuthenticated + admin role check so only
  // operators see the deploy fingerprint.
  // ──────────────────────────────────────────────────────
  app.get("/api/admin/health", isAuthenticated, adminHealthHandler);

  // ──────────────────────────────────────────────────────
  // Client error report — receives React render errors caught by the
  // SPA ErrorBoundary and forwards them to Sentry (no-op when
  // SENTRY_DSN is unset). Without this endpoint, a render error in a
  // user's browser dies in their console and we never see it.
  //
  // Authentication is intentionally optional: a render error can
  // happen before the auth context resolves, and we want the report
  // either way. The endpoint is heavily rate-limited per IP so a
  // misbehaving client (or hostile crawler) can't fill the log
  // pipeline. PII is scrubbed before the message lands in Sentry via
  // the safeError chain.
  // ──────────────────────────────────────────────────────
  app.post("/api/errors", async (req: any, res) => {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);
    if (!(await takeToken(`client-error:${ip}`, 30, 5 / 60))) {
      // 30 bursts, 5/minute sustained. Even a tab-storm of 30 errors
      // back-to-back gets through; sustained spam gets dropped.
      return res.status(429).json({ ok: false });
    }
    try {
      const message = String(req.body?.message ?? "").slice(0, 1000);
      const stack = String(req.body?.stack ?? "").slice(0, 8000);
      const componentStack = String(req.body?.componentStack ?? "").slice(0, 4000);
      const url = String(req.body?.url ?? "").slice(0, 500);
      const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 300);

      if (!message) {
        return res.status(400).json({ ok: false, message: "message required" });
      }

      // Build a fabricated Error so Sentry's stack-trace renderer is
      // happy. The original throw is on a different runtime so we
      // can't capture it directly; this is a structured proxy.
      const err = new Error(message);
      err.stack = stack || undefined;
      const userId = req.user?.claims?.sub;
      captureException(err, {
        req,
        userId,
        tags: { source: "client-react-error-boundary" },
        extra: { componentStack, url, userAgent },
      });
      logError("client.error", err);
      res.json({ ok: true });
    } catch (err) {
      // Never let the error endpoint itself become a noise source.
      logError("client-error-endpoint failed", err);
      res.status(500).json({ ok: false });
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
      logError("Error fetching user:", error);
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
      logError("Error fetching profile:", error);
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
      logError("Error updating profile:", error);
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
      logError("Error updating notification preference:", error);
      res.status(500).json({ message: "Failed to update notification preference" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Self-serve GDPR account deletion.
  //
  // The user must re-type their email address as confirmation. We write an
  // audit row BEFORE cascading the delete so the actor reference still
  // resolves (audit is append-only and lives outside the GDPR-delete tx).
  // ──────────────────────────────────────────────────────
  app.delete("/api/account", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { confirmEmail } = req.body ?? {};
      if (typeof confirmEmail !== "string" || !confirmEmail.trim()) {
        return res.status(400).json({ message: "confirmEmail is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (
        !user.email ||
        user.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()
      ) {
        return res.status(400).json({ message: "Confirmation email does not match" });
      }

      // Audit BEFORE the delete — once the tx commits the actorUserId points
      // at a row that no longer exists, which is fine (audit is append-only)
      // but we still want the row to make it to storage either way.
      await recordAudit({
        actorUserId: userId,
        action: "account.delete",
        targetKind: "user",
        targetId: userId,
        metadata: { email: user.email },
      });

      const result = await deleteAccount(userId);

      // Destroy the session; the client redirects to /api/logout for the
      // OIDC end-session leg.
      req.logout((err: unknown) => {
        if (err) {
          logError("Error destroying session after account delete:", err);
        }
        res.json({ ok: true, ...result });
      });
    } catch (error) {
      logError("Error deleting account:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // ──────────────────────────────────────────────────────
  // In-app notification center
  // Harvested from the leadmarket sibling repo (see ADR 0001). Backed by the
  // user_notifications table — distinct from the `notifications` email-dedup
  // ledger. Producers live at lead purchase and Stripe wallet credit.
  // ──────────────────────────────────────────────────────
  app.get("/api/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const list = await storage.getUserNotifications(req.user.claims.sub);
      res.json(list);
    } catch (error) {
      logError("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/read-all", isAuthenticated, async (req: any, res) => {
    try {
      await storage.markAllUserNotificationsRead(req.user.claims.sub);
      res.json({ success: true });
    } catch (error) {
      logError("Error marking notifications read:", error);
      res.status(500).json({ message: "Failed to mark notifications read" });
    }
  });

  app.post("/api/notifications/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }
      await storage.markUserNotificationRead(id, req.user.claims.sub);
      res.json({ success: true });
    } catch (error) {
      logError("Error marking notification read:", error);
      res.status(500).json({ message: "Failed to mark notification read" });
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
      logError("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  // ── Lead comparison (session-scoped, max 3) ──────────────────────────────
  // Harvested from the leadmarket sibling repo (see ADR 0001). Stored on the
  // session so it works for anonymous browsing. Registered before the
  // `/api/leads/:id` param route so "compare" is never matched as an id.
  app.get("/api/leads/compare", (req: any, res) => {
    const list: number[] = req.session?.comparison ?? [];
    res.json(list);
  });

  app.delete("/api/leads/compare", (req: any, res) => {
    req.session.comparison = [];
    res.json({ comparison: [] });
  });

  app.post("/api/leads/:id/compare", (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid lead id" });
    const current: number[] = req.session?.comparison ?? [];
    const result = addToComparison(current, id);
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    req.session.comparison = result.list;
    res.json({ comparison: result.list });
  });

  app.delete("/api/leads/:id/compare", (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid lead id" });
    const current: number[] = req.session?.comparison ?? [];
    req.session.comparison = removeFromComparison(current, id);
    res.json({ comparison: req.session.comparison });
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
      logError("Error fetching lead:", error);
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

      // Audit the PII reveal before we hand it out. recordAudit swallows its
      // own errors so a failure here cannot block the response.
      await recordLeadRevealAudit({
        actorUserId: userId,
        leadId,
        orgId: lead.orgId ?? null,
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
      });

      // Return full lead with PII
      res.json(lead);
    } catch (error) {
      logError("Error revealing lead PII:", error);
      res.status(500).json({ message: "Failed to reveal lead information" });
    }
  });

  // Provably-compliant lead certificate: an Ed25519-signed, PII-free receipt
  // the buyer can verify with the platform's public key. Gated to purchasers.
  app.get("/api/leads/:id/certificate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);
      const order = await storage.getOrderForLead(userId, leadId);
      if (!order) {
        return res.status(403).json({ message: "Purchase this lead to obtain its compliance certificate" });
      }
      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      // Audit hash binds the certificate to the lead's provenance trail without
      // exposing any PII.
      const auditHash =
        "sha256:" +
        createHash("sha256")
          .update(JSON.stringify({ id: lead.id, provenance: lead.provenance ?? [] }))
          .digest("hex");

      const result = issueCertificateForLead(lead, auditHash);
      if (!result.ok) return res.status(503).json({ message: result.reason });
      res.json(result.certificate);
    } catch (error) {
      logError("Error issuing compliance certificate:", error);
      res.status(500).json({ message: "Failed to issue certificate" });
    }
  });

  // Public certificate verification — anyone (incl. a buyer's auditor) can POST
  // a certificate and confirm it was signed by the platform, untampered.
  app.post("/api/compliance/verify", async (req: any, res) => {
    try {
      const cert = req.body?.certificate ?? req.body;
      // Shape-check before verifying so malformed bodies get a clear 400 rather
      // than a generic invalid-signature result.
      if (
        !cert ||
        typeof cert !== "object" ||
        typeof cert.alg !== "string" ||
        typeof cert.signature !== "string" ||
        typeof cert.payload !== "object" ||
        cert.payload === null
      ) {
        return res.status(400).json({ message: "Malformed certificate: expected { payload, alg, signature }" });
      }
      res.json(verifyWithConfiguredKey(cert));
    } catch (error) {
      logError("Error verifying compliance certificate:", error);
      res.status(500).json({ message: "Failed to verify certificate" });
    }
  });

  // Wave 7 (T6) — AI persona for a purchased lead. Gated to the purchaser of
  // the lead or to admin users. Re-generates if the cached row is > 7 days old
  // (or whenever `?force=true` is supplied).
  app.get("/api/leads/:id/persona", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);
      if (!Number.isFinite(leadId)) {
        return res.status(400).json({ message: "Invalid lead id" });
      }

      const user = await storage.getUser(userId);
      const isAdminUser = user?.role === "admin";

      if (!isAdminUser) {
        // Must own a completed order for this lead.
        const order = await storage.getOrderForLead(userId, leadId);
        if (!order) {
          return res
            .status(403)
            .json({ message: "Purchase this lead to view the AI persona" });
        }
      }

      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      // Org-scope guard: the sibling /api/leads/:id/reveal endpoint scopes
      // everyone (admins included) — we match that here. Platform admins
      // still bypass the *purchase* requirement above for support /
      // moderation flows, but they don't get a persona for a lead that
      // belongs to a different org. The previous `&& !isAdminUser` clause
      // directly contradicted this comment and was the red-team finding.
      if (lead.orgId && user?.activeOrgId !== lead.orgId) {
        return res.status(403).json({ message: "Lead not available to your organization" });
      }

      const force = req.query.force === "true" || req.query.force === "1";
      const persona = await getPersonaForLead(leadId, force);
      if (!persona) return res.status(404).json({ message: "Lead not found" });
      res.json(persona);
    } catch (error) {
      logError("Error generating lead persona:", error);
      res.status(500).json({ message: "Failed to generate persona" });
    }
  });

  // AI Dialer Copilot (scoped slice — request/response, no real-time audio).
  // For a purchased lead + a transcript snippet, returns compliance guardrails
  // and up to 3 AI-suggested talking points. Gated to the purchaser of the
  // lead (or an admin), matching the /api/leads/:id/persona pattern.
  app.post("/api/dialer/copilot", isAuthenticated, async (req: any, res) => {
    try {
      // Targeted kill switch: disable this route independently (e.g. a bad
      // AI-suggestion pattern post-launch) without downgrading every other AI
      // feature by unsetting the shared LLM keys. Normalise the value so
      // conventional off-strings all work under incident pressure.
      const killVal = (process.env.DIALER_COPILOT_ENABLED ?? "").trim().toLowerCase();
      if (["false", "0", "off", "no", "disabled"].includes(killVal)) {
        return res.status(503).json({ message: "Dialer copilot is temporarily disabled" });
      }
      const userId = req.user.claims.sub;
      const body = req.body ?? {};

      const leadId = Number(body.leadId);
      if (!Number.isInteger(leadId) || leadId <= 0) {
        return res.status(400).json({ message: "Invalid leadId" });
      }
      // Transcript is optional but, when present, must be a string. Clamp is
      // applied downstream in the copilot module.
      const transcript = body.transcript === undefined || body.transcript === null
        ? ""
        : body.transcript;
      if (typeof transcript !== "string") {
        return res.status(400).json({ message: "transcript must be a string" });
      }

      // Rate-limit BEFORE the DB lookups so a spammer can't drive DB load under
      // the LLM ceiling. Per-user bucket (burst 20, ~12/min) + a coarse global
      // bucket so aggregate LLM spend is bounded across all seats at peak.
      if (!(await takeToken(`dialer-copilot:${userId}`, 20, 0.2))) {
        return res.status(429).json({ message: "Too many copilot requests — try again in a moment" });
      }
      if (!(await takeToken("dialer-copilot:global", 300, 5))) {
        return res.status(429).json({ message: "Dialer copilot is busy — try again in a moment" });
      }

      const user = await storage.getUser(userId);
      const isAdminUser = user?.role === "admin";

      if (!isAdminUser) {
        // Must own a completed order for this lead.
        const order = await storage.getOrderForLead(userId, leadId);
        if (!order) {
          return res
            .status(403)
            .json({ message: "Purchase this lead to use the dialer copilot" });
        }
      }

      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      // Org-scope guard: mirror /reveal + /persona — an order in org A must not
      // unlock a lead from org B, and admins don't get cross-org access here.
      if (lead.orgId && user?.activeOrgId !== lead.orgId) {
        return res.status(403).json({ message: "Lead not available to your organization" });
      }

      const compliance = buildCompliance(lead, new Date());
      const { suggestions, modelUsed } = await generateSuggestions(lead, transcript);
      // Observability: a "<model>+fallback" means the LLM responded but its
      // output was unparseable and we served the stub — a silent provider
      // regression operators otherwise couldn't distinguish from real answers.
      if (modelUsed.endsWith("+fallback")) {
        log.warn("[dialer-copilot] LLM output unparseable — served stub suggestions", {
          leadId,
          modelUsed,
        });
      }

      res.json({ compliance, suggestions });
    } catch (error) {
      logError("Error running dialer copilot:", error);
      res.status(500).json({ message: "Failed to run dialer copilot" });
    }
  });

  app.post("/api/leads/:id/purchase", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);
      const order = await storage.purchaseLead(leadId, userId);
      // In-app notification (fire-and-forget — never block/break the purchase).
      storage
        .createUserNotification(purchaseNotification(userId, leadId))
        .catch((err) => logError("Error creating purchase notification:", err));
      res.json(order);
    } catch (error: any) {
      logError("Error purchasing lead:", error);
      res.status(400).json({ message: error.message || "Failed to purchase lead" });
    }
  });

  // Bulk Buy — atomic multi-lead purchase (all-or-nothing single wallet debit).
  app.post("/api/leads/purchase-batch", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadIds = Array.isArray(req.body?.leadIds)
        ? req.body.leadIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
        : [];
      if (leadIds.length === 0) {
        return res.status(400).json({ message: "No leads specified" });
      }
      // Bound the transaction size so one request can't lock unbounded rows.
      if (leadIds.length > MAX_BULK_PURCHASE) {
        return res
          .status(400)
          .json({ message: `Too many leads in one purchase (max ${MAX_BULK_PURCHASE})` });
      }
      const purchasedOrders = await storage.purchaseLeads(leadIds, userId);
      for (const order of purchasedOrders) {
        storage
          .createUserNotification(purchaseNotification(userId, order.leadId))
          .catch((err) => logError("Error creating purchase notification:", err));
      }
      res.json(purchasedOrders);
    } catch (error: any) {
      logError("Error purchasing leads (batch):", error);
      res.status(400).json({ message: error.message || "Failed to purchase leads" });
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
      logError("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Buyer ROI analytics: CAC / conversion / ROI sliced by vendor and MediScore
  // band. Revenue is derived from the buyer's own `avgCommission` query param
  // (default 0) so every figure is traceable to the buyer's real inputs. A lead
  // is counted as converted when its order status is "converted".
  app.get("/api/buyer/roi", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const avgCommission = Number(req.query.avgCommission ?? 0) || 0;
      const orders = await storage.getUserOrders(userId);
      const records: RoiRecord[] = orders.map(o => ({
        cost: o.price,
        mediscore: o.lead?.mediscore ?? 0,
        vendorId: o.lead?.vendor?.id ?? 0,
        vendorName: o.lead?.vendor?.name ?? "Unknown",
        converted: o.status === "converted",
      }));
      res.json(buildBuyerRoiReport(records, { avgCommission }));
    } catch (error) {
      logError("Error building buyer ROI report:", error);
      res.status(500).json({ message: "Failed to build ROI report" });
    }
  });

  // Stateless dynamic-price quote: shows the buyer exactly how base price,
  // quality, intent, exclusivity, and demand combine into a final price.
  app.post("/api/pricing/quote", isAuthenticated, async (req: any, res) => {
    try {
      const { basePrice, mediscore, intentScore, exclusivity, demandIndex, floor, ceiling, trustTier } = req.body ?? {};
      // When the caller doesn't pin a demandIndex, surge with the live market.
      let demand = demandIndex === undefined ? undefined : Number(demandIndex);
      if (demand === undefined) {
        const snap = await storage.getMarketDemandSnapshot();
        demand = computeDemandIndex(snap.recentOrders, snap.availableLeads);
      }
      res.json(
        priceLead({
          basePrice: Number(basePrice) || 0,
          mediscore: Number(mediscore) || 0,
          intentScore: Number(intentScore) || 0,
          exclusivity: String(exclusivity ?? "Shared"),
          demandIndex: demand,
          floor: floor === undefined ? undefined : Number(floor),
          ceiling: ceiling === undefined ? undefined : Number(ceiling),
          trustTier: trustTier === undefined ? undefined : String(trustTier),
        }),
      );
    } catch (error) {
      logError("Error computing price quote:", error);
      res.status(500).json({ message: "Failed to compute price quote" });
    }
  });

  // Live market demand snapshot + surge index (for buyer transparency).
  // Authenticated: recent order volume / lead counts are sensitive business
  // metrics that shouldn't be exposed to anonymous clients.
  app.get("/api/pricing/demand", isAuthenticated, async (req: any, res) => {
    try {
      // Optional window override, validated to a sane 1h..168h (7d) range.
      const raw = Number(req.query.windowHours);
      const windowHours = Number.isFinite(raw) ? Math.min(168, Math.max(1, Math.round(raw))) : undefined;
      const snap = await storage.getMarketDemandSnapshot(windowHours);
      res.json({ ...snap, windowHours: windowHours ?? 24, demandIndex: computeDemandIndex(snap.recentOrders, snap.availableLeads) });
    } catch (error) {
      logError("Error computing demand index:", error);
      res.status(500).json({ message: "Failed to compute demand index" });
    }
  });

  // Vendor Trust Signals: aggregate dispute-rate + volume for the vendors on
  // the buyer's current marketplace view. One request per page (client dedupes
  // the visible vendorIds), returns a { [vendorId]: {soldCount, disputeCount,
  // disputeRate, tier} } map. Authenticated: these are business metrics, not
  // public, but they're aggregate counts (no PII / per-lead detail) so any
  // authed buyer may see any vendor's signal.
  app.get("/api/vendors/trust-stats", isAuthenticated, async (req: any, res) => {
    try {
      // Parse `vendorIds=1,2,3`. Accept ONLY real positive-integer strings —
      // no Number() coercion (which would swallow "", "true", "1e3", arrays).
      const raw = req.query.vendorIds;
      const tokens = (Array.isArray(raw) ? raw.join(",") : String(raw ?? "")).split(",");
      const seen = new Set<number>();
      for (const t of tokens) {
        const s = t.trim();
        if (!/^\d+$/.test(s)) continue; // reject non-numeric / signs / decimals
        const n = Number.parseInt(s, 10);
        // Upper-bound at int4 max: vendor ids are serial (int4) columns, so a
        // value above 2147483647 can never match a row and would only widen the
        // IN list / risk an out-of-range cast in the query.
        if (Number.isSafeInteger(n) && n > 0 && n <= 2147483647) seen.add(n);
      }
      const vendorIds = Array.from(seen).slice(0, MAX_TRUST_VENDOR_IDS);
      if (vendorIds.length === 0) {
        return res.status(400).json({ message: "vendorIds must contain at least one positive integer" });
      }
      const stats = await storage.getVendorTrustStats(vendorIds);
      res.json(stats);
    } catch (error) {
      logError("Error computing vendor trust stats:", error);
      res.status(500).json({ message: "Failed to compute vendor trust stats" });
    }
  });

  // TCPA calling-hours check for a consumer's state (DST-aware, fail-closed).
  app.get("/api/compliance/calling-hours", async (req: any, res) => {
    try {
      const state = String(req.query.state ?? "");
      res.json(isWithinCallingHours(state));
    } catch (error) {
      logError("Error checking calling hours:", error);
      res.status(500).json({ message: "Failed to check calling hours" });
    }
  });

  // Public quote-tool lead magnet: returns an instant eligibility + plan-match
  // result, and (when the consumer consents and a house vendor is configured)
  // captures a consented, source-attributed lead via the shared pipeline.
  app.post("/api/quote", async (req: any, res) => {
    try {
      // Public, unauthenticated endpoint that can mint leads — rate-limit per
      // IP (burst 5, ~1 quote/12s sustained) to keep bot traffic from
      // flooding the first-party funnel.
      const quoteIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      if (!(await takeToken(`quote:${quoteIp}`, 5, 5 / 60))) {
        return res.status(429).json({ message: "Too many quote requests; slow down" });
      }
      const b = req.body ?? {};
      const result = evaluateQuote({
        age: b.age === undefined ? undefined : Number(b.age),
        dob: b.dob ? String(b.dob) : undefined,
        state: String(b.state ?? ""),
        zip: b.zip ? String(b.zip) : undefined,
        currentlyOnMedicare: !!b.currentlyOnMedicare,
        interest: b.interest as PlanType | undefined,
        lowIncome: !!b.lowIncome,
        chronicConditions: !!b.chronicConditions,
        movedRecently: !!b.movedRecently,
        lostCoverage: !!b.lostCoverage,
      });

      // Best-effort consented capture. Never let a capture failure break the
      // consumer-facing quote response.
      let captured = false;
      const houseVendorId = Number(process.env.QUOTE_TOOL_VENDOR_ID) || 0;
      const age = Number(b.age) || 0;
      const consent = !!b.consent;
      if (consent && houseVendorId && b.phone && b.zip && age >= 18 && String(b.state).length === 2) {
        const vendor = await storage.getVendor(houseVendorId);
        if (vendor) {
          // All quote-tool interests are Medicare product lines; PDP shoppers
          // are MA-adjacent (MA-PD bundles drug coverage), so they and the
          // "not sure yet" default map to Medicare Advantage. We never default
          // to Final Expense (a different, life-insurance product line).
          const typeMap: Record<string, "Medicare Advantage" | "Medicare Supplement" | "Final Expense"> = {
            Medigap: "Medicare Supplement",
            "Medicare Advantage": "Medicare Advantage",
            "Part D (PDP)": "Medicare Advantage",
          };
          const leadType = typeMap[String(b.interest)] ?? "Medicare Advantage";
          const parsed = vendorLeadIngestSchema.safeParse({
            type: leadType,
            source: `Quote Tool${b.utmSource ? ` / ${String(b.utmSource).slice(0, 40)}` : ""}`,
            exclusivity: "Exclusive",
            price: Number(process.env.QUOTE_TOOL_PRICE) || 25,
            consumerAge: age,
            state: String(b.state).toUpperCase(),
            zipCode: String(b.zip),
            consumerName: b.name ? String(b.name) : undefined,
            consumerPhone: String(b.phone),
            consumerEmail: b.email ? String(b.email) : undefined,
          });
          if (parsed.success) {
            // Only report capture when ingestion actually succeeds (201).
            try {
              // First-party consent evidence: the consumer checked the TCPA
              // box on OUR form, so snapshot the full event — when, from
              // where, the exact disclosure rendered (shared constant, same
              // text the form shows), and the page it happened on. This is
              // what makes a first-party lead worth more than a vendor row.
              const ingest = await ingestLeadForVendor(
                { id: vendor.id, name: vendor.name, orgId: null },
                parsed.data,
                {
                  firstParty: true,
                  consent: {
                    timestamp: new Date(),
                    ip: quoteIp === "unknown" ? undefined : String(quoteIp).slice(0, 45),
                    userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 500) : undefined,
                    disclosureText: QUOTE_TCPA_DISCLOSURE,
                    sourceUrl: req.headers.referer ? String(req.headers.referer).slice(0, 500) : undefined,
                  },
                },
              );
              captured = ingest.status === 201;
            } catch (err) {
              logError("[quote] capture error:", err);
            }
          } else {
            logError("[quote] lead validation failed:", parsed.error);
          }
        }
      }

      res.json({ ...result, captured });
    } catch (error) {
      logError("Error handling quote:", error);
      res.status(500).json({ message: "Failed to compute quote" });
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
      logError("Error exporting orders:", error);
      res.status(500).json({ message: "Failed to export orders" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Lead Outcome Routes (Wave 13)
  //
  // Buyers report what actually happened with a purchased lead. One row per
  // order, upsert on re-report; "closed" flips the order to "converted" —
  // the label buyer ROI and MediScore calibration train on.
  // ──────────────────────────────────────────────────────
  app.post("/api/orders/:orderId/outcome", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }

      const parsed = reportOutcomeSchema.safeParse({
        outcome: req.body?.outcome,
        notes: req.body?.notes,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: fromError(parsed.error).toString() });
      }

      if (!(await takeToken(`outcome:${userId}`, 30, 10 / 60))) {
        return res.status(429).json({ message: "Too many outcome reports" });
      }

      const result = await storage.reportLeadOutcome(orderId, userId, parsed.data);
      res.status(result.firstReport ? 201 : 200).json(result.outcome);
    } catch (error: any) {
      const msg = String(error?.message ?? "");
      if (msg.includes("not found") || msg.includes("does not belong")) {
        // 404 for both cases — don't leak other buyers' order ids.
        return res.status(404).json({ message: "Order not found" });
      }
      if (msg.includes("refunded")) {
        return res.status(409).json({ message: msg });
      }
      logError("Error reporting lead outcome:", error);
      res.status(500).json({ message: "Failed to report outcome" });
    }
  });

  // Outcomes for the buyer's own orders, keyed by orderId — one call per
  // orders-page load, mirrors the trust-stats batching pattern.
  app.get("/api/orders/outcomes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const userOrders = await storage.getUserOrders(userId);
      const map = await storage.getOutcomesByOrderIds(userOrders.map(o => o.id));
      res.json(map);
    } catch (error) {
      logError("Error fetching order outcomes:", error);
      res.status(500).json({ message: "Failed to fetch outcomes" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Dispute Routes (Wave 4)
  //
  // Buyers file disputes on purchased leads. Admins approve (refunds the
  // buyer wallet, debits the vendor proportionally) or deny.
  // ──────────────────────────────────────────────────────
  app.post("/api/orders/:orderId/dispute", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }

      // Validate body. The orderId on the path is the source of truth — we
      // pass it into the schema so the zod shape stays a single contract.
      const parsed = createDisputeSchema.safeParse({
        orderId,
        reason: req.body?.reason,
        notes: req.body?.notes,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: fromError(parsed.error).toString() });
      }

      // Cheap rate limit — one dispute filing per order is the only sane
      // shape, but throttle the path anyway in case of UI retry storms.
      if (!(await takeToken(`dispute:${userId}`, 10, 5 / 60))) {
        return res.status(429).json({ message: "Too many dispute attempts" });
      }

      const dispute = await storage.createDispute({
        orderId: parsed.data.orderId,
        buyerUserId: userId,
        reason: parsed.data.reason,
        notes: parsed.data.notes,
      });

      // T2 — Fire-and-forget AI classification. Never blocks dispute creation.
      (async () => {
        try {
          const { classifyDispute } = await import("./disputeClassifier");
          const result = await classifyDispute({
            reason: parsed.data.reason,
            notes: parsed.data.notes ?? null,
          });
          await storage.updateDisputeAi(dispute.id, {
            aiClassification: result.classification,
            aiConfidence: result.confidence,
          });
        } catch (err) {
          logError("[disputeClassifier] failed:", err);
        }
      })();

      res.status(201).json(dispute);
    } catch (err: any) {
      if (/does not belong/i.test(err?.message ?? "")) {
        return res.status(403).json({ message: err.message });
      }
      if (/not found/i.test(err?.message ?? "")) {
        return res.status(404).json({ message: err.message });
      }
      logError("Error creating dispute:", err);
      res.status(500).json({ message: err?.message || "Failed to create dispute" });
    }
  });

  app.get("/api/orders/:orderId/dispute", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const dispute = await storage.getDisputeByOrderId(orderId);
      if (!dispute) return res.status(404).json({ message: "No dispute found" });

      const user = await storage.getUser(userId);
      const isAdminUser = user?.role === "admin";
      if (!isAdminUser && dispute.buyerUserId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(dispute);
    } catch (err: any) {
      logError("Error fetching dispute:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch dispute" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Agent Referral Routes (N2) — invite-and-earn
  //
  // GET  /api/referrals/me     → my stable code + redeemed/rewarded counts
  // POST /api/referrals/redeem → redeem someone's code as the current user
  // ──────────────────────────────────────────────────────
  app.get("/api/referrals/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const summary = await storage.getReferralSummary(userId);
      res.json(summary);
    } catch (err: any) {
      logError("Error fetching referral summary:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch referral summary" });
    }
  });

  app.post("/api/referrals/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Validate the body shape — never trust the client. `code` must be a
      // non-empty string matching the referral-code alphabet/length.
      const code = req.body?.code;
      if (!isValidReferralCode(code)) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      // Per-user rate limit on the redeem path (retry/abuse storms).
      if (!(await takeToken(`referral-redeem:${userId}`, 10, 5 / 60))) {
        return res.status(429).json({ message: "Too many redeem attempts" });
      }

      const referral = await storage.redeemReferralCode(code, userId);
      res.status(200).json({ status: referral.status, redeemedAt: referral.redeemedAt });
    } catch (err: any) {
      const msg = err?.message ?? "";
      // Map known validation failures to 400/409; everything else is a 500.
      if (/invalid referral code/i.test(msg)) {
        return res.status(400).json({ message: msg });
      }
      if (/already (been )?redeemed|your own referral code/i.test(msg)) {
        return res.status(409).json({ message: msg });
      }
      logError("Error redeeming referral code:", err);
      res.status(500).json({ message: msg || "Failed to redeem referral code" });
    }
  });

  // ── Admin: user management ───────────────────────────────────────────────
  // Harvested from the leadmarket sibling repo (see ADR 0001): list users and
  // assign the platform role ("user" | "admin"). Org-level roles live in
  // org_members and are unaffected. Both routes require an admin caller.
  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    try {
      const me = await storage.getUser(req.user.claims.sub);
      if (me?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const allUsers = await storage.listUsers();
      res.json(allUsers);
    } catch (error) {
      logError("Error listing users:", error);
      res.status(500).json({ message: "Failed to list users" });
    }
  });

  app.post("/api/admin/users/:id/role", isAuthenticated, async (req: any, res) => {
    try {
      const me = await storage.getUser(req.user.claims.sub);
      if (me?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const targetId = req.params.id;
      const { role } = req.body ?? {};
      if (typeof role !== "string") {
        return res.status(400).json({ message: "role is required" });
      }

      const target = await storage.getUser(targetId);
      if (!target) {
        return res.status(404).json({ message: "User not found" });
      }

      const adminCount = await storage.countAdminUsers();
      const check = validateRoleChange({
        actorId: me.id,
        targetId,
        newRole: role,
        targetCurrentRole: target.role,
        adminCount,
      });
      if (!check.ok) {
        return res.status(check.status).json({ message: check.message });
      }

      const updated = await storage.setUserRole(targetId, role);
      res.json(updated);
    } catch (error) {
      logError("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.get("/api/admin/disputes", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const disputes = await storage.listDisputes({ status, limit });
      res.json(disputes);
    } catch (err: any) {
      logError("Error listing disputes:", err);
      res.status(500).json({ message: err?.message || "Failed to list disputes" });
    }
  });

  app.post("/api/admin/disputes/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const disputeId = parseInt(req.params.id, 10);
      if (!Number.isFinite(disputeId) || disputeId <= 0) {
        return res.status(400).json({ message: "Invalid dispute id" });
      }
      const refundCentsRaw = Number(req.body?.refundCents);
      if (!Number.isFinite(refundCentsRaw) || refundCentsRaw < 0) {
        return res.status(400).json({ message: "refundCents must be a non-negative integer" });
      }
      const refundCents = Math.floor(refundCentsRaw);

      const updated = await storage.approveDispute(disputeId, userId, refundCents);

      recordAudit({
        actorUserId: userId,
        action: "dispute.approve",
        targetKind: "dispute",
        targetId: String(disputeId),
        metadata: {
          orderId: updated.orderId,
          refundCents: updated.refundCents,
          requestedRefundCents: refundCents,
        },
      }).catch(err => logError("[audit] failed:", err));

      res.json(updated);
    } catch (err: any) {
      if (/not found/i.test(err?.message ?? "")) {
        return res.status(404).json({ message: err.message });
      }
      if (/cannot be approved|already/i.test(err?.message ?? "")) {
        return res.status(409).json({ message: err.message });
      }
      logError("Error approving dispute:", err);
      res.status(500).json({ message: err?.message || "Failed to approve dispute" });
    }
  });

  app.post("/api/admin/disputes/:id/deny", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const disputeId = parseInt(req.params.id, 10);
      if (!Number.isFinite(disputeId) || disputeId <= 0) {
        return res.status(400).json({ message: "Invalid dispute id" });
      }

      const updated = await storage.denyDispute(disputeId, userId);

      recordAudit({
        actorUserId: userId,
        action: "dispute.deny",
        targetKind: "dispute",
        targetId: String(disputeId),
        metadata: { orderId: updated.orderId },
      }).catch(err => logError("[audit] failed:", err));

      res.json(updated);
    } catch (err: any) {
      if (/not found/i.test(err?.message ?? "")) {
        return res.status(404).json({ message: err.message });
      }
      if (/cannot be denied|already/i.test(err?.message ?? "")) {
        return res.status(409).json({ message: err.message });
      }
      logError("Error denying dispute:", err);
      res.status(500).json({ message: err?.message || "Failed to deny dispute" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Lead replacement / trade-in credits (Wave 7 — T1)
  //
  // When the K3 dialer logs 3+ unsuccessful attempts on a purchased lead
  // (or the nightly DNC re-check flags the consumer phone), we auto-issue
  // a 50%-of-price trade-in credit instead of forcing the buyer to file a
  // dispute. Idempotent: a second check returns "already_credited".
  // Agent-only — the route requires the requester to own the order.
  // ──────────────────────────────────────────────────────
  app.post("/api/orders/:orderId/check-replacement", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }

      const order = await storage.getOrderById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== userId) {
        const u = await storage.getUser(userId);
        if (u?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      // Throttle so a UI retry storm can't hammer the dialer log scan.
      if (!(await takeToken(`replacement:${userId}`, 30, 10 / 60))) {
        return res.status(429).json({ message: "Too many replacement checks" });
      }

      const deps: ReplacementDeps = {
        getOrder: (id) => storage.getOrderById(id),
        getCallLogsForOrder: (id) => storage.getCallLogsForOrder(id),
        getCreditForOrder: (id) => storage.getTradeInCreditByOrderId(id),
        createTradeInCredit: (input) => storage.createTradeInCredit(input),
        redeemTradeInCredit: (cid, lid) => storage.redeemTradeInCredit(cid, lid),
        recordAudit: (input) =>
          recordAudit({
            actorUserId: input.actorUserId,
            action: input.action,
            targetKind: input.targetKind ?? null,
            targetId: input.targetId ?? null,
            metadata: input.metadata ?? null,
          }),
      };

      const result = await autoIssueReplacement(orderId, deps);
      // Idempotent: 200 in all "shaped" cases. The body carries `issued`.
      if (result.issued) {
        return res.status(201).json(result);
      }
      // Surface a 409 only when the credit already exists — every other
      // ineligibility (too old, no bad signal, …) stays a 200 so the UI
      // can render a friendly "not eligible" state without trapping errors.
      if (result.reason === "already_credited") {
        const existing = await storage.getTradeInCreditByOrderId(orderId);
        return res.status(200).json({ issued: false, reason: result.reason, credit: existing });
      }
      return res.status(200).json(result);
    } catch (err: any) {
      logError("Error checking replacement eligibility:", err);
      res.status(500).json({ message: err?.message || "Failed to check replacement eligibility" });
    }
  });

  // Dry-run: return eligibility without issuing.
  app.get("/api/orders/:orderId/replacement-eligibility", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order id" });
      }
      const order = await storage.getOrderById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== userId) {
        const u = await storage.getUser(userId);
        if (u?.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      }
      const proposal = await proposeReplacementCredit(orderId, {
        getOrder: (id) => storage.getOrderById(id),
        getCallLogsForOrder: (id) => storage.getCallLogsForOrder(id),
        getCreditForOrder: (id) => storage.getTradeInCreditByOrderId(id),
        createTradeInCredit: (input) => storage.createTradeInCredit(input),
        redeemTradeInCredit: (cid, lid) => storage.redeemTradeInCredit(cid, lid),
      });
      return res.json(proposal);
    } catch (err: any) {
      logError("Error fetching replacement eligibility:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch eligibility" });
    }
  });

  // List the caller's available trade-in credits (top of orders page).
  app.get("/api/tradein/credits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rows = await storage.listTradeInCreditsForUser(userId);
      res.json(rows);
    } catch (err: any) {
      logError("Error listing trade-in credits:", err);
      res.status(500).json({ message: err?.message || "Failed to list credits" });
    }
  });

  // Redeem a credit against a new lead purchase. Body: { leadId }.
  app.post("/api/tradein/:creditId/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const creditId = parseInt(req.params.creditId, 10);
      if (!Number.isFinite(creditId) || creditId <= 0) {
        return res.status(400).json({ message: "Invalid credit id" });
      }
      const leadId = Number(req.body?.leadId);
      if (!Number.isFinite(leadId) || leadId <= 0) {
        return res.status(400).json({ message: "leadId is required" });
      }

      const credit = await storage.getTradeInCreditById(creditId);
      if (!credit) return res.status(404).json({ message: "Credit not found" });
      if (credit.agentUserId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (credit.status !== "issued") {
        return res.status(409).json({ message: `Credit ${credit.status}` });
      }
      if (credit.expiresAt && new Date(credit.expiresAt).getTime() < Date.now()) {
        return res.status(409).json({ message: "Credit expired" });
      }

      const redeemed = await storage.redeemTradeInCredit(creditId, leadId);

      // Audit the redemption. The lead purchase itself is a separate call
      // (the client-side flow purchases the lead after the credit is locked
      // in); we record the linkage so an admin can trace the discount.
      await recordAudit({
        actorUserId: userId,
        action: "tradein_credit.redeemed",
        targetKind: "credit",
        targetId: String(creditId),
        metadata: { leadId, creditCents: redeemed.creditCents },
      });

      res.json(redeemed);
    } catch (err: any) {
      logError("Error redeeming credit:", err);
      if (/not redeemable/i.test(err?.message ?? "")) {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err?.message || "Failed to redeem credit" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Smart-Match Subscriptions (Wave 7 — T3)
  //
  // Flat-rate monthly plan: "give me N matching leads/month". Subscriptions
  // are created against a fixed tier table; the ingest path auto-delivers
  // matching leads to the highest-remaining-quota subscriber.
  // ──────────────────────────────────────────────────────
  app.get("/api/smart-match/tiers", (_req, res) => {
    res.json({ tiers: SMART_MATCH_TIERS });
  });

  app.post("/api/smart-match", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const quotaRaw = Number(req.body?.monthlyLeadQuota);
      const filterRaw = req.body?.filterCriteria;
      if (!Number.isFinite(quotaRaw)) {
        return res.status(400).json({ message: "monthlyLeadQuota required" });
      }
      const tier = SMART_MATCH_TIERS.find(t => t.quota === quotaRaw);
      if (!tier) {
        return res.status(400).json({
          message: `Invalid quota; must be one of: ${SMART_MATCH_TIERS.map(t => t.quota).join(", ")}`,
        });
      }
      if (filterRaw && (typeof filterRaw !== "object" || Array.isArray(filterRaw))) {
        return res.status(400).json({ message: "filterCriteria must be an object" });
      }

      // Rate-limit subscription creation to thwart spam-create / mis-clicks.
      if (!(await takeToken(`smartmatch-create:${userId}`, 5, 1 / 60))) {
        return res.status(429).json({ message: "Too many subscription attempts" });
      }

      const created = await storage.createSmartMatchSubscription({
        agentUserId: userId,
        monthlyLeadQuota: tier.quota,
        monthlyPriceCents: tier.priceCents,
        filterCriteria: (filterRaw ?? {}) as Record<string, unknown>,
      });

      recordAudit({
        actorUserId: userId,
        action: "smartmatch.create",
        targetKind: "smart_match_subscription",
        targetId: String(created.id),
        metadata: { quota: tier.quota, priceCents: tier.priceCents },
      }).catch(err => logError("[audit] failed:", err));

      res.status(201).json(created);
    } catch (err: any) {
      logError("Error creating smart-match subscription:", err);
      res.status(500).json({ message: err?.message || "Failed to create subscription" });
    }
  });

  app.get("/api/smart-match", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const subs = await storage.listSmartMatchSubscriptions(userId);
      res.json(subs);
    } catch (err: any) {
      logError("Error listing smart-match subscriptions:", err);
      res.status(500).json({ message: err?.message || "Failed to list subscriptions" });
    }
  });

  app.delete("/api/smart-match/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid subscription id" });
      }
      const cancelled = await storage.cancelSmartMatchSubscription(id, userId);
      if (!cancelled) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      recordAudit({
        actorUserId: userId,
        action: "smartmatch.cancel",
        targetKind: "smart_match_subscription",
        targetId: String(id),
      }).catch(err => logError("[audit] failed:", err));
      res.json(cancelled);
    } catch (err: any) {
      logError("Error cancelling smart-match subscription:", err);
      res.status(500).json({ message: err?.message || "Failed to cancel subscription" });
    }
  });

  // ──────────────────────────────────────────────────────
  // TCPA defense insurance (Wave 6b — K2)
  // ──────────────────────────────────────────────────────
  // Orgs hold at most one active policy at a time. Members file claims
  // against it for litigation/defense costs; platform admins approve or
  // deny. Per-claim and aggregate limits are enforced in storage.
  app.post("/api/orgs/:orgId/tcpa-policy", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }

      const { carrierName, perClaimLimitCents, aggregateLimitCents, endsAt } = req.body ?? {};
      const carrier = typeof carrierName === "string" ? carrierName.trim() || null : null;
      const perClaim = perClaimLimitCents !== undefined ? Number(perClaimLimitCents) : undefined;
      const aggregate = aggregateLimitCents !== undefined ? Number(aggregateLimitCents) : undefined;
      if (perClaim !== undefined && (!Number.isFinite(perClaim) || perClaim < 0)) {
        return res.status(400).json({ message: "perClaimLimitCents must be a non-negative integer" });
      }
      if (aggregate !== undefined && (!Number.isFinite(aggregate) || aggregate < 0)) {
        return res.status(400).json({ message: "aggregateLimitCents must be a non-negative integer" });
      }
      let endsAtDate: Date | null = null;
      if (endsAt) {
        const d = new Date(endsAt);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "endsAt must be a valid date" });
        }
        endsAtDate = d;
      }

      const policy = await storage.createTcpaPolicy({
        orgId,
        carrierName: carrier,
        perClaimLimitCents: perClaim,
        aggregateLimitCents: aggregate,
        endsAt: endsAtDate,
      });

      recordAudit({
        actorUserId: userId,
        orgId,
        action: "tcpa_policy.create",
        targetKind: "tcpa_policy",
        targetId: String(policy.id),
        metadata: {
          carrierName: policy.carrierName,
          perClaimLimitCents: policy.perClaimLimitCents,
          aggregateLimitCents: policy.aggregateLimitCents,
        },
      }).catch(err => logError("[audit] failed:", err));

      res.status(201).json(policy);
    } catch (err: any) {
      logError("Error creating TCPA policy:", err);
      res.status(500).json({ message: err?.message || "Failed to create policy" });
    }
  });

  app.get("/api/orgs/:orgId/tcpa-policy", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) {
        return res.status(403).json({ message: "Not a member of this organization" });
      }
      const policy = await storage.getActivePolicyForOrg(orgId);
      res.json(policy ?? null);
    } catch (err: any) {
      logError("Error fetching TCPA policy:", err);
      res.status(500).json({ message: err?.message || "Failed to fetch policy" });
    }
  });

  app.post("/api/orgs/:orgId/tcpa-claims", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) {
        return res.status(403).json({ message: "Not a member of this organization" });
      }

      const claimReason = typeof req.body?.claimReason === "string" ? req.body.claimReason.trim() : "";
      const amountClaimedRaw = Number(req.body?.amountClaimedCents);
      const orderIdRaw = req.body?.orderId;
      if (!claimReason) {
        return res.status(400).json({ message: "claimReason is required" });
      }
      if (!Number.isFinite(amountClaimedRaw) || amountClaimedRaw <= 0) {
        return res.status(400).json({ message: "amountClaimedCents must be a positive integer" });
      }
      const orderId = orderIdRaw === undefined || orderIdRaw === null || orderIdRaw === ""
        ? null
        : Number(orderIdRaw);
      if (orderId !== null && (!Number.isFinite(orderId) || orderId <= 0)) {
        return res.status(400).json({ message: "orderId must be a positive integer if provided" });
      }

      const claim = await storage.fileTcpaClaim({
        orgId,
        agentUserId: userId,
        claimReason,
        amountClaimedCents: Math.floor(amountClaimedRaw),
        orderId,
      });
      res.status(201).json(claim);
    } catch (err: any) {
      if (/no active TCPA policy/i.test(err?.message ?? "")) {
        return res.status(409).json({ message: err.message });
      }
      logError("Error filing TCPA claim:", err);
      res.status(500).json({ message: err?.message || "Failed to file claim" });
    }
  });

  app.get("/api/orgs/:orgId/tcpa-claims", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) {
        return res.status(403).json({ message: "Not a member of this organization" });
      }
      const claims = await storage.listTcpaClaims(orgId);
      res.json(claims);
    } catch (err: any) {
      logError("Error listing TCPA claims:", err);
      res.status(500).json({ message: err?.message || "Failed to list claims" });
    }
  });

  app.post("/api/admin/tcpa-claims/:id/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const claimId = parseInt(req.params.id, 10);
      if (!Number.isFinite(claimId) || claimId <= 0) {
        return res.status(400).json({ message: "Invalid claim id" });
      }
      const action = req.body?.action;
      if (action !== "approved" && action !== "denied") {
        return res.status(400).json({ message: "action must be 'approved' or 'denied'" });
      }
      let amountPaidCents: number | undefined;
      if (action === "approved") {
        const raw = Number(req.body?.amountPaidCents);
        if (!Number.isFinite(raw) || raw <= 0) {
          return res.status(400).json({ message: "amountPaidCents must be a positive integer for approvals" });
        }
        amountPaidCents = Math.floor(raw);
      }

      const updated = await storage.resolveTcpaClaim({ claimId, action, amountPaidCents });

      recordAudit({
        actorUserId: userId,
        action: `tcpa_claim.${action === "approved" ? "approve" : "deny"}`,
        targetKind: "tcpa_claim",
        targetId: String(claimId),
        metadata: {
          policyId: updated.policyId,
          amountClaimedCents: updated.amountClaimedCents,
          amountPaidCents: updated.amountPaidCents,
        },
      }).catch(err => logError("[audit] failed:", err));

      res.json(updated);
    } catch (err: any) {
      if (/not found/i.test(err?.message ?? "")) {
        return res.status(404).json({ message: err.message });
      }
      if (/cannot be re-resolved|aggregate limit|positive integer|Per-claim limit/i.test(err?.message ?? "")) {
        return res.status(409).json({ message: err.message });
      }
      logError("Error resolving TCPA claim:", err);
      res.status(500).json({ message: err?.message || "Failed to resolve claim" });
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
      logError("Error creating Stripe checkout:", error);
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
      logError("Error fetching Stripe session:", error);
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

      const result = await ingestLeadForVendor(
        { id: vendor.id, name: vendor.name, orgId: vendor.orgId ?? null },
        data,
      );
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      logError("Error ingesting lead:", error);
      res.status(500).json({ message: error.message || "Failed to ingest lead" });
    }
  });

  // Ping-post step 1: vendor submits non-PII attributes, gets a binding price
  // quote + a signed, expiring offer token.
  app.post("/api/v1/leads/ping", async (req: any, res) => {
    try {
      const auth = await authVendorForPingPost(req, res, "ping", 200, 20);
      if (!auth) return;
      const { vendor, secret } = auth;

      const b = req.body ?? {};
      const attrs: PingAttributes = {
        type: String(b.type ?? ""),
        state: String(b.state ?? ""),
        exclusivity: String(b.exclusivity ?? "Shared"),
        mediscoreEstimate: b.mediscoreEstimate === undefined ? undefined : Number(b.mediscoreEstimate),
        intentScore: b.intentScore === undefined ? undefined : Number(b.intentScore),
        hasPhone: !!b.hasPhone,
        hasConsent: !!b.hasConsent,
      };
      const basePrice = Number(b.basePrice) || 25;
      const decision = evaluatePing(attrs, {
        basePrice,
        secret,
        pingId: createHash("sha256").update(`${vendor.id}:${Date.now()}`).digest("hex").slice(0, 24),
        demandIndex: b.demandIndex === undefined ? undefined : Number(b.demandIndex),
      });
      return res.status(decision.accept ? 200 : 422).json(decision);
    } catch (error: any) {
      logError("Error handling ping:", error);
      res.status(500).json({ message: "Failed to handle ping" });
    }
  });

  // Ping-post step 2: vendor submits the full lead + the offer token from /ping.
  // The token is verified (authenticity + not expired + same type/state) before
  // the lead runs through the shared ingest pipeline.
  app.post("/api/v1/leads/post", async (req: any, res) => {
    try {
      const auth = await authVendorForPingPost(req, res, "post", 100, 10);
      if (!auth) return;
      const { vendor, secret } = auth;

      const token = req.body?.token as string;
      const offer = verifyOffer(token, secret);
      if (!offer.valid) {
        return res.status(401).json({ message: `Invalid offer token: ${offer.reason}` });
      }

      const validation = vendorLeadIngestSchema.safeParse(req.body?.lead);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }
      const data = validation.data;

      // The posted lead must match the offer it claims.
      if (data.type !== offer.payload!.type || data.state.toUpperCase() !== offer.payload!.state) {
        return res.status(409).json({ message: "Posted lead does not match the offer (type/state mismatch)" });
      }

      // Honor the quoted price so the vendor is billed exactly what was offered.
      // Build a typed copy rather than mutating the validated object via `any`.
      const leadData = { ...data, price: Number(offer.payload!.bidPrice) };

      const result = await ingestLeadForVendor(vendor, leadData);
      return res.status(result.status).json({ ...result.body, pricePaid: offer.payload!.bidPrice });
    } catch (error: any) {
      logError("Error handling post:", error);
      res.status(500).json({ message: "Failed to handle post" });
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
      logError("Error listing orgs:", err);
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
      logError("Error creating org:", err);
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
      logError("Error activating org:", err);
      res.status(500).json({ message: "Failed to activate organization" });
    }
  });

  // List vendors so the org-admin UI can pick one when minting a key.
  app.get("/api/vendors", isAuthenticated, async (_req, res) => {
    try {
      const vendors = await storage.getVendors();
      res.json(vendors);
    } catch (err) {
      logError("Error listing vendors:", err);
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
      }).catch(err => logError("[audit] failed:", err));
      res.status(201).json({ apiKey: key, keyId: record.id, keyPrefix: record.keyPrefix });
    } catch (err) {
      logError("Error creating vendor API key:", err);
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
      logError("Error listing vendor API keys:", err);
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
      logError("Error revoking vendor API key:", err);
      res.status(500).json({ message: "Failed to revoke API key" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Wave 6 (K4) — CRM connections (per-org) + inbound webhook
  // ──────────────────────────────────────────────────────
  app.get("/api/orgs/:orgId/crm-connections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (!role) return res.status(403).json({ message: "Org membership required" });
      const rows = await storage.getCrmConnectionsForOrg(orgId);
      // Never leak access tokens to the client. The UI only needs to know
      // which providers are connected and when.
      const safe = rows.map(r => ({
        id: r.id,
        provider: r.provider,
        status: r.status,
        createdAt: r.createdAt,
        externalAccountId: r.externalAccountId,
      }));
      res.json({ connections: safe, providers: listProviders() });
    } catch (err) {
      logError("Error listing CRM connections:", err);
      res.status(500).json({ message: "Failed to list CRM connections" });
    }
  });

  app.post("/api/orgs/:orgId/crm-connections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const schema = z.object({
        provider: z.enum(["hubspot", "salesforce", "ghl", "pipedrive"]),
        accessToken: z.string().min(1),
        refreshToken: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: fromError(parsed.error).toString() });
      }
      // TODO(K4 follow-up): real OAuth code-exchange. For now we accept the
      // raw token so the rest of the integration is wireable end-to-end.
      if (!getCrmAdapter(parsed.data.provider)) {
        return res.status(400).json({ message: "Unsupported provider" });
      }
      const conn = await storage.createCrmConnection({
        orgId,
        provider: parsed.data.provider,
        accessToken: parsed.data.accessToken,
        refreshToken: parsed.data.refreshToken ?? null,
      });
      recordAudit({
        actorUserId: userId,
        orgId,
        action: "crm.connect",
        targetKind: "crm_connection",
        targetId: String(conn.id),
        metadata: { provider: conn.provider },
      }).catch(e => logError("[audit] failed:", e));
      res.status(201).json({
        id: conn.id,
        provider: conn.provider,
        status: conn.status,
        createdAt: conn.createdAt,
      });
    } catch (err) {
      logError("Error creating CRM connection:", err);
      res.status(500).json({ message: "Failed to create CRM connection" });
    }
  });

  app.delete("/api/orgs/:orgId/crm-connections/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId, id } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const connectionId = parseInt(id, 10);
      if (!Number.isFinite(connectionId)) {
        return res.status(400).json({ message: "Invalid connection id" });
      }
      const ok = await storage.deleteCrmConnection(connectionId, orgId);
      if (!ok) return res.status(404).json({ message: "Connection not found" });
      recordAudit({
        actorUserId: userId,
        orgId,
        action: "crm.disconnect",
        targetKind: "crm_connection",
        targetId: String(connectionId),
      }).catch(e => logError("[audit] failed:", e));
      res.json({ deleted: true });
    } catch (err) {
      logError("Error deleting CRM connection:", err);
      res.status(500).json({ message: "Failed to delete CRM connection" });
    }
  });

  // Inbound CRM webhook.
  //
  // Shared-secret HMAC guard via verifyCrmWebhook — the operator sets
  // CRM_WEBHOOK_SECRET and the sending CRM (or a thin proxy) signs the
  // body with HMAC-SHA256 in X-LCP-Signature. When unset, we pass
  // through with a one-time warning so dev / E2E stay green; the
  // prod-env validator gates this in production.
  //
  // Provider-native signatures (HubSpot v3 HMAC over method+URI+body
  // +timestamp, Salesforce platform-event cert, GHL secret, Pipedrive
  // basic auth) are a per-provider follow-up that bolts on top of this
  // guard — each one needs its own contract decision.
  app.post("/api/crm/webhook/:provider", async (req: any, res) => {
    try {
      // Rate limit by source IP. Real CRMs (HubSpot, Salesforce, GHL,
      // Pipedrive) come from a small set of egress ranges, so a burst
      // of 100/min per IP covers normal load + retry storms. The
      // signature gate below is the real correctness guarantee; this
      // is purely a DoS / abuse-cost ceiling on unsigned bodies.
      const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);
      if (!(await takeToken(`crm-webhook:${ip}`, 100, 100 / 60))) {
        return res.status(429).json({ message: "Rate limited" });
      }

      const { provider } = req.params;
      if (!getCrmAdapter(provider)) {
        return res.status(404).json({ message: "Unknown provider" });
      }

      // Never reconstruct the body from req.body — JSON.stringify can produce
      // different bytes than what the CRM signed (key order, whitespace,
      // numeric formatting), guaranteeing silent verification failures.
      // express.json's verify callback (server/index.ts) populates rawBody
      // on every JSON request; if it's missing here we're misconfigured.
      const rawBody = req.rawBody as Buffer | undefined;

      // Provider-native signature verification first — strictly
      // stronger than the shared HMAC because it uses provider-issued
      // secrets (HubSpot V3 HMAC of method+url+body+timestamp, GHL
      // x-wh-signature, Pipedrive Basic Auth). When the native check
      // passes we trust the provider; when it fails outright we reject;
      // when it returns "not-supported" (Salesforce, unknown providers)
      // or "secret-not-configured" we fall back to the shared HMAC.
      const native = verifyCrmByProvider(provider, {
        rawBody,
        headers: req.headers,
        method: req.method,
        url: req.originalUrl ?? req.url,
      });
      if (native.ok && native.verified === true) {
        // Native check passed; bypass the shared HMAC.
      } else if (!native.ok) {
        return res.status(native.status).json({ message: "Webhook signature check failed", reason: native.reason, provider: native.provider });
      } else {
        // native.verified === false → "not-supported" or
        // "secret-not-configured". Fall back to the shared HMAC guard.
        const verify = verifyCrmWebhook(rawBody, req.headers);
        if (!verify.ok) {
          return res.status(verify.status).json({ message: "Webhook signature check failed", reason: verify.reason });
        }
      }

      const result = await handleInboundWebhook(provider, req.body, { storage });
      res.json(result);
    } catch (err) {
      logError("Error handling CRM webhook:", err);
      res.status(500).json({ message: "Failed to process webhook" });
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
      logError("Error updating routing threshold:", err);
      res.status(500).json({ message: "Failed to update threshold" });
    }
  });

  // A2 — Spend Caps. Org owner/admin reads or sets a member's monthly lead-
  // spend ceiling (in cents; null = uncapped). Enforced in the purchase path.

  // Bulk read of every member's cap ({ [userId]: capCents | null }) so the
  // admin UI avoids an N+1 per-agent fan-out.
  app.get("/api/orgs/:orgId/spend-caps", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(requesterId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      res.json(await storage.getOrgMemberSpendCaps(orgId));
    } catch (err) {
      logError("Error reading org spend caps:", err);
      res.status(500).json({ message: "Failed to read spend caps" });
    }
  });

  app.get("/api/orgs/:orgId/members/:userId/spend-cap", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user.claims.sub;
      const { orgId, userId } = req.params;
      const role = await storage.getUserOrgRole(requesterId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      if (!(await storage.getUserOrgRole(userId, orgId))) {
        return res.status(404).json({ message: "Member not found in this org" });
      }
      const capCents = await storage.getMemberSpendCap(orgId, userId);
      res.json({ capCents });
    } catch (err) {
      logError("Error reading spend cap:", err);
      res.status(500).json({ message: "Failed to read spend cap" });
    }
  });

  app.patch("/api/orgs/:orgId/members/:userId/spend-cap", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user.claims.sub;
      const { orgId, userId } = req.params;
      const role = await storage.getUserOrgRole(requesterId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const targetRole = await storage.getUserOrgRole(userId, orgId);
      if (!targetRole) {
        return res.status(404).json({ message: "Member not found in this org" });
      }
      // Governance: spend caps apply to agents only. This keeps an owner/admin
      // from capping themselves or a peer to 0 (which — with exceedsCap's
      // strict `>` — would reject every purchase) and locking each other out.
      if (targetRole !== "agent") {
        return res.status(400).json({ message: "Spend caps apply to agent members only" });
      }
      if (!req.body || !("capCents" in req.body)) {
        return res.status(400).json({ message: "capCents is required (whole cents, or null to clear the cap)" });
      }
      const raw = req.body.capCents;
      let capCents: number | null;
      if (raw === null) {
        capCents = null;
      } else if (
        // Require a real number — Number(raw) would coerce true→1, [50]→50,
        // ""→0, etc., silently applying a garbage cap on a money-path setting.
        typeof raw !== "number" ||
        !Number.isInteger(raw) ||
        raw < 0 ||
        // Bound by the PG `integer` range so a huge value can't overflow the
        // column (max int4 = 2,147,483,647 cents ≈ $21.4M/month).
        raw > 2_147_483_647
      ) {
        return res
          .status(400)
          .json({ message: "capCents must be an integer between 0 and 2147483647, or null" });
      } else {
        capCents = raw;
      }
      const previousCapCents = await storage.getMemberSpendCap(orgId, userId);
      const updated = await storage.setMemberSpendCap(orgId, userId, capCents);
      if (!updated) {
        // Membership vanished between the check above and the write.
        return res.status(404).json({ message: "Member not found in this org" });
      }
      // Money-path governance: attribute who changed the cap, and to what.
      recordAudit({
        actorUserId: requesterId,
        orgId,
        action: "spend_cap.update",
        targetKind: "org_member",
        targetId: userId,
        metadata: { capCents, previousCapCents },
      }).catch((e) => logError("Error recording spend-cap audit:", e));
      res.json({ capCents });
    } catch (err) {
      logError("Error updating spend cap:", err);
      res.status(500).json({ message: "Failed to update spend cap" });
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
      logError("Error fetching agent profile:", err);
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

      // TCPA attestation gate. The client UI requires the checkbox before
      // Save and won't include the field if unchecked, but a server-side
      // gate keeps API users honest. Record an audit row so we have a
      // dated acknowledgement to point at if a consumer complaint surfaces
      // months later.
      const tcpaAttested = req.body?.tcpaAttested === true;
      if (!tcpaAttested) {
        return res.status(400).json({ message: "TCPA attestation required" });
      }
      await recordAudit({
        actorUserId: userId,
        orgId: me.activeOrgId,
        action: "agent.tcpa_attestation",
        targetKind: "user",
        targetId: userId,
        metadata: {
          attestedAt: typeof req.body?.tcpaAttestedAt === "string" ? req.body.tcpaAttestedAt : new Date().toISOString(),
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
        },
      }).catch(() => { /* recordAudit swallows its own errors */ });

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

      // Fire-and-forget NIPR verification. Onboarding must succeed even when
      // NIPR is unreachable; the result is cached on the profile and shown
      // in the UI on next poll.
      verifyAgentLicense(userId).catch(err =>
        logError("[nipr] background verify failed:", err),
      );

      res.json(profile);
    } catch (err) {
      logError("Error onboarding agent:", err);
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
      logError("Error fetching agent dashboard:", err);
      res.status(500).json({ message: "Failed to fetch dashboard" });
    }
  });

  // Agent self-service: update capacity and accepting-leads toggle without
  // re-running the full onboarding flow.
  app.patch("/api/agent/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getAgentProfile(userId);
      if (!profile) return res.status(404).json({ message: "No agent profile" });

      const schema = z.object({
        capacityLimit: z.number().int().min(1).max(500).optional(),
        acceptingLeads: z.boolean().optional(),
      }).refine(
        (v) => v.capacityLimit !== undefined || v.acceptingLeads !== undefined,
        { message: "Provide capacityLimit and/or acceptingLeads" },
      );

      const validation = schema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: fromError(validation.error).toString() });
      }

      const updated = await storage.updateAgentCapacity(userId, validation.data);
      res.json(updated);
    } catch (err) {
      logError("Error updating agent capacity:", err);
      res.status(500).json({ message: "Failed to update agent settings" });
    }
  });

  // Agent reputation (self-service).
  //
  // Returns the trailing-90d reputation score plus the recent event stream
  // so the dashboard can show a stat card and (optionally) drill-down history.
  app.get("/api/agent/me/reputation", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const score = await storage.computeAgentReputation(userId);
      const events = await storage.getReputationEvents(userId, 50);
      res.json({
        score,
        windowDays: REPUTATION_WINDOW_DAYS,
        events,
        weights: REPUTATION_WEIGHTS,
      });
    } catch (err) {
      logError("Error fetching reputation:", err);
      res.status(500).json({ message: "Failed to fetch reputation" });
    }
  });

  // Agent purchase streak (self-service retention nudge).
  //
  // Returns the CALLER's own streak only — there is no userId parameter, so one
  // agent can never read another's buying cadence. Consecutive UTC days with at
  // least one completed purchase; `current` stays alive through yesterday.
  app.get("/api/agent/streak", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const streak = await storage.getPurchaseStreak(userId);
      res.json(streak);
    } catch (err) {
      logError("Error fetching purchase streak:", err);
      res.status(500).json({ message: "Failed to fetch streak" });
    }
  });

  // Top agents in an org by reputation (owner/admin only). Used by the
  // org-admin leaderboard view. Excludes unverified agents and agents with
  // fewer than 3 events in the trailing 90 days (see TOP_AGENT_MIN_EVENTS).
  app.get("/api/orgs/:orgId/agents/top", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orgId } = req.params;
      const role = await storage.getUserOrgRole(userId, orgId);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ message: "Owner or admin role required" });
      }
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.trunc(rawLimit)) : 10;
      const top = await getTopAgentsForOrg(orgId, limit);
      res.json({ orgId, windowDays: REPUTATION_WINDOW_DAYS, agents: top });
    } catch (err) {
      logError("Error listing top agents:", err);
      res.status(500).json({ message: "Failed to list top agents" });
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
            if (next && next.agentUserId) {
              broadcastLeadAssignment({
                agentUserId: next.agentUserId,
                leadId: next.leadId,
                matchScore: next.matchScore,
              });
            }
          })
          .catch(err => logError("Re-route error:", err));
      }
      res.json(updated);
    } catch (err) {
      logError("Error updating assignment:", err);
      res.status(500).json({ message: "Failed to update assignment" });
    }
  });

  // ──────────────────────────────────────────────────────
  // K1 — Live auction endpoints
  // ──────────────────────────────────────────────────────

  // Agent clicks "Claim" during the 10s auction window.
  app.post("/api/auctions/:leadId/claim", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.leadId, 10);
      if (!Number.isFinite(leadId)) {
        return res.status(400).json({ message: "invalid leadId" });
      }
      const out = await storage.recordAuctionClaim(leadId, userId);
      if (!out.ok) return res.status(409).json({ message: out.reason ?? "claim rejected" });
      res.status(201).json({ claimId: out.claimId });
    } catch (err) {
      logError("Error recording claim:", err);
      res.status(500).json({ message: "Failed to record claim" });
    }
  });

  // Snapshot of the auction state (claims + overall status). Cheap poll
  // path for clients that miss the WS broadcast.
  app.get("/api/auctions/:leadId", isAuthenticated, async (req: any, res) => {
    try {
      const leadId = parseInt(req.params.leadId, 10);
      if (!Number.isFinite(leadId)) {
        return res.status(400).json({ message: "invalid leadId" });
      }
      const snap = await storage.getAuctionForLead(leadId);
      if (!snap) return res.status(404).json({ message: "no auction" });
      res.json(snap);
    } catch (err) {
      logError("Error fetching auction:", err);
      res.status(500).json({ message: "Failed to fetch auction" });
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
      logError("Error listing org agents:", err);
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
      }).catch(err => logError("[audit] failed:", err));
      res.json(updated);
    } catch (err) {
      logError("Error setting conversion rate:", err);
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
      }).catch(err => logError("[audit] failed:", err));
      res.json(updated);
    } catch (err) {
      logError("Error setting verification:", err);
      res.status(500).json({ message: "Failed to update verification" });
    }
  });

  // Admin re-trigger of NIPR/DOI license verification for an agent in their org.
  // Returns the verify result synchronously (it's a single HTTP call to NIPR,
  // not the background path used by onboarding).
  app.post("/api/agent/:userId/nipr/verify", isAuthenticated, async (req: any, res) => {
    try {
      const actorId = req.user.claims.sub;
      const targetUserId = req.params.userId;
      const target = await storage.getAgentProfile(targetUserId);
      if (!target) return res.status(404).json({ message: "Agent profile not found" });

      // Self-trigger always allowed; admins/owners can re-trigger for any
      // agent in their own org.
      if (actorId !== targetUserId) {
        const role = await storage.getUserOrgRole(actorId, target.orgId);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ message: "Owner or admin role required" });
        }
      }

      const result = await verifyAgentLicense(targetUserId);
      const updated = await storage.getAgentProfile(targetUserId);
      res.json({ result, profile: updated });
    } catch (err) {
      logError("Error re-verifying NIPR license:", err);
      res.status(500).json({ message: "Failed to verify license" });
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
      logError("Error creating subscription checkout:", err);
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
      logError("Error listing saved lists:", err);
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
      logError("Error creating saved list:", err);
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
      logError("Error fetching saved list:", err);
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
  // Saved-Search Alerts (wishlist)
  // ──────────────────────────────────────────────────────
  app.get("/api/saved-searches", isAuthenticated, async (req: any, res) => {
    try {
      const searches = await storage.listSavedSearches(req.user.claims.sub);
      res.json(searches);
    } catch (err) {
      logError("Error listing saved searches:", err);
      res.status(500).json({ message: "Failed to list saved searches" });
    }
  });

  app.post("/api/saved-searches", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      // Token-bucket limit (≈10/min) so a script can't mass-create searches.
      if (!(await takeToken(`saved-search-create:${userId}`, 10, 10 / 60))) {
        return res.status(429).json({ message: "Too many requests — slow down" });
      }
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "name required" });
      if (name.length > 200) return res.status(400).json({ message: "name too long" });

      const parsed = savedSearchCriteriaSchema.safeParse(req.body?.criteria ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: fromError(parsed.error).toString() });
      }
      const criteria: SavedSearchCriteria = parsed.data;

      // Require an active org: a null-org saved search would act as a global,
      // cross-tenant subscription (matching leads in every org).
      const me = await storage.getUser(userId);
      if (!me?.activeOrgId) {
        return res.status(400).json({ message: "An active organization is required to create a saved search" });
      }

      // Cap active saved searches per user to bound per-ingest notification
      // fan-out. Enforced transactionally inside createSavedSearch (advisory
      // lock) so a concurrent burst can't race past the cap.
      let search;
      try {
        search = await storage.createSavedSearch(
          { userId, orgId: me.activeOrgId, name, criteria },
          { maxActive: MAX_SAVED_SEARCHES },
        );
      } catch (e: any) {
        if (e?.message === ERR_SAVED_SEARCH_CAP) {
          return res
            .status(409)
            .json({ message: `You can have at most ${MAX_SAVED_SEARCHES} active saved searches` });
        }
        throw e;
      }
      res.status(201).json(search);
    } catch (err) {
      logError("Error creating saved search:", err);
      res.status(500).json({ message: "Failed to create saved search" });
    }
  });

  app.delete("/api/saved-searches/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid saved search id" });
      }
      const deleted = await storage.deleteSavedSearch(id, req.user.claims.sub);
      if (deleted === 0) {
        return res.status(404).json({ message: "Saved search not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      logError("Error deleting saved search:", err);
      res.status(500).json({ message: "Failed to delete saved search" });
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
      logError("Error tracking event:", err);
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
      logError("Error computing MediScore:", err);
      res.status(500).json({ message: "Failed to compute MediScore" });
    }
  });

  app.get("/api/signals/keywords/top", async (_req, res) => {
    try {
      const rows = await getTopOpportunityKeywords(20);
      res.json(rows);
    } catch {
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
      logError("Funnel error:", err);
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
      logError("Lead analytics error:", err);
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

  // Manually trigger a MediScore calibration run and inspect active weights.
  app.post("/api/admin/mediscore/calibrate", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      const result = await runMediscoreCalibration();
      res.json({ ran: !!result, meta: getActiveCalibratedWeightsMeta(), result });
    } catch (err: any) {
      logError("Error running MediScore calibration:", err);
      res.status(500).json({ message: err.message || "Calibration failed" });
    }
  });

  app.get("/api/admin/mediscore/calibration", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      res.json(getActiveCalibratedWeightsMeta());
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to read calibration status" });
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
      logError("Error refreshing signals:", err);
      res.status(500).json({ message: err.message || "Refresh failed" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Admin Routes
  // ──────────────────────────────────────────────────────

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
      logError("Error fetching admin stats:", error);
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
      logError("Error fetching admin leads:", error);
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
      }).catch(err => logError("[audit] failed:", err));
      res.json(lead);
    } catch (error) {
      logError("Error flagging lead:", error);
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
      }).catch(err => logError("[audit] failed:", err));
      res.json(lead);
    } catch (error) {
      logError("Error removing lead:", error);
      res.status(500).json({ message: "Failed to remove lead" });
    }
  });

  // Compliance/telephony service (MedicareCallForge) integration status.
  // Flag-gated + read-only: reports whether MCF is configured and, if so,
  // reachable. Inert until MCF_URL + MCF_SERVICE_SECRET are set (ADR-0002).
  app.get("/api/admin/compliance-service", isAuthenticated, async (req: any, res) => {
    try {
      const me = await storage.getUser(req.user.claims.sub);
      if (me?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const status = getComplianceServiceStatus();
      const reachable = status.enabled ? await pingComplianceService() : false;
      res.json({ ...status, reachable });
    } catch (error) {
      logError("Error checking compliance service:", error);
      res.status(500).json({ message: "Failed to check compliance service" });
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
      logError("Error fetching platform status:", error);
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
      }).catch(err => logError("[audit] failed:", err));
      res.json({ message: "Admin role assigned", user: updatedUser });
    } catch (error) {
      logError("Error seeding admin:", error);
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
      logError("Error listing audit log:", error);
      res.status(500).json({ message: "Failed to list audit log" });
    }
  });

  // Admin-only in-process metrics snapshot. Plain JSON so the operator
  // can curl it or wire it into a custom dashboard. For Prometheus-style
  // scraping, a follow-up can serialise the same counters into text format.
  app.get("/api/admin/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      res.json(getMetricsSnapshot());
    } catch (error) {
      logError("Error fetching metrics snapshot:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
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
      logError("Error broadcasting leads:", error);
      res.status(500).json({ message: "Failed to broadcast leads" });
    }
  });

  // Check current user's admin status
  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json({ isAdmin: user?.role === "admin" });
    } catch {
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
      logError("Vendor balances error:", err);
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
      logError("Vendor payout sweep error:", err);
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
      logError("Vendor payout log error:", err);
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
    } catch {
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  // Dynamic blog sitemap. The static /sitemap.xml in client/public
  // covers landing + pricing + legal pages. Blog post URLs live in
  // the DB and would drift fast — so we emit them here with real
  // lastmod values (updatedAt ?? publishedAt). Search engines find
  // this via the Sitemap: line in robots.txt.
  app.get("/blog-sitemap.xml", async (_req, res) => {
    try {
      const articles = await storage.getContentArticles(true);
      const base = process.env.APP_URL ?? "https://leadmarket.app";
      const body = buildBlogSitemap(articles, base);

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      // 1 hour cache — articles publish on a scheduled cron, so a
      // crawler hitting this multiple times a day is fine with stale
      // data within the hour.
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(body);
    } catch (err) {
      logError("blog-sitemap.xml error:", err);
      res.status(500).type("text/plain").send("sitemap generation failed");
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
      res.status(500).send("<?xml version='1.0'?><urlset/>");
    }
  });

  // ──────────────────────────────────────────────────────
  // Wave 6b (K3) — Click-to-call dialer + AI conversation assist
  // ──────────────────────────────────────────────────────

  // POST /api/dialer/call  — start a call from the agent to a lead.
  app.post("/api/dialer/call", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = Number(req.body?.leadId);
      if (!Number.isFinite(leadId) || leadId <= 0) {
        return res.status(400).json({ message: "leadId is required" });
      }
      // Wave 7 (T8) — real-time DNC re-check right before dialling. If the
      // phone is now on the suppression list we refuse the call and have
      // already updated lead.dncFlagged + written an audit row.
      const gate = await gateCallAgainstDnc(leadId, userId);
      if (!gate.allowed) {
        return res.status(403).json({
          message: gate.reason || "call blocked by DNC",
          dncBlocked: true,
        });
      }
      const result = await startCallForLead(userId, leadId);
      res.json(result);
    } catch (err: any) {
      logError("dialer.call error:", err);
      res.status(500).json({ message: err?.message || "Failed to start call" });
    }
  });

  // POST /api/dialer/webhook  — Twilio status callbacks.
  // Twilio posts application/x-www-form-urlencoded with CallSid + CallStatus.
  // We verify the X-Twilio-Signature when a real auth token is configured;
  // in stub mode (no token) we accept the event so dev/CI can drive it.
  app.post("/api/dialer/webhook", async (req: any, res) => {
    try {
      // Rate-limit before signature verification: an attacker spraying
      // forged callbacks at us shouldn't be able to burn CPU on HMAC
      // computation. 200/min per IP — Twilio retries can burst and
      // legitimate traffic comes from a narrow set of IP ranges.
      const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);
      if (!(await takeToken(`dialer-webhook:${ip}`, 200, 200 / 60))) {
        return res.status(429).json({ message: "Rate limited" });
      }

      const fullUrl = twilioWebhookUrl(req);
      const valid = verifyTwilioWebhook(
        { headers: req.headers, body: req.body, url: req.url },
        fullUrl,
      );
      if (!valid && isTwilioLive()) {
        return res.status(403).json({ message: "invalid signature" });
      }
      const sid: string | undefined = req.body?.CallSid;
      const status: string | undefined = req.body?.CallStatus;
      const duration = Number(req.body?.CallDuration);
      const recordingUrl: string | undefined = req.body?.RecordingUrl;
      if (!sid) return res.status(400).json({ message: "CallSid required" });

      // Look up call_log by twilioSid via a direct query (no method needed
      // — this is the only consumer).
      const { db } = await import("./db");
      const { callLogs } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await db.select().from(callLogs).where(eq(callLogs.twilioSid, sid));
      if (!row) {
        // Webhook arrived before our update; ack so Twilio doesn't retry.
        return res.json({ ok: true, ignored: true });
      }
      await storage.updateCallLog(row.id, {
        status: status || row.status,
        durationSec: Number.isFinite(duration) ? duration : undefined,
        recordingUrl: recordingUrl ?? undefined,
        endedAt: status === "completed" || status === "failed" || status === "no-answer" || status === "busy"
          ? new Date()
          : undefined,
      });
      res.json({ ok: true });
    } catch (err: any) {
      logError("dialer.webhook error:", err);
      res.status(500).json({ message: err?.message || "webhook failed" });
    }
  });

  // POST /api/dialer/transcript  — push live transcript chunks.
  // Body: { callLogId, text, partial? }. Authed: only the owning agent.
  app.post("/api/dialer/transcript", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const callLogId = Number(req.body?.callLogId);
      const text: string = String(req.body?.text ?? "").slice(0, 5000);
      const partial: boolean = Boolean(req.body?.partial);
      if (!Number.isFinite(callLogId) || !text.trim()) {
        return res.status(400).json({ message: "callLogId and text are required" });
      }
      const calls = await storage.getCallLogsForAgent(userId, { leadId: undefined, limit: 500 });
      const owns = calls.some((c) => c.id === callLogId);
      if (!owns) return res.status(403).json({ message: "not your call" });

      const transcriptRow = await storage.appendTranscript(callLogId, text);
      const result = await processTranscriptChunk(
        { callLogId, transcript: transcriptRow.text, partial },
        {
          recordAssist: (input) => storage.recordConversationAssist(input).then(() => undefined),
          broadcast: (payload) => broadcastAssistSuggestion(payload),
        },
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      logError("dialer.transcript error:", err);
      res.status(500).json({ message: err?.message || "transcript ingest failed" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Wave 7 (T5): Vendor performance scorecard
  // ──────────────────────────────────────────────────────

  // Vendor-key authed: a vendor sees their own scorecard.
  app.get("/api/vendors/me/scorecard", async (req: any, res) => {
    try {
      const apiKey = req.headers["x-api-key"] as string | undefined;
      if (!apiKey) {
        return res.status(401).json({ message: "API key required (X-Api-Key header)" });
      }
      const vendor = await storage.getVendorByApiKey(apiKey);
      if (!vendor) {
        return res.status(401).json({ message: "Invalid or inactive API key" });
      }
      // 30 reads / vendor / minute is plenty for a dashboard refresh.
      if (!(await takeToken(`scorecard:${vendor.id}`, 30, 1))) {
        return res.status(429).json({ message: "Rate limit exceeded" });
      }
      const { getVendorScorecard } = await import("./vendorScorecard");
      const card = await getVendorScorecard(vendor.id);
      res.json(card);
    } catch (err: any) {
      logError("vendor scorecard error:", err);
      res.status(500).json({ message: err?.message || "Failed to build scorecard" });
    }
  });

  // Platform admin: scorecard for any vendor by id.
  app.get("/api/admin/vendors/:vendorId/scorecard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      const vendorId = Number(req.params.vendorId);
      if (!Number.isFinite(vendorId) || vendorId <= 0) {
        return res.status(400).json({ message: "Invalid vendorId" });
      }
      const vendor = await storage.getVendor(vendorId);
      if (!vendor) {
        return res.status(404).json({ message: "Vendor not found" });
      }
      const { getVendorScorecard } = await import("./vendorScorecard");
      const card = await getVendorScorecard(vendorId);
      res.json({ vendor: { id: vendor.id, name: vendor.name }, ...card });
    } catch (err: any) {
      logError("admin vendor scorecard error:", err);
      res.status(500).json({ message: err?.message || "Failed to build scorecard" });
    }
  });

  // GET /api/dialer/calls?leadId=  — call history for the current agent.
  app.get("/api/dialer/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadIdRaw = req.query?.leadId;
      const leadId = leadIdRaw !== undefined ? Number(leadIdRaw) : undefined;
      if (leadIdRaw !== undefined && !Number.isFinite(leadId)) {
        return res.status(400).json({ message: "leadId must be a number" });
      }
      const calls = await storage.getCallLogsForAgent(userId, { leadId, limit: 100 });
      res.json(calls);
    } catch (err: any) {
      logError("dialer.calls error:", err);
      res.status(500).json({ message: err?.message || "failed to fetch calls" });
    }
  });

  // ──────────────────────────────────────────────────────
  // Wave 7 (T7) — SMS outreach
  // ──────────────────────────────────────────────────────

  // GET /api/sms/templates  — the canned template registry for the picker.
  app.get("/api/sms/templates", isAuthenticated, async (_req, res) => {
    res.json(listSmsTemplates());
  });

  // POST /api/sms/send  — render + dispatch a templated SMS.
  app.post("/api/sms/send", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = Number(req.body?.leadId);
      const templateKey = String(req.body?.templateKey ?? "");
      const variables =
        req.body?.variables && typeof req.body.variables === "object"
          ? (req.body.variables as Record<string, string>)
          : undefined;
      if (!Number.isFinite(leadId) || leadId <= 0) {
        return res.status(400).json({ message: "leadId is required" });
      }
      if (!templateKey) {
        return res.status(400).json({ message: "templateKey is required" });
      }
      const result = await sendOutreach({
        agentUserId: userId,
        leadId,
        templateKey,
        variables,
      });
      res.json(result);
    } catch (err: any) {
      // Map domain errors to HTTP codes the UI can interpret.
      if (err instanceof UnknownTemplateError) {
        return res.status(404).json({ message: err.message });
      }
      if (err instanceof InvalidPlaceholderError) {
        return res.status(400).json({ message: err.message });
      }
      if (err instanceof MissingPurchaseError) {
        return res.status(403).json({ message: "purchase required to message this lead" });
      }
      if (err instanceof OptedOutError) {
        return res.status(409).json({ message: "lead has opted out — STOP received within 30d" });
      }
      if (err instanceof RateLimitExceededError) {
        return res.status(429).json({ message: err.message });
      }
      if (err instanceof NoConsumerPhoneError) {
        return res.status(400).json({ message: err.message });
      }
      logError("sms.send error:", err);
      res.status(500).json({ message: err?.message || "failed to send sms" });
    }
  });

  // GET /api/sms/logs/:leadId  — agent's SMS history with a single lead.
  app.get("/api/sms/logs/:leadId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = Number(req.params?.leadId);
      if (!Number.isFinite(leadId) || leadId <= 0) {
        return res.status(400).json({ message: "leadId must be a positive number" });
      }
      const logs = await storage.listSmsLogsForLead(leadId, userId);
      res.json(logs);
    } catch (err: any) {
      logError("sms.logs error:", err);
      res.status(500).json({ message: err?.message || "failed to fetch sms logs" });
    }
  });

  // POST /api/sms/webhook  — Twilio inbound + status callback.
  // Verifies X-Twilio-Signature in live mode; in stub mode (no auth token)
  // we accept the event so dev/CI can drive the flow.
  app.post("/api/sms/webhook", async (req: any, res) => {
    try {
      // Same DoS-ceiling rationale as the dialer webhook — rate-limit
      // before HMAC verification so spray attacks can't burn CPU.
      const ip = String(req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0").slice(0, 64);
      if (!(await takeToken(`sms-webhook:${ip}`, 200, 200 / 60))) {
        return res.status(429).json({ message: "Rate limited" });
      }

      const fullUrl = twilioWebhookUrl(req);
      const valid = verifyTwilioWebhook(
        { headers: req.headers, body: req.body, url: req.url },
        fullUrl,
      );
      if (!valid && isTwilioLive()) {
        return res.status(403).json({ message: "invalid signature" });
      }
      const sid: string | undefined = req.body?.MessageSid;
      const status: string | undefined = req.body?.MessageStatus;
      const inboundBody: string | undefined = req.body?.Body;
      if (!sid) return res.status(400).json({ message: "MessageSid required" });

      // Status callback for an outbound message: update the existing row.
      if (status && !inboundBody) {
        const { db } = await import("./db");
        const { smsLogs } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(smsLogs)
          .set({ status })
          .where(eq(smsLogs.twilioSid, sid));
        return res.json({ ok: true });
      }

      // Inbound message from the consumer. Look up which lead/agent this is
      // for by matching the From phone to a recent outbound recipient.
      const fromPhone: string | undefined = req.body?.From;
      if (!fromPhone || !inboundBody) {
        return res.status(400).json({ message: "From and Body required for inbound" });
      }
      const { db } = await import("./db");
      const { leads } = await import("@shared/schema");
      const { smsLogs: smsLogsTable } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const [lead] = await db.select().from(leads).where(eq(leads.consumerPhone, fromPhone)).limit(1);
      if (!lead) {
        // Unrecognised phone — log anonymously and ack.
        return res.json({ ok: true, ignored: true });
      }
      // Find the most recent outbound log for that lead to attribute the
      // inbound message to the same agent.
      const [recent] = await db
        .select()
        .from(smsLogsTable)
        .where(eq(smsLogsTable.leadId, lead.id))
        .orderBy(desc(smsLogsTable.createdAt))
        .limit(1);
      const agentUserId = recent?.agentUserId;
      if (!agentUserId) {
        return res.json({ ok: true, ignored: true });
      }
      await storage.createSmsLog({
        agentUserId,
        leadId: lead.id,
        twilioSid: sid,
        direction: "in",
        body: inboundBody,
        status: "received",
      });
      const optedOut = isStopMessage(inboundBody);
      res.json({ ok: true, optedOut });
    } catch (err: any) {
      logError("sms.webhook error:", err);
      res.status(500).json({ message: err?.message || "webhook failed" });
    }
  });

  return httpServer;
}
