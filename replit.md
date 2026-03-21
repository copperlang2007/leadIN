# LeadMarket

## Overview

LeadMarket is an insurance lead marketplace platform where buyers can purchase verified Medicare Advantage, Medicare Supplement, and Final Expense leads. The platform features lead provenance tracking, compatibility matching based on user licensing, PII gating with post-purchase reveal, real-time WebSocket live feed, Stripe wallet funding, vendor API ingestion, email notifications, an admin panel, CSV order export, and an autonomous content engine with a public blog.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, built using Vite
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query for server state and caching
- **Styling**: Tailwind CSS with shadcn/ui component library
- **UI Components**: Radix UI primitives wrapped with custom styling

### Backend Architecture
- **Runtime**: Node.js with Express
- **API Pattern**: RESTful API endpoints under `/api/` prefix
- **Authentication**: Replit Auth using OpenID Connect with Passport.js
- **Session Management**: PostgreSQL-backed sessions using connect-pg-simple
- **WebSocket**: Real-time lead feed via ws library at `/ws` path
- **Email**: Optional email notifications via SendGrid or Resend (graceful fallback)

### Database Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Key Tables**:
  - `users` - User accounts with balance, role (admin/buyer), notificationsEnabled flag
  - `userProfiles` - User preferences (licensed states, preferred lead types)
  - `vendors` - Lead vendors with ratings and verification status
  - `leads` - Core lead data with JSONB provenance, PII fields (consumerName, consumerPhone, consumerEmail, consumerAddress), flagged/removed status
  - `orders` - Purchase transaction records
  - `sessions` - Authentication session storage
  - `vendorApiKeys` - Hashed API keys for vendor ingestion
  - `stripeCheckoutSessions` - Stripe checkout session tracking
  - `notifications` - Platform notification records

### Authentication Flow
- Uses Replit's OIDC provider for authentication
- Session-based auth with secure cookies
- User data automatically synced on login via upsert pattern
- Protected routes use `isAuthenticated` middleware
- Admin access: first user calls `POST /api/admin/seed-admin` to become admin

### Key Features
1. **Stripe Wallet Funding**: `POST /api/stripe/create-checkout` creates Stripe checkout session; webhook at `POST /api/stripe/webhook` credits balance on completion. Requires `STRIPE_SECRET_KEY` env var.
2. **Vendor API Ingestion**: `POST /api/v1/leads/ingest` with `X-Api-Key` header; keys are SHA-256 hashed in `vendorApiKeys` table. Broadcasts new leads via WebSocket.
3. **PII Gating**: Lead consumer data (name, phone, email, address) is stripped from all `/api/leads` responses; revealed only via `GET /api/leads/:id/reveal` after purchase verification.
4. **WebSocket Live Feed**: Server at `/ws` path broadcasts `{ type: "new_lead", lead }` events; frontend auto-reconnects every 3s with live indicator in header.
5. **Email Notifications**: Sends on lead purchase completion; optional via `SENDGRID_API_KEY` or `RESEND_API_KEY` (gracefully logs warning if neither configured).
6. **Admin Panel**: `/admin` page with stats, lead management (flag/remove), vendor volume. Admin role assigned via `POST /api/admin/seed-admin`.
7. **CSV Export**: `GET /api/orders/export` generates CSV with all order and PII data for the authenticated user.
8. **Platform Status Dashboard**: `/architect` page shows live metrics (when admin) or "Admin Access Required" message.
9. **Autonomous Content Engine**: `server/contentGeneration.ts` uses `node-cron` to publish one article per day at 09:00. 10 topic templates cover Medicare Advantage, Medicare Supplement, Final Expense, and Industry News categories. Articles stored in `contentArticles` table.
10. **Public Blog**: `/blog` lists published articles grouped by category; `/blog/:slug` renders full markdown article with reading time, tags, and a LeadMarket CTA. Accessible without login.
11. **Dynamic Sitemap**: `GET /sitemap.xml` returns a standards-compliant XML sitemap including all published blog articles with `lastmod` dates. Pings Google on each new publication.
12. **GA4 Analytics**: Google Analytics 4 tag (`G-LEADMARKET01`) included in `client/index.html` for production traffic tracking.

### Data Flow
1. Frontend makes API requests via TanStack Query
2. Express routes handle requests with authentication middleware
3. Storage layer (`server/storage.ts`) abstracts database operations
4. Drizzle ORM executes queries against PostgreSQL
5. WebSocket server broadcasts events to connected clients
6. Responses returned as JSON with proper typing

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations and schema push via `npm run db:push`

### Authentication
- **Replit Auth**: OpenID Connect provider at `https://replit.com/oidc`
- **Required Secrets**: `SESSION_SECRET`, `REPL_ID` (auto-provided by Replit)

### Payment
- **Stripe**: Wallet funding via Stripe Checkout; requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars

### Email (Optional)
- **SendGrid**: `SENDGRID_API_KEY` env var enables email notifications
- **Resend**: `RESEND_API_KEY` env var as alternative to SendGrid

### Frontend Libraries
- **TanStack Query**: Data fetching and caching
- **Radix UI**: Accessible component primitives
- **date-fns**: Date formatting and manipulation
- **ws**: WebSocket server (backend)

### Build Tools
- **Vite**: Development server and frontend bundling
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the codebase

## Page Routes
- `/` - Marketplace (lead grid, filter sidebar, comparison drawer)
- `/orders` - Order history with PII reveal and CSV export
- `/profile` - Profile & Licenses, notification preferences
- `/architect` - Platform Status dashboard + Architectural Blueprint
- `/admin` - Admin panel (admin role required)
- `/saved` - Saved lists (placeholder)
- `/settings` - Settings (placeholder)
- `/blog` - Public blog listing all published articles grouped by category
- `/blog/:slug` - Individual article with markdown rendering, tags, reading time, and CTA
