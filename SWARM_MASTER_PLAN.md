# Killer-features swarm master plan

5 waves. Foundation lands first to avoid schema conflicts; feature waves then fan out 6-8 parallel agents each. Total ~33 features.

## Wave 6a — Foundation (serial, one agent)

Single mega-PR. ALL new tables + ALL shared infra so feature agents don't fight migrations.

- **Schema additions** (one migration `0004_killer_features.sql`):
  - `lead_claims`, `lead_price_history`, `lead_bundles`, `lead_bundle_items`
  - `tcpa_policies`, `tcpa_claims`
  - `call_logs`, `sms_logs`, `conversation_assists`, `transcripts`
  - `crm_connections`, `crm_sync_events`
  - `agent_reputation_events`
  - `smart_match_subscriptions`
  - `agent_spend_caps`, `bulk_orders`, `bulk_order_items`
  - `routing_rules`
  - `org_branding`
  - `news_events`
  - `lead_personas` (cache), `outreach_drafts` (cache)
  - `agency_profiles`
  - `referral_codes`, `referrals`
  - `marketplace_integrations`, `marketplace_integration_installs`
  - Column extensions on `leads`: `enrichmentJson`, `mediscoreExplanation`, `bestCallWindowsJson`
  - Column extensions on `vendors`: `isExclusive`, `revShareOverride`
  - Column extensions on `agent_profiles`: `niprVerifiedAt`, `niprLicenseExpiry`
  - Column extensions on `lead_disputes`: `aiClassification`, `aiConfidence`, `autoReplacementOrderId`

- **Shared infra** (new files):
  - `server/lib/llm.ts` — `chat({ system, user, schema? })` with OpenAI/Anthropic backends + deterministic stub
  - `server/lib/twilio.ts` — `startCall`, `sendSms`, webhook signature verification + stub
  - `server/lib/crm.ts` — adapter interface (`HubSpotAdapter`, `SalesforceAdapter`, `GhlAdapter`, `PipedriveAdapter`) + stub
  - `server/lib/nipr.ts` — `verifyLicense(niprNumber, state)` + stub
  - `shared/featureFlags.ts` — feature toggles read from env

## Wave 6b — The 5 killers (parallel)

| Agent | Feature | Touches |
|---|---|---|
| K1 | Speed-to-Lead Live Auction (10s WebSocket window, claim race) | `server/auction.ts`, `server/routes.ts`, `client/.../live-auction.tsx` |
| K2 | TCPA defense insurance bundled with every lead | `server/tcpa.ts`, lead detail UI, claim flow |
| K3 | Inline Dialer + AI Conversation Assist | `server/dialer.ts`, `client/.../dialer-panel.tsx` |
| K4 | CRM bidirectional sync | `server/crmSync.ts`, settings UI |
| K5 | Agent Reputation System | `server/reputation.ts`, routing integration, vendor UI |

## Wave 7 — Tier 2 differentiators (parallel)

| Agent | Feature |
|---|---|
| T1 | Lead Replacement Guarantee (auto-detect) |
| T2 | AI Dispute Pre-Classifier |
| T3 | Smart Match flat-rate subscription |
| T4 | NIPR / DOI auto-verification |
| T5 | Vendor Conversion Scorecard |
| T6 | AI Lead Persona Generator |
| T7 | SMS-First Outreach (TCPA-safe templates) |
| T8 | Auto-DNC re-check at dial time |

## Wave 8 — Marketplace dynamics (parallel)

| Agent | Feature |
|---|---|
| M1 | Surge Pricing (sub-10s demand multiplier) |
| M2 | Lead Bundles |
| M3 | Coverage Heat Map |
| M4 | Live Lead Radar Map |
| M5 | Exclusive Vendor Partnership Program |

## Wave 9 — Agency tier (parallel)

| Agent | Feature |
|---|---|
| A1 | Shared Pipeline Kanban |
| A2 | Per-Agent Spend Caps |
| A3 | Bulk Buy + Smart Fanout |
| A4 | Custom Routing Rules DSL |
| A5 | White-Label Agency Branding |
| A6 | Pipeline Forecast |

## Wave 10 — Compounding AI/data (parallel)

| Agent | Feature |
|---|---|
| D1 | MediScore Natural-Language Explainer |
| D2 | Best Time-to-Call Predictor |
| D3 | News-Aware Re-engagement |
| D4 | AI Lead Enrichment for Vendors |
| D5 | AI-Drafted Outreach Email/SMS |
| D6 | AI Conversion Playbook |

## Wave 11 — Network effects (parallel)

| Agent | Feature |
|---|---|
| N1 | Public Agent Directory (SEO + NIPR badge) |
| N2 | Agent + Vendor Referral Codes |
| N3 | API Marketplace (third-party integrations) |

## Skipped

- Annual conference (real-world; planned by humans, not built by agents)
- Lead investment fund (regulatory complexity beyond scope)
- Agent-vs-vendor reverse auction (overlap with Smart Match — defer)

## Wave protocol

- Each wave: feature agents work in isolated worktrees off the same parent commit.
- Schema is locked after Wave 6a — feature agents don't add migrations.
- LLM/Twilio/CRM/NIPR features ship with the stub backend; production runtime switches via env vars.
- Each agent: tsc clean, lint 0 errors, tests pass, no schema diff drift.
- Collector merges all wave branches into a single PR with a single squash commit per wave.
