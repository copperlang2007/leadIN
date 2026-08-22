# LeadMarket – Build status

This document is the source of truth for what has been built vs. what is planned.

## Architecture

- **Frontend:** React 19 + Vite + TanStack Query + Tailwind
- **Backend:** Node 20 + Express + WebSocket (`ws`)
- **DB:** PostgreSQL via Drizzle ORM. Migrations live in `migrations/` and are tracked in git.
- **Auth:** Neon Auth (Stack) token exchange with PG-backed sessions
- **Payments:** Stripe Checkout (per-lead wallet top-up + recurring subscriptions)
- **Tests:** Vitest (run via `npm test`)
- **CI:** `.github/workflows/ci.yml` runs `tsc`, `vitest`, and a drizzle schema check on every PR

## Shipped

### Phase 1-2 – Backend foundation + marketplace logic
- Auth, roles, profile, leads, orders, balances, vendor ingestion, WebSocket live feed.

### Phase 3 – Multi-tenant marketplace + routing engine
- `organizations`, `org_members`, `agent_profiles`, `lead_assignments` tables.
- Lead + order rows carry `org_id`; queries are org-scoped end-to-end (incl. PII reveal).
- Vendor API keys can be bound to an org so ingested leads enter the right tenant.
- Routing engine ranks eligible agents (state license, territory, capacity, conversion rate, carrier match) and writes an assignment row + WebSocket event.
- Agents can accept / decline; decline frees the lead and re-routes.
- Stripe subscription checkout (Starter / Growth / Scale) + webhook handling for `customer.subscription.deleted/updated` → org status sync.
- Subscription status gates routing engine + vendor-key minting.

### Phase 4 – Signal enrichment
- `keyword_signals` (Google Search Console → DataForSEO → seed fallback), refreshed daily.
- `cms_plan_signals` (quote-aware CSV parser, env-configurable URLs, seed fallback), refreshed weekly.
- `behavioral_events` SDK in the client; events scoped to lead when a detail dialog is open.
- DNC compliance check on ingest (vendor API with deterministic local fallback for dev/staging).
- MediScore aggregates 22 weighted signals; surfaced as badge + breakdown in the lead detail dialog and a number on each card. DNC-flagged leads filtered out of the marketplace by default.

### Security
- Helmet headers.
- Double-submit-cookie CSRF on every state-changing endpoint (Stripe webhook + API-key ingest + OIDC redirect exempted).
- Token-bucket rate limits on `/api/v1/leads/ingest`, `/api/stripe/create-checkout`, `/api/events/track`.
- Event tracker dedupes within 5s, clamps numeric values, and throttles MediScore recomputes per lead.
- Stripe success/cancel URLs derived from `APP_URL` env, not request hostname.
- `.gitignore` covers `.env*`.

## Not yet built

- Stripe Price IDs instead of inline `product_data` (each subscription is currently a new Stripe product).
- License document upload pipeline (currently a free-text URL).
- Admin UI for managing org members and verifying agents.
- Re-running DNC against existing leads on a schedule.
- Multi-instance support for the in-memory rate limiter (swap for Redis if scaled out).
- ML-based MediScore weighting (current weights are static).
