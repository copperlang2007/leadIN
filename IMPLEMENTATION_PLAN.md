# End-to-end completion loop

Each iteration: pick the top **[ ]** item, ship it, flip to **[x]**, commit.
Loop ends when remaining items need creds, real infra, or are out of scope.

## Backlog

- [ ] **mediscore-pure-tests**: extract pure scoring fn from `mediscore.ts` so it's testable without DB; add 6+ unit tests covering each signal class.
- [ ] **routing-pure-tests**: same for the agent-ranking logic; tests prove the tie-break order.
- [ ] **conversion-rate-update**: `PATCH /api/agent/:userId/conversion-rate` (admin only); UI field in `/org-admin`. Unblocks "$0 estimated commissions" bug.
- [ ] **saved-lists**: real feature — `saved_lists` + `saved_list_items` tables, CRUD endpoints, `/saved` page. Restore the nav link.
- [ ] **migrations-dry-run-ci**: GitHub Action step that applies `migrations/*.sql` against a throwaway Postgres service.
- [ ] **lead-view-event**: fire a behavioral event when a user opens a lead detail dialog; lets MediScore's behavior signals fire on real leads.
- [ ] **email-digest-cron**: daily org-admin digest (new leads, new assignments, conversion%) — only sends when SendGrid/Resend key is configured.

## Deferred

- [~] **Sentry/OTEL**: needs project DSN
- [~] **Real PG integration tests**: testcontainers not available in this env
- [~] **License doc upload**: needs object storage SDK
- [~] **17 Dependabot CVEs**: per-package review
