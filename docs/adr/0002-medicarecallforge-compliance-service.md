# ADR 0002 — MedicareCallForge as the compliance & telephony service

- **Status:** Proposed (blocked on infra decisions — see §7)
- **Date:** 2026-06-29
- **Owner:** copperlang@gmail.com
- **Builds on:** [ADR 0001](./0001-repo-consolidation-strategy.md) (Phase 3)

---

## Context

ADR 0001 decided that `medicarecallforge` (MCF) survives as a **dedicated
compliance + telephony microservice** that `lead-connect-pro` (LCP) calls — not
folded in, not retired. This ADR specifies *how* that integration works so the
wiring can be planned and reviewed before any code or infra is built.

Recap of why MCF stays a separate service:
- **Non-overlapping IP.** MCF owns a real-time inbound-call **Hard Compliance
  Gate** (TPMO-verbatim, SOA-before-specifics ordering, PEWC, language-access,
  evidence derived from transcript, fail-closed) and a **SHA-256 hash-chained,
  `verify_chain()`-able audit vault**. LCP has neither — its Twilio usage is
  outbound dialer + SMS only, and `admin_audit_log` is a plain row with no
  chaining.
- **It's Python.** Adoption = stand up a service, not a code merge. Rewriting
  subtle TCPA/TPMO/SOA logic into the Node stack is a risk we explicitly avoid.
- **Isolation is an asset.** An independently-auditable compliance/audit service
  is desirable for regulatory defensibility.

MCF is self-declared **pre-production**: its gate needs a live transcription
feed and an off-box WORM audit tier to be operational. Those are infra
prerequisites, not code (see §7).

---

## Decision — service boundary

```
                 consumer call
                      │
                      ▼
            ┌───────────────────────┐     inbound webhook (Twilio-signed)
   Twilio ──►        MCF            │◄──────────────────────────────────────
            │  (Python / FastAPI)   │
            │  • Hard Compliance    │   owns:
            │    Gate               │   - inbound telephony + TwiML
            │  • UVal routing       │   - compliance decision + evidence
            │  • hash-chained       │   - tamper-evident audit vault (WORM)
            │    audit vault        │   - compliance certificate issuance
            │  • certificate issue  │
            └───────────┬───────────┘
                        │  signed HTTPS (service-to-service)
                        ▼
            ┌───────────────────────┐
            │         LCP           │   owns:
            │  (Node / Express)     │   - marketplace, billing, wallet
            │  • marketplace        │   - agents, orgs, CRM, admin
            │  • lead ingest API    │   - lead lifecycle + assignment
            │  • agent assignment   │   consumes:
            │  • cert verification  │   - compliance decision + proof
            └───────────────────────┘
```

**MCF owns** the call until a compliance decision exists. **LCP owns** the
lead/agent/billing lifecycle and *consumes* MCF's compliance output. Neither
reaches into the other's database.

---

## Integration contract (proposed)

All service-to-service calls are authenticated (see §6) and carry a request id
for tracing. Shapes below are a starting point, to be firmed up in implementation.

### 1. MCF → LCP: deliver a compliant lead (Stream 2 "sell")
When the gate passes and UVal routes the call to "sell", MCF packages a
PII-minimized lead plus compliance proof and posts it to LCP's existing ingest
surface (extended with a proof block):

```
POST /api/v1/leads/ingest        (LCP, vendor-API-key auth, already exists)
{
  ...existing lead fields...,
  "compliance": {
    "source": "medicarecallforge",
    "callId": "…",
    "decision": "sell_call",
    "complianceHash": "<audit chain hash>",
    "certificate": "<signed compliance certificate>",
    "disclosures": { "tpmo": true, "soaBeforeSpecifics": true, "pewc": true, ... }
  }
}
```
LCP verifies the certificate (see §5) before accepting; on failure → `422`.

### 2. MCF → LCP: hand off an enroll-in-house call (Stream 1)
For "enroll" routing, MCF signals LCP to assign the call/lead to a licensed
agent. Reuses LCP's lead-assignment machinery:

```
POST /api/v1/calls/enroll        (LCP, new, service-auth)
{ "callId": "…", "leadId": <optional existing>, "state": "TX", "complianceHash": "…" }
→ LCP returns the assigned agent + a TaskRouter target MCF enqueues to.
```

### 3. LCP → MCF: verify a certificate / fetch audit proof
A buyer (or LCP admin) can verify a lead's compliance without trusting the
seller:

```
POST /compliance/verify          (MCF, service-auth)  → { valid: bool, reason }
GET  /audit/proof?callId=…        (MCF, service-auth)  → chain segment + verify_chain result
```

### 4. Outcome reconciliation (revenue honesty)
LCP confirms real outcomes (enrollment/sale) back to MCF so MCF's dual-stream
economics stay truthful (cost-at-call, revenue only on confirmed outcome):

```
POST /outcomes/confirm           (MCF, service-auth)  { callId, outcome, revenueCents }
```

---

## Certificate authority — a decision to make

Both repos already have certificate code, with **different algorithms**:
- **MCF** issues **HMAC-SHA256** certificates (symmetric; its own docs flag
  ed25519 as the intended upgrade).
- **LCP** has `server/complianceCertService.ts` issuing **Ed25519** certificates
  (asymmetric, public-verifiable). Note LCP's `compliance_certifications` table
  is currently **unwired** (see SCHEMA-STATUS.md) — the service issues at runtime
  but doesn't persist.

**Proposal:** consolidate on **Ed25519 as the single authority**, issued by MCF
(upgrading its HMAC signer — the surface is identical per its own code) so a
buyer verifies with a public key and never trusts the seller. LCP then *verifies
only*, and wires `compliance_certifications` to persist issued certs. This must
be decided before implementation.

---

## Auth (service-to-service)
- MCF inbound webhooks: **Twilio signature** validation, fail-closed (already in
  MCF).
- MCF ↔ LCP: signed requests with a shared service credential (HMAC over body +
  timestamp) or mTLS. The existing LCP vendor-API-key path can bootstrap #1.
- No end-user session crosses the boundary; these are server-to-server.

---

## Infra prerequisites (the blockers — owner decisions)
These are **not** code and gate go-live:
1. **Hosting for MCF** — Docker/Railway (MCF ships a `Dockerfile` + `railway.toml`).
2. **Live transcription / ASR feed** — without it the gate fails closed (blocks
   every call). Pick a provider (e.g. Twilio Media Streams + an ASR).
3. **Off-box WORM audit tier** — S3 Object-Lock (MCF scaffolds an S3 sink); makes
   the vault tamper-*resistant*, not just tamper-*evident*. Required for CMS
   10-year retention.
4. **Secrets / BAAs** — signing keys, service credentials, and any vendor BAAs
   for PHI handling.

---

## Rollout plan
1. **Shadow mode.** Deploy MCF; run the gate on real calls but do **not** block —
   log decisions + write the audit vault. Compare against current behaviour.
2. **Enforce sell-stream.** Route "sell" calls through MCF → LCP ingest with
   proof; LCP rejects on failed verification.
3. **Enforce enroll-stream.** Hand "enroll" calls to LCP assignment.
4. **Wire outcome reconciliation** + persist certificates in LCP.
5. **Decommission** any overlapping ad-hoc compliance shortcuts in LCP.

Each step is independently reversible by feature flag.

---

## Consequences
- **Positive:** regulation-grade compliance + tamper-evident audit without a Node
  rewrite; clean ownership boundary; buyer-verifiable certificates.
- **Negative / risk:** polyglot ops (Node + Python); MCF is pre-production and
  gated on the §7 infra; a live ASR feed is on the critical path (gate blocks
  without it); cert-authority consolidation must land first to avoid two
  competing cert formats.

---

## Open decisions (need owner input)
1. Certificate authority: consolidate on **Ed25519 issued by MCF**? (§5)
2. Hosting target for MCF and the ASR provider? (§7)
3. Service-auth mechanism: signed-HMAC vs mTLS? (§6)
4. Do we ever port the gate to TS later, or keep MCF Python indefinitely?

This ADR is **Proposed** — it is the integration design, not an approval to
build. Implementation starts once the §7 infra and §"Open decisions" are settled.
