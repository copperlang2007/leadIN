# Implementation plan

State for the Ralph-style loop. Each iteration: read this file, pick the
highest-priority **[ ]** item, ship it, flip to **[x]**, commit. Stop when
no `[ ]` item is tractable in this environment.

## Rules
- One thing per iteration.
- Tractable = no missing creds, no big refactor, no item that needs human review.
- Commit each iteration. CI must stay green.
- If an item proves untractable mid-iteration, mark `[~]` with the reason and skip.

## Backlog (priority order)

- [x] **dnc-recheck**: nightly cron at 02:30 + admin `POST /api/admin/dnc/recheck`. MediScore recomputes on flag flip.
- [ ] **stripe-price-ids**: read `STRIPE_PRICE_STARTER/GROWTH/SCALE` env vars; fall back to inline `price_data` only if unset. Touches `server/routes.ts`.
- [ ] **marketplace-dnc-toggle**: UI checkbox to show DNC-flagged leads. Touches `client/src/pages/marketplace.tsx`.
- [ ] **marketplace-mediscore-sort**: add a sort-by-MediScore option. Touches marketplace.
- [ ] **architect-blueprint-refresh**: update `/architect` page to reflect orgs, routing, MediScore, signal feeds.
- [ ] **eslint-config**: add eslint with TypeScript + React plugins; `npm run lint`. Touches `package.json`, new `.eslintrc`.
- [ ] **landing-empty-state**: new-user onboarding card on the marketplace when no orders and no profile.
- [ ] **money-math-decimal**: replace `parseFloat` with `decimal.js` for wallet ops. Touches storage + routes.

## Stop criteria

When the remaining backlog is dominated by `[~]` items (need creds / human review),
write a final summary comment to the PR and end the loop.
