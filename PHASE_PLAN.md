# LeadMarket - Full Stack Graduation Phase Plan

This document outlines the technical roadmap to transition LeadMarket from a high-fidelity frontend prototype to a fully functional, production-ready marketplace.

## Architecture Overview

**Current State:** Frontend-only (React, Vite, Mock Data)
**Target State:** Full Stack Monolith (Node.js, Express, PostgreSQL)

### Core Tech Stack
- **Frontend:** React, Tailwind CSS, TanStack Query
- **Backend:** Node.js, Express
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** Passport.js (Session-based)
- **Payments:** Stripe Connect (for multi-vendor payouts)
- **Real-time:** WebSocket (for live lead feeds)

---

## Phase 1: Backend Foundation & Data Modeling (Weeks 1-2)
**Goal:** Establish the persistent data layer and user authentication.

1.  **Database Schema Design:**
    *   `users`: Buyers and Sellers with role-based access.
    *   `leads`: Core lead data (metadata, price, status).
    *   `lead_attributes`: JSONB column for flexible schema (Medicare vs. Life Insurance).
    *   `provenance_logs`: Immutable audit trail for authenticity checks.
    *   `orders`: Transaction records.
2.  **API Development:**
    *   Set up Express routes for `/api/leads`, `/api/user`, `/api/orders`.
    *   Migrate mock data generators to seed scripts for the database.
3.  **Authentication:**
    *   Implement secure Login/Register flows.
    *   Add role-based middleware (Buyer vs. Vendor).

## Phase 2: Marketplace Logic & Compatibility Engine (Weeks 3-4)
**Goal:** Implement the "Smart" features—filtering, matching, and validation.

1.  **Compatibility Engine (Backend):**
    *   Port the compatibility logic from frontend to backend.
    *   Implement efficient SQL queries for filtering (e.g., PostGIS for location radius, JSONB queries for attributes).
2.  **Vendor Ingestion Pipeline:**
    *   Create API endpoints for vendors to POST leads (`POST /api/v1/ingest`).
    *   Implement basic validation rules (e.g., duplicate checks, schema validation).
3.  **Lead State Machine:**
    *   Manage states: `AVAILABLE` -> `RESERVED` -> `SOLD` -> `AGED`.
    *   Handle exclusivity logic (e.g., decrementing "shared" count).

## Phase 3: Trust & Compliance Integrations (Weeks 5-6)
**Goal:** Connect third-party services for verification.

1.  **TrustedForm / Jornaya Integration:**
    *   Server-side validation of TCPA certificates.
    *   Store certificate IDs in `provenance_logs`.
2.  **Phone/Email Validation:**
    *   Integrate with services (e.g., NumVerify, NeverBounce) to scrub contact info before listing.
3.  **Secure PII Handling:**
    *   Implement column-level encryption for consumer PII.
    *   Ensure PII is only revealed *after* purchase.

## Phase 4: Commerce & Transactions (Weeks 7-8)
**Goal:** Enable real money transactions.

1.  **Wallet System:**
    *   Implement internal ledger for user credits (Deposit -> Buy Leads).
2.  **Stripe Integration:**
    *   Checkout sessions for adding funds.
    *   (Optional) Stripe Connect for direct vendor payouts.
3.  **Order History & Export:**
    *   Generate CSV/PDF exports for purchased leads.
    *   Email receipts.

## Phase 5: Real-Time Features (Week 9)
**Goal:** Create urgency and live activity.

1.  **Live Feed:**
    *   WebSocket implementation to broadcast new lead arrivals in real-time.
2.  **Concurrency Handling:**
    *   Prevent "race conditions" where two buyers buy the same exclusive lead simultaneously (Optimistic Locking).

---

## Immediate Next Steps (Graduation)

To begin **Phase 1**, we need to "eject" from the mockup environment and enable backend capabilities.

1.  Approve Full-Stack Graduation.
2.  Define the `User` and `Lead` database schemas.
3.  Provision the PostgreSQL database.
