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
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isEnabled(flagName: FeatureFlag): boolean {
  return FEATURE_FLAGS[flagName];
}
