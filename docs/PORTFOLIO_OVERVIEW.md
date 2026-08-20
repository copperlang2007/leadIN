# Repository Portfolio Overview

> **One-page map of the four-repo LeadMarket portfolio and where each stands
> in the consolidation.** This is the navigation layer; the decision and its
> grep-level evidence live in
> [ADR 0001 — Repository Consolidation Strategy](./adr/0001-repo-consolidation-strategy.md).
> Where the two disagree, the ADR wins.

- **Owner:** copperlang@gmail.com
- **Last reconciled:** 2026-08-20
- **Decision of record:** two-component architecture — `lead-connect-pro` is the
  canonical app; `medicarecallforge` survives as an isolated compliance/telephony
  service; `leadmarket` is harvested then archived; `mediflowleadsgunter` is
  archived immediately.

---

## The four repositories at a glance

| Repo | Identity | Stack | Data | Endpoints | Role in target architecture | Status |
|---|---|---|---|---|---|---|
| **lead-connect-pro** | "LeadMarket" — multi-tenant insurance-lead marketplace | React 19 / Express / Drizzle / PG | 104 tables defined, **39 wired** (65 schema-only) | ~115 | **Canonical main app** — commercial hub | 🟢 Active |
| **medicarecallforge** | Compliance-first inbound-call intake + routing engine | **Python / FastAPI** | JSONL files (no DB) | ~30 | **Survives** — isolated compliance + telephony microservice LCP calls | 🟡 Pre-production |
| **leadmarket** | "LeadMarket" — same product, lean single-tenant core | React 18 / Express / Drizzle / PG | 11 tables (all wired) | ~30 | **Harvest → archive** — 3 unique features move into LCP | 🟠 Deprecated |
| **mediflowleadsgunter** | Healthcare inquiry-capture form | Express + flat JSON file | none | 3 | **Archive immediately** — nothing carried forward | 🔴 Retired |

> **Read "39 wired," not "104."** LCP's schema defines 104 Drizzle tables but only
> 39 are referenced by non-test server code; 65 are scaffolding. Judge the working
> app on the 39 wired tables / ~115 endpoints — still by far the largest of the
> four. See the ADR's reproducible "definition of *wired*" methodology box.

---

## Why this shape (not "absorb everything into LCP")

The dominant long-term risk is that LCP has **already over-absorbed scope** — 65
unwired tables of dead scaffolding. Rewriting MCF's subtle TCPA/TPMO/SOA
compliance logic into the Node stack would pile more half-built surface onto that
risk. The disciplined move is the opposite:

- **LCP gets narrower and better-wired** — it is the only real business platform
  (marketplace, Stripe payments + subscriptions + Connect payouts, multi-tenant
  org RBAC, CRM, admin) with real tests and layered security.
- **The specialized engine stays specialized** — MCF's real-time Hard Compliance
  Gate (fail-closed) and SHA-256 hash-chained, `verify_chain()`-able audit vault
  are the **regulatory moat and primary liability surface**. Keeping them as an
  independently-auditable service is an asset, not debt.

MCF-centric was rejected for the mirror reason: compliance is the moat, but MCF
has no marketplace, payments, buyers, or datastore. **The hub must be LCP; MCF is
the engine it calls.**

---

## What each retiring repo leaves behind

**`leadmarket` is not a strict subset of LCP** — it must be harvested before it is
archived. Three capabilities + one pattern move into LCP:

1. **In-app notification center** — LCP's `notifications` table is an email-dedup
   ledger and cannot store generic notices.
2. **Admin user list + role assignment** (with a self-demotion guard).
3. **Session lead-comparison.**
4. Its clean atomic **`purchaseLead` compare-and-swap** — adopted as LCP's
   canonical purchase pattern.

**`mediflowleadsgunter` leaves nothing.** Minimal inquiry form that exposed lead
PII over **unauthenticated read *and* delete** endpoints despite HIPAA-conscious
branding; stale since 2026-04-23.

**Provenance correction:** the earlier claim that LCP's Ed25519 certificates were
"ported from MCF" is **not supported** — LCP contains zero references to MCF. The
HMAC→Ed25519 upgrade is real but unattributed. Do not repeat the port claim.

---

## Consolidation roadmap

Each phase names an owning repo and a measurable exit criterion (full detail in
the ADR's Roadmap section).

| Phase | Owner | Work | Done when |
|---|---|---|---|
| **0 — Freeze & label** ✅ | `mediflowleadsgunter`, `leadmarket` | Archive mediflow; add deprecation notices pointing to ADR 0001 | Notices merged, no further code merges — **done on this branch** |
| **1 — Harvest** | `lead-connect-pro` (← `leadmarket`) | Port notification center, admin user/role mgmt, session compare, `purchaseLead` pattern | All three ship behind tests; unique-gap list empty; `leadmarket` archived |
| **2 — Schema hygiene** | `lead-connect-pro` | Prune/quarantine the 65 unwired tables + orphan stubs | Wired census = defined, or each retained table has a `// roadmap:` note; `db:push` creates zero dead tables |
| **3 — Wire MCF** | `medicarecallforge` + `lead-connect-pro` | Stand up MCF behind LCP; live transcription feed; off-box WORM (S3 Object-Lock) audit tier | Inbound call traverses the gate end-to-end; every call's `verify_chain()` passes; LCP records the compliance hash on the lead |

---

## Open risks carried into the target architecture

- **Polyglot operations** (Node + Python) until/unless a future TS port of the
  gate is justified — pursued only if ops cost outweighs rewrite risk.
- **MCF is pre-production**: the gate needs a live ASR/transcription feed and an
  off-box WORM audit tier before it is operational; neither exists in either repo
  yet. Do not point production traffic at MCF.
- **Harvest + prune is real work** that must not regress LCP's wired surface.

---

## Source documents

- [ADR 0001 — Repository Consolidation Strategy](./adr/0001-repo-consolidation-strategy.md) — decision + evidence
- [`PHASE_PLAN.md`](../PHASE_PLAN.md) — LCP shipped-vs-planned build status
- Deprecation notices: `leadmarket/README.md`, `mediflowleadsgunter/README.md`
