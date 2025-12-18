# LeadMarket

## Overview

LeadMarket is an insurance lead marketplace platform where buyers can purchase verified Medicare Advantage, Medicare Supplement, and Final Expense leads. The platform features lead provenance tracking, compatibility matching based on user licensing, and a trust verification system. Currently transitioning from a frontend prototype to a full-stack application with PostgreSQL persistence.

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

### Database Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Key Tables**:
  - `users` - User accounts with balance tracking
  - `userProfiles` - User preferences (licensed states, preferred lead types)
  - `vendors` - Lead vendors with ratings and verification status
  - `leads` - Core lead data with JSONB provenance tracking
  - `orders` - Purchase transaction records
  - `sessions` - Authentication session storage

### Authentication Flow
- Uses Replit's OIDC provider for authentication
- Session-based auth with secure cookies
- User data automatically synced on login via upsert pattern
- Protected routes use `isAuthenticated` middleware

### Data Flow
1. Frontend makes API requests via TanStack Query
2. Express routes handle requests with authentication middleware
3. Storage layer (`server/storage.ts`) abstracts database operations
4. Drizzle ORM executes queries against PostgreSQL
5. Responses returned as JSON with proper typing

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations and schema push via `npm run db:push`

### Authentication
- **Replit Auth**: OpenID Connect provider at `https://replit.com/oidc`
- **Required Secrets**: `SESSION_SECRET`, `REPL_ID` (auto-provided by Replit)

### Frontend Libraries
- **TanStack Query**: Data fetching and caching
- **Radix UI**: Accessible component primitives
- **date-fns**: Date formatting and manipulation
- **Embla Carousel**: Carousel functionality

### Build Tools
- **Vite**: Development server and frontend bundling
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the codebase