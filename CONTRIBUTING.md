# Contributing

## Branch naming

- `feature/<short-slug>` — new functionality
- `fix/<short-slug>` — bug fixes
- `swarm/<wave>/<envelope>` — multi-agent swarm work (reserved; do not use for solo PRs)

Branch from `main`. Rebase, don't merge, when updating from `main`.

## Before pushing

Run all four checks. CI runs the same set, so a failure here is a failure there.

```bash
npm run check        # tsc, no emit
npm run test         # vitest run
npm run lint         # eslint
npm run check:env    # .env.example covers every process.env.X reference
```

If `check:env` fails, add the missing variable (with a comment explaining what it does and the safe default) to `.env.example`.

## Running a single test

```bash
npx vitest server/storage.test.ts
```

Pass `--watch` for TDD. For live-DB tests, set `LIVE_DB_TESTS=1` and point `DATABASE_URL` at a throwaway Postgres.

## Database migrations

1. Edit `shared/schema.ts`.
2. `npm run db:generate` — drizzle-kit writes a new SQL file under `migrations/`.
3. Review the generated SQL. Commit `shared/schema.ts` and the new migration together.
4. `npm run db:push` to apply locally (or run the migration against your dev Postgres directly).

CI re-runs `db:generate` and fails if the working tree diverges, so always commit the regenerated migration.

## Pull requests

Use the template at `.github/PULL_REQUEST_TEMPLATE.md`. Keep PRs focused — one feature or one fix per PR. Cross-cutting changes (schema + server + client) are fine; unrelated drive-by edits are not.
