// Wave 6 — feature flags. All defaults are ON; set the env var to "false"
// to disable a feature in a given environment. Shared (not server-only) so
// the client bundle can branch on the same flags via Vite define plugin.

function flag(name: string): boolean {
  return process.env[name] !== "false";
}

export const FEATURE_FLAGS = {
  // K1-K5 — Tier 1 killer features
  liveAuction: flag("FEATURE_LIVE_AUCTION"),
  tcpaInsurance: flag("FEATURE_TCPA"),
  dialer: flag("FEATURE_DIALER"),
  crmSync: flag("FEATURE_CRM_SYNC"),
  reputation: flag("FEATURE_REPUTATION"),

  // T1-T8 — Tier 2 differentiators
  replacementGuarantee: flag("FEATURE_REPLACEMENT_GUARANTEE"),
  aiDisputeClassifier: flag("FEATURE_AI_DISPUTE"),
  smartMatch: flag("FEATURE_SMART_MATCH"),
  niprVerify: flag("FEATURE_NIPR"),
  vendorScorecard: flag("FEATURE_VENDOR_SCORECARD"),
  leadPersona: flag("FEATURE_LEAD_PERSONA"),
  smsOutreach: flag("FEATURE_SMS_OUTREACH"),
  autoDncRecheck: flag("FEATURE_AUTO_DNC_RECHECK"),

  // M1-M5 — Marketplace dynamics
  surge: flag("FEATURE_SURGE"),
  bundles: flag("FEATURE_BUNDLES"),
  coverageHeatmap: flag("FEATURE_COVERAGE_HEATMAP"),
  liveRadar: flag("FEATURE_LIVE_RADAR"),
  exclusiveVendors: flag("FEATURE_EXCLUSIVE_VENDORS"),

  // A1-A6 — Agency tier
  sharedKanban: flag("FEATURE_SHARED_KANBAN"),
  spendCaps: flag("FEATURE_SPEND_CAPS"),
  bulkBuy: flag("FEATURE_BULK_BUY"),
  routingRules: flag("FEATURE_ROUTING_RULES"),
  whiteLabel: flag("FEATURE_WHITE_LABEL"),
  pipelineForecast: flag("FEATURE_PIPELINE_FORECAST"),

  // D1-D6 — Compounding AI / data
  mediscoreExplainer: flag("FEATURE_MEDISCORE_EXPLAINER"),
  callWindowPredictor: flag("FEATURE_CALL_WINDOW"),
  newsReengagement: flag("FEATURE_NEWS_REENGAGEMENT"),
  aiEnrichment: flag("FEATURE_AI_ENRICHMENT"),
  aiOutreachDrafts: flag("FEATURE_AI_OUTREACH"),
  conversionPlaybook: flag("FEATURE_CONVERSION_PLAYBOOK"),

  // N1-N3 — Network effects
  agentDirectory: flag("FEATURE_AGENT_DIRECTORY"),
  referrals: flag("FEATURE_REFERRALS"),
  integrationMarketplace: flag("FEATURE_INTEGRATION_MARKETPLACE"),

  // ───── Wave 12a — Second-batch feature flags (all default on) ─────
  // F1-F5 — Fintech
  payPerClose: flag("FEATURE_PAY_PER_CLOSE"),
  creditLine: flag("FEATURE_CREDIT_LINE"),
  commissionEscrow: flag("FEATURE_COMMISSION_ESCROW"),
  refundInsurance: flag("FEATURE_REFUND_INSURANCE"),
  walletCard: flag("FEATURE_WALLET_CARD"),

  // CM1-CM6 + CO1 — Compliance moat
  doiDefensePacket: flag("FEATURE_DOI_DEFENSE_PACKET"),
  complianceHeatmap: flag("FEATURE_COMPLIANCE_HEATMAP"),
  cmsFiling: flag("FEATURE_CMS_FILING"),
  certifiedBadge: flag("FEATURE_CERTIFIED_BADGE"),
  twoPartyConsentNotice: flag("FEATURE_TWO_PARTY_CONSENT"),
  piiAutoDeletion: flag("FEATURE_PII_AUTO_DELETION"),
  aepOrchestrator: flag("FEATURE_AEP_ORCHESTRATOR"),

  // MM1-MM8 — Marketplace mechanics
  reverseAuction: flag("FEATURE_REVERSE_AUCTION"),
  wishlistSubscription: flag("FEATURE_WISHLIST"),
  tradeInCredit: flag("FEATURE_TRADE_IN_CREDIT"),
  leadShareSyndication: flag("FEATURE_LEAD_SHARE"),
  leadXrayStats: flag("FEATURE_LEAD_XRAY"),
  verifiedReviews: flag("FEATURE_VERIFIED_REVIEWS"),
  streaksChallenges: flag("FEATURE_STREAKS_CHALLENGES"),
  winsFeed: flag("FEATURE_WINS_FEED"),

  // V1-V6 — Vertical expansion
  verticalExpansion: flag("FEATURE_VERTICAL_EXPANSION"),

  // VR1-VR6 — Voice/AR
  videoEscalation: flag("FEATURE_VIDEO_ESCALATION"),
  arPlanCompare: flag("FEATURE_AR_PLAN_COMPARE"),
  voiceClone: flag("FEATURE_VOICE_CLONE"),
  sentimentMediscore: flag("FEATURE_SENTIMENT_MEDISCORE"),
  audioLeadTour: flag("FEATURE_AUDIO_LEAD_TOUR"),
  voiceBrowsing: flag("FEATURE_VOICE_BROWSING"),

  // ES1-ES4 — Embedded SaaS
  quoteWidgetSdk: flag("FEATURE_QUOTE_WIDGET"),
  landingPageBuilder: flag("FEATURE_LANDING_PAGE_BUILDER"),
  embeddedCrm: flag("FEATURE_EMBEDDED_CRM"),
  phoneProvisioning: flag("FEATURE_PHONE_PROVISIONING"),

  // DP1-DP4 — Data products
  planChurnDataset: flag("FEATURE_PLAN_CHURN_DATASET"),
  stateOfLeadsReport: flag("FEATURE_STATE_OF_LEADS"),
  mediscoreApi: flag("FEATURE_MEDISCORE_API"),
  mediscoreBenchmark: flag("FEATURE_MEDISCORE_BENCHMARK"),

  // OM1-OM8 — Owned media + community
  complianceWebinars: flag("FEATURE_COMPLIANCE_WEBINARS"),
  newsBriefs: flag("FEATURE_NEWS_BRIEFS"),
  agentAcademy: flag("FEATURE_AGENT_ACADEMY"),
  affiliateProgram: flag("FEATURE_AFFILIATE_PROGRAM"),
  podcastNetwork: flag("FEATURE_PODCAST_NETWORK"),
  communityEmbed: flag("FEATURE_COMMUNITY_EMBED"),
  mentorshipMatching: flag("FEATURE_MENTORSHIP"),
  annualAwards: flag("FEATURE_ANNUAL_AWARDS"),

  // DE1-DE5 — Dev ecosystem
  appMarketplace: flag("FEATURE_APP_MARKETPLACE"),
  publicWebhooks: flag("FEATURE_PUBLIC_WEBHOOKS"),
  liveFeedIframe: flag("FEATURE_LIVE_FEED_IFRAME"),
  tsSdk: flag("FEATURE_TS_SDK"),
  hackathonPlatform: flag("FEATURE_HACKATHON"),

  // OT1-OT7 — Out-there bets
  obituarySignals: flag("FEATURE_OBITUARY_SIGNALS"),
  estatePlanningReferral: flag("FEATURE_ESTATE_PLANNING_REFERRAL"),
  leadOptionsMarket: flag("FEATURE_LEAD_OPTIONS"),
  directMailMarketplace: flag("FEATURE_DIRECT_MAIL"),
  carrierDirectBinding: flag("FEATURE_CARRIER_DIRECT"),
  spanishVertical: flag("FEATURE_SPANISH_VERTICAL"),
  agentChurnDetection: flag("FEATURE_AGENT_CHURN_DETECTION"),

  // M6 — Lead "Second-Look" Re-list
  secondLookRelist: flag("FEATURE_SECOND_LOOK_RELIST"),
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isEnabled(flagName: FeatureFlag): boolean {
  return FEATURE_FLAGS[flagName];
}
