# LeadMarket

LeadMarket is a multi-tenant marketplace for verified insurance leads. Vendors submit leads through TrustedForm-verified webforms; the platform scores them with MediScore, screens them against the DNC registry, and routes them to subscribed agents in real time. Agents pay per lead through a Stripe-backed wallet plus a subscription tier; disputes auto-debit vendor revenue at a configurable share.

## Stack

- **Frontend** — React 19 + Vite, wouter, TanStack Query, Tailwind 4, Radix primitives
- **Backend** — Express 4 (ESM) on Node 20, Passport (local + Replit OIDC)
- **Database** — Postgres 16 + Drizzle ORM (`drizzle-kit` migrations)
- **Payments** — Stripe (per-lead wallet, subscription tiers, webhooks)
- **Auth** — Replit OIDC in production, local password in dev
- **Optional** — Redis (distributed mode), SendGrid/Resend (email), Google Search Console + DataForSEO (SEO signals)

## Quickstart

```bash
cp .env.example .env       # then fill in DATABASE_URL, SESSION_SECRET, Stripe keys
npm ci
npm run db:push            # apply schema to your local Postgres
npm run dev                # API + Vite dev server on :5000
```

You need a reachable Postgres 16 instance and (for paid flows) Stripe test keys. Everything else has a deterministic local fallback so the app boots without third-party credentials.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run Express + Vite middleware in watch mode (port 5000) |
| `npm run build` | Build server bundle + client assets to `dist/` |
| `npm run start` | Run the production bundle (`dist/index.cjs`) |
| `npm run check` | TypeScript strict check (no emit) |
| `npm run test` | Vitest unit + integration suite |
| `npm run lint` | ESLint across the repo |
| `npm run db:push` | Push schema directly to the configured database (dev) |
| `npm run db:generate` | Generate a new SQL migration into `migrations/` |
| `npm run check:env` | Verify `.env.example` covers every `process.env.X` reference in `server/` and `shared/` |

## Architecture

The server is a single Express process that mounts API routes under `/api/*` and falls through to Vite (dev) or static assets (prod) for the React SPA. The schema lives in `shared/schema.ts` and is consumed by both sides via Drizzle + Zod. Background jobs (digests, payouts, CMS sync) run via `node-cron` inside the same process and become safe-to-clusterize when `REDIS_URL` is set.

Subsystems:

- **Routing engine** — matches new leads against agent subscriptions on geo + product + capacity
- **MediScore** — composite quality score per lead (TrustedForm, age, contact freshness, vendor reputation)
- **DNC compliance** — vendor-pluggable (Gryphon, Convoso, RealPhoneValidation) with a deterministic local fallback for dev
- **Stripe layer** — wallet top-ups, subscription tiers, webhook reconciliation, vendor payouts at `REV_SHARE_PCT`
- **Behavioral tracker** — agent action telemetry feeding the SEO signals + retention dashboards
- **Disputes + refunds** — agent-raised disputes auto-debit vendor revenue and refund the buyer
- **CMS Plan Finder sync** — pulls Medicare terminations / star ratings / benefit changes nightly

## Tests & CI

Local: `npm run check && npm run test && npm run lint && npm run check:env`.

CI runs the same checks plus a Drizzle regen check and a real Postgres migration apply — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Roadmap

Build status, wave plan, and shipped features live in [`PHASE_PLAN.md`](PHASE_PLAN.md).
