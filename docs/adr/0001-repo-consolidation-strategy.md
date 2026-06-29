# ADR 0001 — Repository Consolidation Strategy

- **Status:** Accepted
- **Date:** 2026-06-29
- **Owner:** copperlang@gmail.com
- **Scope:** `lead-connect-pro`, `leadmarket`, `medicarecallforge`, `mediflowleadsgunter`

---

## Context

Four sibling repositories exist under the same owner, all orbiting the same
Medicare / insurance lead-generation business. Before investing further, we
audited all four to decide which is the canonical "main app," what should be
adopted from the others, and what should be retired. This ADR records the
decision and the evidence behind it so the choice is durable and reviewable.

Audit method: `lead-connect-pro` (LCP) and `leadmarket` server code was read
directly; all load-bearing claims were independently verified against repos
cloned at fixed HEAD commits, producing grep-level evidence (table-by-table
reference counts, endpoint cross-checks, cert-algorithm reads). Pinned commits:
`leadmarket@bc74146`, `lead-connect-pro@e1bc41b`, `medicarecallforge@642c645`,
`mediflowleadsgunter@746e95c`.

### What each repo is (verified)

| Repo | Identity | Stack | DB tables | Endpoints | Status |
|---|---|---|---|---|---|
| **lead-connect-pro** | "LeadMarket" — multi-tenant insurance-lead marketplace | React 19 / Express / Drizzle / PG | **104 defined / 39 wired** | ~115 | Active (PR #113, 2026-06-27) |
| **leadmarket** | "LeadMarket" — same product, lean single-tenant core | React 18 / Express / Drizzle / PG | 11 (all wired) | ~30 | Single snapshot |
| **medicarecallforge** | Compliance-first inbound-call intake + routing engine | **Python / FastAPI** | none (JSONL files) | ~30 | Active, self-declared pre-production |
| **mediflowleadsgunter** | Healthcare inquiry-capture form | Express + flat JSON file | none | 3 | Stale since 2026-04-23 |

### Methodology: definition of "wired" (reproducible)

So future readers can reproduce the audit without re-deriving it, "wired" is
defined precisely as follows:

- **Unit of analysis:** each `export const <var> = pgTable("<name>", …)` in
  `shared/schema.ts` (Drizzle ORM table definitions). Total counted by
  `grep -cE 'export const \w+ = pgTable\('` → **104**.
- **WIRED** = the table's JS variable (or its snake_case table-name literal in
  raw SQL) is referenced by **at least one non-test server file** — every `.ts`
  file under `server/` including `server/lib/` and `server/__integration__/`,
  **excluding** `*.test.ts` and `shared/schema.ts` itself (73 files at the
  pinned commit). A reference means use by the Drizzle query builder
  (`db.select/insert/update/delete(...)` against the table) or a raw-SQL
  table-name literal in a handler/service — not merely a type import.
- **SCHEMA-ONLY** = zero such references. The 65 schema-only tables were
  triple-checked for false negatives: (1) related identifiers
  (`insert<Name>`, `<name>Schema`, `<name>Relations`, `select<Name>`),
  (2) raw snake_case table-name string literals, (3) any reference in
  `*.test.ts` — all three returned zero for all 65.
- **Caveat:** "wired" here is "referenced by server code." For the 39 wired
  tables, reference locations are overwhelmingly `storage.ts` CRUD, making
  genuine query usage clear; a handful could be type-only, so treat 39 as a
  ceiling and 65-unwired as the load-bearing, unambiguous result.

### Key verified findings

1. **`leadmarket` and `lead-connect-pro` are the same product.** Both are
   titled "LeadMarket," both descend from the Replit `rest-express` template
   (LCP still carries the name `rest-express` and `.replit`/`replit.md`
   artifacts), identical stack top to bottom. LCP is the heavily-extended
   branch; `leadmarket` is a lean, fully-wired core.

2. **LCP's schema substantially overstates the working app.** Of **104**
   `pgTable` definitions, only **39 are wired**; **65 are schema-only** (per the
   methodology above). Completeness must be judged on the 39 wired tables /
   ~115 endpoints — still by far the largest working app of the four.

3. **`leadmarket` is NOT a strict subset of LCP.** It has three capabilities
   LCP lacks: a real in-app **notification center** (LCP's `notifications`
   table is an email-dedup ledger and cannot store generic notices), **admin
   user list + role assignment**, and **session lead-comparison**. Its
   `storage.purchaseLead()` is also a cleaner atomic compare-and-swap than LCP's
   heavier purchase path.

4. **`medicarecallforge` (MCF) holds genuinely non-overlapping IP.** Its
   real-time inbound-call Hard Compliance Gate (TPMO-verbatim, SOA-before-
   specifics ordering, PEWC, language-access, evidence derived from transcript,
   fail-closed) and its SHA-256 hash-chained, `verify_chain()`-able audit vault
   have **no equivalent in LCP** — LCP's Twilio usage is purely outbound dialer +
   SMS, and its `admin_audit_log` is a plain best-effort row with no chaining.

5. **Provenance note:** the earlier claim that LCP's Ed25519 certificates were
   "ported from MCF" is **not supported** — LCP contains zero references to MCF.
   The HMAC→Ed25519 upgrade is real and plausibly common-authored, but
   unattributed. Do not repeat the port claim as fact.

---

## Decision

Adopt a **two-component long-term architecture** rather than picking a single
survivor:

### 1. `lead-connect-pro` is the canonical main app
It is the only repo that is a real business platform (marketplace, payments
incl. subscriptions + Connect payouts, multi-tenant org RBAC, agents, CRM,
admin, content) and it is the live line of development with real tests
(Vitest + integration + Playwright) and layered security (Helmet, CSRF, PII
redaction, DOMPurify, `decimal.js` money, webhook signature verification,
idempotency).

### 2. `medicarecallforge` survives as a dedicated compliance + telephony service
It is **not** folded into LCP and **not** retired. LCP calls it as an isolated
microservice. In Medicare lead-gen the compliance gate + tamper-evident audit
trail is the regulatory moat and the primary liability surface; keeping it as an
independently-auditable service is an asset, and it avoids a risky rewrite of
subtle TCPA/TPMO/SOA logic into the Node stack.

### 3. `leadmarket` — harvest, then archive
Port its three unique capabilities (notification center, admin user/role
management, session lead-comparison) and its clean `purchaseLead` compare-and-
swap pattern into LCP, then archive the repo. We will not maintain two
"LeadMarket"s.

### 4. `mediflowleadsgunter` — archive immediately
Minimal inquiry form with unauthenticated PII read **and** delete despite
"HIPAA-conscious" branding; stale. Nothing to adopt.

### Why not "absorb everything into LCP"
LCP's dominant long-term risk is that it already over-absorbed scope (65 unwired
tables). Rewriting MCF's compliance engine into LCP would pile more half-built
surface onto that. The disciplined move is the opposite: **LCP gets narrower and
better-wired; the specialized engine stays specialized.**

### Why not MCF-centric
Compliance is the moat, but MCF has no marketplace, payments, buyers, or
datastore. The commercial hub must be LCP; MCF is the engine it calls.

---

## Consequences

**Positive**
- One system of record; one place to add marketplace/billing features.
- Compliance logic preserved in an isolated, independently-auditable service.
- LCP's schema gets honest — dead scaffolding removed.
- No duplicate "LeadMarket" maintenance.

**Negative / risks**
- Polyglot operations (Node + Python) until/unless a future TS port is justified.
- MCF is pre-production: its gate needs a live ASR/transcription feed and an
  off-box WORM (e.g. S3 Object-Lock) audit tier before it is operational —
  neither exists yet in either repo.
- Pruning 65 tables and harvesting features is real work that must not regress
  the wired surface.

---

## Roadmap

Each phase names an owning repo and a measurable exit criterion so the ADR is
actionable for implementation planning.

**Phase 0 — Freeze & label (now)**
- Owner: `mediflowleadsgunter`, `leadmarket`.
- Work: mark `mediflowleadsgunter` archived; add a deprecation notice to
  `leadmarket` README pointing here.
- Done when: `mediflowleadsgunter` is set to GitHub "Archived"; `leadmarket`
  README links this ADR. No code merges land in either repo afterward.

**Phase 1 — Harvest `leadmarket` into LCP**
- Owner: `lead-connect-pro` (source: `leadmarket`).
- Work: notification center (table semantics + `GET /notifications`,
  `POST /notifications/:id/read`, `read-all`); admin user management
  (`GET /admin/users`, `POST /admin/users/:id/role` with self-demotion guard);
  session lead-comparison (`GET`/`POST /leads/compare`); adopt the
  `purchaseLead` compare-and-swap as the canonical pattern.
- Done when: all three capabilities ship in LCP behind tests (Vitest unit +
  one Playwright/integration path each); the unique-vs-leadmarket gap list is
  empty; `leadmarket` is then archived.

**Phase 2 — Schema hygiene in LCP**
- Owner: `lead-connect-pro`.
- Work: prune or explicitly quarantine the 65 unwired tables and orphan service
  stubs.
- Done when: re-running the wired census yields wired == defined (no
  schema-only tables remain), or each retained-but-unwired table carries an
  inline `// roadmap:` annotation and is excluded from `db:push`; `db:push`
  creates zero dead tables.

**Phase 3 — Wire MCF as the compliance/telephony service**
- Owner: `medicarecallforge` + `lead-connect-pro` (integration).
- Work: stand up MCF behind LCP for inbound-call intake, the Hard Compliance
  Gate, and the hash-chained audit vault; supply a live transcription feed and
  an off-box WORM (S3 Object-Lock) audit tier; a future TS port of the gate is
  optional, pursued only if polyglot ops cost outweighs the rewrite risk.
- Done when: an inbound call traverses the gate end-to-end with transcript-
  derived evidence; every call produces a vault entry whose `verify_chain()`
  passes against the off-box WORM tier; LCP records the returned compliance
  hash on the lead.

---

## Residual uncertainties
- LCP endpoint count (~115) is approximate (route scan, not a line-by-line count).
- "Wired" means "referenced by server code" per the methodology box; verified to
  query level for high-traffic tables and to exactly-zero for the 65 schema-only
  tables.
- Lineage between `leadmarket` and LCP is inferred from shared origin markers
  (title, `rest-express`, Replit artifacts), not a traced shared git history.
