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
- [x] **stripe-price-ids**: env vars `STRIPE_PRICE_STARTER/GROWTH/SCALE`; inline fallback for dev.
- [x] **marketplace-dnc-toggle**: checkbox above the grid; passes `?includeDnc=true`.
- [x] **marketplace-mediscore-sort**: native `<select>` with relevance/MediScore/newest/price asc+desc.
- [ ] **architect-blueprint-refresh**: update `/architect` page to reflect orgs, routing, MediScore, signal feeds.
- [x] **eslint-config**: eslint 10 flat config, `npm run lint`, wired into CI. 0 errors, 45 stylistic warnings.
- [ ] **landing-empty-state**: new-user onboarding card on the marketplace when no orders and no profile.
- [ ] **money-math-decimal**: replace `parseFloat` with `decimal.js` for wallet ops. Touches storage + routes.

## Stop criteria

When the remaining backlog is dominated by `[~]` items (need creds / human review),
write a final summary comment to the PR and end the loop.
