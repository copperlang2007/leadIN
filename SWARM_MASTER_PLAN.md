# Killer-features swarm master plan (extended)

102 total features across 11+ waves. Foundation (6a) merged in PR #12.
Foundation extension (12a) covers the 69 second-batch features.

## ✅ Wave 6a — Foundation (DONE, PR #12)
28 tables, 11 column extensions, 5 shared libs.

## Wave 6b — The 5 killers (5 parallel agents)
K1 Live Auction · K2 TCPA Bundle · K3 Dialer+AI Assist · K4 CRM Sync · K5 Reputation

## Wave 7 — Tier 2 differentiators (8 agents)
T1 Lead Replacement · T2 AI Dispute Classifier · T3 Smart Match Subscription · T4 NIPR Auto-Verify · T5 Vendor Scorecard · T6 AI Lead Persona · T7 SMS-First Outreach · T8 Auto-DNC at dial time

## Wave 8 — Marketplace dynamics (5 agents)
M1 Surge Pricing · M2 Lead Bundles · M3 Coverage Heat Map · M4 Live Radar Map · M5 Exclusive Vendor

## Wave 9 — Agency tier (6 agents)
A1 Shared Pipeline · A2 Spend Caps · A3 Bulk Buy · A4 Routing Rules DSL · A5 White-Label · A6 Forecast

## Wave 10 — AI/data compounding (6 agents)
D1 MediScore NL Explainer · D2 Best-time-to-call · D3 News-Aware Re-engagement · D4 AI Enrichment · D5 AI Outreach · D6 Conversion Playbook

## Wave 11 — Network effects (3 agents)
N1 Public Agent Directory · N2 Referral Codes · N3 API Marketplace

## Wave 12a — Foundation extension (1 agent)
Schema for 69 new features:
- Fintech: `credit_lines`, `credit_repayments`, `commission_escrows`, `pay_per_close_orders`, `refund_insurance`, `wallet_cards`
- Compliance moat: `doi_complaints`, `defense_packets`, `compliance_certifications`, `cms_filings`, `pii_retention_policies`, `tcpa_watchdog_events`
- Marketplace mechanics: `reverse_auctions`, `wishlists`, `wishlist_matches`, `lead_tradein_credits`, `lead_shares`, `lead_xray_stats`, `vendor_reviews`, `agent_streaks`, `daily_challenges`, `agent_achievements`, `wins_feed_posts`
- Vertical expansion: `lead_verticals` (extension to leads.vertical column + auto/home/aca/mortgage/commercial/annuity/pet enum)
- Voice/AR: `video_call_sessions`, `voice_clones`, `lead_audio_tours`, `sentiment_snapshots`
- Embedded SaaS: `quote_widgets`, `landing_pages`, `provisioned_phone_numbers`
- Data products: `mediscore_api_keys`, `mediscore_api_usage`, `data_products`, `data_product_subscriptions`
- Owned media: `webinars`, `webinar_registrations`, `news_briefs`, `affiliates`, `affiliate_payouts`, `mentor_matches`, `agent_certifications`
- Dev ecosystem: `public_webhooks`, `webhook_deliveries`, `sdk_install_metrics`
- Out-there: `obituary_signals`, `lead_options` (futures), `lead_option_contracts`, `direct_mail_orders`, `carrier_direct_pipelines`, `language_packs` (i18n)

## Wave 12b-17 — 69 feature agents (waves of 5-8)

### Wave 12b — Fintech (5)
F1 Pay-Per-Close pricing · F2 Lead-backed credit line · F3 Commission escrow · F4 Refund insurance · F5 Wallet debit card

### Wave 13a — Compliance moat (6)
CM1 DOI complaint auto-defense packet · CM2 State-by-state compliance heatmap · CM3 CMS MIPPA filing automation · CM4 "Certified by LeadMarket" badge · CM5 Two-party-consent recording notice · CM6 GDPR/CCPA auto-deletion timer

### Wave 13b — Marketplace mechanics from elsewhere (8)
MM1 Reverse auction · MM2 Wishlist subscription · MM3 Trade-in credit · MM4 Lead "share" syndication · MM5 Lead X-ray stats · MM6 Verified review system · MM7 Streaks + daily challenges · MM8 "Won deals" feed

### Wave 14 — Vertical expansion (6)
V1 Auto + home leads · V2 ACA leads · V3 Mortgage protection · V4 Commercial small biz · V5 Annuities · V6 Pet insurance

### Wave 15a — Voice/video/AR (5)
VR1 Video escalation from dialer · VR2 AR Medicare plan comparison · VR3 Voice clone for voicemail · VR4 Sentiment MediScore · VR5 AI-narrated lead tour

### Wave 15b — Embedded SaaS (4)
ES1 Quote engine SDK · ES2 Landing-page builder · ES3 Insurance CRM · ES4 Phone number provisioning

### Wave 16a — Data products / B2B (4)
DP1 State plan-churn dataset · DP2 Quarterly "State of Medicare Leads" PDF · DP3 Consumer-quality signals API · DP4 MediScore benchmark dashboard

### Wave 16b — Owned media + community (8)
OM1 Compliance webinar series · OM2 AI news brief daily · OM3 Agent Academy certification · OM4 Affiliate publishing program · OM5 Podcast network · OM6 Discord community embed · OM7 Mentorship matching · OM8 Annual awards

### Wave 17 — Dev ecosystem (5)
DE1 App marketplace · DE2 Public webhooks · DE3 Live feed iframe widget · DE4 TypeScript SDK on npm · DE5 Hackathon platform

### Wave 18 — Out-there bets (7)
OT1 Obituary scraper → final expense · OT2 Estate-planning referral side-channel · OT3 Lead options/futures market · OT4 Direct mail marketplace · OT5 Carrier-direct binding · OT6 Spanish-language vertical · OT7 Predictive agent churn detection

### Killers from the top-10 list (the 3 not yet placed above)
- AEP Campaign Auto-Orchestrator → Wave 13c (Compliance/Campaign Ops): CO1
- Lead "Second-Look" Re-list → Wave 8 (Marketplace dynamics): M6
- Voice-Driven Mobile Browsing → Wave 15a: VR6

## Skipped (real-world or regulatory)
- Annual conference (humans, not agents)
- Lead-LP fund (regulatory complexity beyond engineering)
- Acquisition-of-vendors program (M&A, humans)
- Carrier appointment broker (sales relationship, humans)

## Protocol
- Each wave: feature agents work in isolated worktrees off the same parent commit.
- Schema is locked after each foundation wave; feature agents don't add migrations.
- LLM/Twilio/CRM/NIPR features use the stub backend; production runtime switches via env vars.
- Each agent: tsc clean, lint 0 errors, tests pass, no schema diff drift.
- Collector merges all wave branches into a single PR with one squash commit per wave.

## Realistic timeline
At ~4 minutes of agent-work per agent + ~5 minutes per collector PR + CI:
- Wave 6b: 5 agents parallel ≈ 1 unit
- Wave 7: 8 agents parallel ≈ 1 unit
- Wave 8: 5+1 agents ≈ 1 unit
- Wave 9: 6 agents ≈ 1 unit
- Wave 10: 6 agents ≈ 1 unit
- Wave 11: 3 agents ≈ 0.6 units
- Wave 12a foundation: 1 agent serial ≈ 1 unit
- Waves 12b-18: ~52 agents in batches of 5-8 ≈ 7-8 units
- **Total: ~14 units of agent time, 25-30 collector PRs**

Will execute in batches, with the constraint that each foundation extension must merge before its dependent feature wave can branch off.
