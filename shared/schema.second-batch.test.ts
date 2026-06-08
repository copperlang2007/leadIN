// Wave 12a — Type-shape smoke tests for the 50 new tables.
//
// These tests don't hit the database. They exist to guarantee the Insert*
// type for every new table is structurally satisfiable with a typical row,
// so a future schema rename in `shared/schema.ts` that breaks downstream
// callers shows up here as a tsc failure during `vitest run`.

import { describe, it, expect } from "vitest";
import type {
  InsertCreditLine,
  InsertCreditRepayment,
  InsertCommissionEscrow,
  InsertPayPerCloseOrder,
  InsertRefundInsurancePolicy,
  InsertWalletCard,
  InsertDoiComplaint,
  InsertDefensePacket,
  InsertComplianceCertification,
  InsertCmsFiling,
  InsertPiiRetentionPolicy,
  InsertTcpaWatchdogEvent,
  InsertReverseAuction,
  InsertReverseAuctionBid,
  InsertWishlist,
  InsertWishlistMatch,
  InsertLeadTradeInCredit,
  InsertLeadShare,
  InsertLeadShareMember,
  InsertLeadXrayStats,
  InsertVendorReview,
  InsertAgentStreak,
  InsertDailyChallenge,
  InsertAgentAchievement,
  InsertWinsFeedPost,
  InsertVideoCallSession,
  InsertVoiceClone,
  InsertLeadAudioTour,
  InsertSentimentSnapshot,
  InsertQuoteWidget,
  InsertLandingPage,
  InsertProvisionedPhoneNumber,
  InsertMediscoreApiKey,
  InsertMediscoreApiUsage,
  InsertDataProduct,
  InsertDataProductSubscription,
  InsertWebinar,
  InsertWebinarRegistration,
  InsertNewsBrief,
  InsertAffiliate,
  InsertAffiliatePayout,
  InsertMentorMatch,
  InsertAgentCertification,
  InsertPublicWebhook,
  InsertWebhookDelivery,
  InsertSdkInstallMetric,
  InsertObituarySignal,
  InsertLeadOption,
  InsertLeadOptionContract,
  InsertDirectMailOrder,
  InsertCarrierDirectPipeline,
  InsertLanguagePack,
} from "./schema";
import {
  creditLines,
  creditRepayments,
  commissionEscrows,
  payPerCloseOrders,
  refundInsurancePolicies,
  walletCards,
  doiComplaints,
  defensePackets,
  complianceCertifications,
  cmsFilings,
  piiRetentionPolicies,
  tcpaWatchdogEvents,
  reverseAuctions,
  reverseAuctionBids,
  wishlists,
  wishlistMatches,
  leadTradeInCredits,
  leadShares,
  leadShareMembers,
  leadXrayStats,
  vendorReviews,
  agentStreaks,
  dailyChallenges,
  agentAchievements,
  winsFeedPosts,
  videoCallSessions,
  voiceClones,
  leadAudioTours,
  sentimentSnapshots,
  quoteWidgets,
  landingPages,
  provisionedPhoneNumbers,
  mediscoreApiKeys,
  mediscoreApiUsage,
  dataProducts,
  dataProductSubscriptions,
  webinars,
  webinarRegistrations,
  newsBriefs,
  affiliates,
  affiliatePayouts,
  mentorMatches,
  agentCertifications,
  publicWebhooks,
  webhookDeliveries,
  sdkInstallMetrics,
  obituarySignals,
  leadOptions,
  leadOptionContracts,
  directMailOrders,
  carrierDirectPipelines,
  languagePacks,
} from "./schema";

describe("Wave 12a — second-batch schema type smoke tests", () => {
  it("exports a table object for every new table", () => {
    const tables = [
      creditLines, creditRepayments, commissionEscrows, payPerCloseOrders,
      refundInsurancePolicies, walletCards,
      doiComplaints, defensePackets, complianceCertifications, cmsFilings,
      piiRetentionPolicies, tcpaWatchdogEvents,
      reverseAuctions, reverseAuctionBids, wishlists, wishlistMatches,
      leadTradeInCredits, leadShares, leadShareMembers, leadXrayStats,
      vendorReviews, agentStreaks, dailyChallenges, agentAchievements,
      winsFeedPosts,
      videoCallSessions, voiceClones, leadAudioTours, sentimentSnapshots,
      quoteWidgets, landingPages, provisionedPhoneNumbers,
      mediscoreApiKeys, mediscoreApiUsage, dataProducts, dataProductSubscriptions,
      webinars, webinarRegistrations, newsBriefs, affiliates, affiliatePayouts,
      mentorMatches, agentCertifications,
      publicWebhooks, webhookDeliveries, sdkInstallMetrics,
      obituarySignals, leadOptions, leadOptionContracts, directMailOrders,
      carrierDirectPipelines, languagePacks,
    ];
    // Drizzle decorates tables with a Symbol(drizzle:Name). Just confirm
    // every entry is a non-null object — the real check is that the imports
    // resolve at compile time.
    expect(tables.length).toBe(52);
    for (const t of tables) {
      expect(t).toBeTruthy();
      expect(typeof t).toBe("object");
    }
  });

  it("accepts a typical Insert row for each fintech table", () => {
    const line: InsertCreditLine = {
      userId: "u1",
      limitCents: 500_000,
      balanceCents: 500_000,
      aprBps: 1500,
      status: "active",
    };
    const repay: InsertCreditRepayment = {
      lineId: 1,
      amountCents: -1000,
      kind: "charge",
    };
    const escrow: InsertCommissionEscrow = {
      orderId: 1,
      amountCents: 25_00,
      status: "held",
    };
    const ppc: InsertPayPerCloseOrder = {
      leadId: 1,
      agentUserId: "u1",
      status: "reserved",
    };
    const refund: InsertRefundInsurancePolicy = {
      orderId: 1,
      premiumPaidCents: 500,
      expiresAt: new Date(),
      status: "active",
    };
    const card: InsertWalletCard = {
      userId: "u1",
      stripeCardId: "card_test",
      last4: "4242",
      status: "active",
    };
    expect(line.userId).toBe("u1");
    expect(repay.kind).toBe("charge");
    expect(escrow.status).toBe("held");
    expect(ppc.status).toBe("reserved");
    expect(refund.premiumPaidCents).toBe(500);
    expect(card.last4).toBe("4242");
  });

  it("accepts a typical Insert row for each compliance table", () => {
    const complaint: InsertDoiComplaint = {
      state: "FL",
      filedAt: new Date(),
      status: "open",
    };
    const packet: InsertDefensePacket = { status: "draft" };
    const cert: InsertComplianceCertification = {
      orgId: "org1",
      certKind: "tcpa_clean",
      level: "gold",
      scorePct: 95,
    };
    const filing: InsertCmsFiling = {
      orgId: "org1",
      filingKind: "sob",
      status: "submitted",
    };
    const policy: InsertPiiRetentionPolicy = { orgId: "org1" };
    const watchdog: InsertTcpaWatchdogEvent = {
      eventKind: "after_hours_dial",
      severity: "warn",
    };
    expect(complaint.state).toBe("FL");
    expect(packet.status).toBe("draft");
    expect(cert.level).toBe("gold");
    expect(filing.filingKind).toBe("sob");
    expect(policy.orgId).toBe("org1");
    expect(watchdog.severity).toBe("warn");
  });

  it("accepts a typical Insert row for each marketplace table", () => {
    const auction: InsertReverseAuction = {
      buyerUserId: "u1",
      criteriaJson: { state: "FL" },
      maxBidCents: 50_00,
      closesAt: new Date(),
    };
    const bid: InsertReverseAuctionBid = {
      auctionId: 1,
      vendorId: 1,
      bidCents: 25_00,
      leadCount: 10,
    };
    const w: InsertWishlist = {
      userId: "u1",
      name: "Florida MA over 65",
      criteriaJson: { state: "FL", minAge: 65 },
    };
    const wm: InsertWishlistMatch = { wishlistId: 1, leadId: 1 };
    const tradein: InsertLeadTradeInCredit = {
      orderId: 1,
      agentUserId: "u1",
      creditCents: 500,
    };
    const share: InsertLeadShare = { ownerUserId: "u1", leadId: 1 };
    const member: InsertLeadShareMember = { shareId: 1, memberUserId: "u2" };
    const xray: InsertLeadXrayStats = { leadId: 1 };
    const review: InsertVendorReview = {
      vendorId: 1,
      reviewerUserId: "u1",
      rating: 5,
    };
    const streak: InsertAgentStreak = {
      agentUserId: "u1",
      streakDate: new Date(),
    };
    const challenge: InsertDailyChallenge = {
      agentUserId: "u1",
      challengeKind: "five_dials",
      targetValue: 5,
      forDate: new Date(),
    };
    const ach: InsertAgentAchievement = {
      agentUserId: "u1",
      achievementKey: "first_sale",
    };
    const win: InsertWinsFeedPost = {
      agentUserId: "u1",
      headline: "Closed a $5k MA deal in Tampa",
    };
    expect(auction.maxBidCents).toBe(5000);
    expect(bid.bidCents).toBe(2500);
    expect(w.name).toContain("Florida");
    expect(wm.wishlistId).toBe(1);
    expect(tradein.creditCents).toBe(500);
    expect(share.ownerUserId).toBe("u1");
    expect(member.memberUserId).toBe("u2");
    expect(xray.leadId).toBe(1);
    expect(review.rating).toBe(5);
    expect(streak.activityCount).toBeUndefined();
    expect(challenge.challengeKind).toBe("five_dials");
    expect(ach.achievementKey).toBe("first_sale");
    expect(win.headline).toContain("Tampa");
  });

  it("accepts a typical Insert row for each voice/AR table", () => {
    const session: InsertVideoCallSession = {
      agentUserId: "u1",
      status: "created",
    };
    const clone: InsertVoiceClone = {
      agentUserId: "u1",
      provider: "elevenlabs",
      status: "pending",
    };
    const tour: InsertLeadAudioTour = {
      leadId: 1,
      audioUrl: "https://cdn/x.mp3",
    };
    const snap: InsertSentimentSnapshot = {
      callLogId: 1,
      offsetSec: 30,
      sentimentScore: "0.500",
    };
    expect(session.status).toBe("created");
    expect(clone.provider).toBe("elevenlabs");
    expect(tour.audioUrl).toContain("https");
    expect(snap.offsetSec).toBe(30);
  });

  it("accepts a typical Insert row for each embedded SaaS table", () => {
    const widget: InsertQuoteWidget = {
      orgId: "org1",
      widgetKey: "w_abc",
      name: "Florida widget",
    };
    const page: InsertLandingPage = {
      orgId: "org1",
      slug: "florida-lp",
      title: "Florida Medicare",
      blocksJson: [{ kind: "hero" }],
    };
    const phone: InsertProvisionedPhoneNumber = {
      phoneNumber: "+13055551234",
    };
    expect(widget.name).toBe("Florida widget");
    expect(page.slug).toBe("florida-lp");
    expect(phone.phoneNumber).toBe("+13055551234");
  });

  it("accepts a typical Insert row for each data-product table", () => {
    const key: InsertMediscoreApiKey = {
      customerName: "Acme Insurance",
      keyHash: "deadbeef",
      keyPrefix: "ms_live_",
    };
    const usage: InsertMediscoreApiUsage = {
      apiKeyId: 1,
      endpoint: "/score",
      statusCode: 200,
    };
    const product: InsertDataProduct = {
      slug: "plan-churn-2026q1",
      name: "Plan Churn Q1 2026",
      kind: "dataset",
    };
    const sub: InsertDataProductSubscription = {
      productId: 1,
      subscriberUserId: "u1",
    };
    expect(key.customerName).toBe("Acme Insurance");
    expect(usage.statusCode).toBe(200);
    expect(product.kind).toBe("dataset");
    expect(sub.subscriberUserId).toBe("u1");
  });

  it("accepts a typical Insert row for each owned-media table", () => {
    const webinar: InsertWebinar = {
      slug: "tcpa-101",
      title: "TCPA 101",
      startsAt: new Date(),
    };
    const reg: InsertWebinarRegistration = {
      webinarId: 1,
      email: "test@example.com",
    };
    const brief: InsertNewsBrief = {
      briefDate: new Date(),
      headline: "AEP starts soon",
      summary: "Quick recap.",
    };
    const aff: InsertAffiliate = {
      userId: "u1",
      affiliateCode: "AFF123",
    };
    const payout: InsertAffiliatePayout = {
      affiliateId: 1,
      amountCents: 10000,
    };
    const mentor: InsertMentorMatch = {
      mentorUserId: "u1",
      menteeUserId: "u2",
    };
    const cert: InsertAgentCertification = {
      agentUserId: "u1",
      certKey: "medicare_basic",
    };
    expect(webinar.title).toBe("TCPA 101");
    expect(reg.email).toContain("@");
    expect(brief.headline).toContain("AEP");
    expect(aff.affiliateCode).toBe("AFF123");
    expect(payout.amountCents).toBe(10000);
    expect(mentor.menteeUserId).toBe("u2");
    expect(cert.certKey).toBe("medicare_basic");
  });

  it("accepts a typical Insert row for each dev-ecosystem table", () => {
    const hook: InsertPublicWebhook = {
      orgId: "org1",
      targetUrl: "https://example.com/hook",
      secret: "s3cret",
      eventTypes: ["lead.created"],
    };
    const delivery: InsertWebhookDelivery = {
      webhookId: 1,
      eventType: "lead.created",
      payload: { leadId: 1 },
    };
    const sdk: InsertSdkInstallMetric = {
      sdkName: "leadmarket-sdk",
      sdkVersion: "1.0.0",
    };
    expect(hook.eventTypes?.[0]).toBe("lead.created");
    expect(delivery.eventType).toBe("lead.created");
    expect(sdk.sdkName).toBe("leadmarket-sdk");
  });

  it("accepts a typical Insert row for each out-there table", () => {
    const obit: InsertObituarySignal = {
      source: "tributes.com",
      state: "FL",
    };
    const option: InsertLeadOption = {
      strikeCents: 5000,
      expiresAt: new Date(),
      criteriaJson: { state: "FL" },
      premiumCents: 200,
    };
    const contract: InsertLeadOptionContract = {
      optionId: 1,
      holderUserId: "u1",
      paidPremiumCents: 200,
    };
    const mail: InsertDirectMailOrder = {
      buyerUserId: "u1",
      campaignName: "Tampa Final Expense",
      targetCount: 500,
      zipsJson: ["33601"],
      pricePerPieceCents: 75,
      totalCents: 37500,
    };
    const pipeline: InsertCarrierDirectPipeline = {
      orgId: "org1",
      carrierName: "Humana",
      pipelineKey: "humana_med_supp",
    };
    const lang: InsertLanguagePack = {
      locale: "es-US",
      displayName: "Español (Estados Unidos)",
      translationsJson: { hello: "Hola" },
    };
    expect(obit.state).toBe("FL");
    expect(option.premiumCents).toBe(200);
    expect(contract.paidPremiumCents).toBe(200);
    expect(mail.targetCount).toBe(500);
    expect(pipeline.carrierName).toBe("Humana");
    expect(lang.locale).toBe("es-US");
  });
});
