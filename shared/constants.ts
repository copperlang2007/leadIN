// Constants shared between the server and the client (imported via the
// `@shared` alias on both sides) so limits can't silently diverge.

// Maximum number of leads in a comparison list. Backs both the session-scoped
// server cap (server/leadComparison.ts) and the marketplace compare UI.
export const MAX_COMPARE = 4;

// Maximum number of leads in a single Bulk Buy (atomic multi-lead purchase).
// Bounds the size of the purchase transaction (rows locked FOR UPDATE) so one
// request can't lock unbounded inventory. Shared so the client can guard too.
export const MAX_BULK_PURCHASE = 50;
