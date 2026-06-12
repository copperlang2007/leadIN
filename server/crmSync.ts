// Wave 6 (K4) — CRM sync orchestrator.
//
// Outbound: when an agent purchases a lead we upsert the consumer as a
// contact and create a deal in every connected CRM for that org. Each
// per-connection failure is recorded and swallowed — one broken token
// never blocks the purchase path.
//
// Inbound: a CRM webhook (signed/normalised by the route handler) tells us
// a deal moved to `closed_won`. We resolve that deal back to the original
// order via the recorded sync events and write a `crm_deal_closed`
// reputation event for K5 to consume.

import type { CrmAdapter, CrmLeadInput, CrmProvider } from "./lib/crm.js";
import { getAdapter as defaultGetAdapter } from "./lib/crm.js";
import { crmReputationIdempotency } from "./lib/eventIdempotency.js";
import type { CrmConnection, CrmSyncEvent, Order } from "@shared/schema";

// The orchestrator only needs a narrow slice of storage so tests can
// stub it in-memory without booting Drizzle.
export interface CrmSyncStorage {
  getLead(id: number): Promise<{ id: number; consumerName?: string | null; consumerPhone?: string | null; consumerEmail?: string | null; state?: string | null; zipCode?: string | null; purchasedBy?: string | null } | undefined>;
  getCrmConnectionsForOrg(orgId: string): Promise<CrmConnection[]>;
  recordCrmSyncEvent(event: {
    connectionId: number;
    direction: "out" | "in";
    resourceType: "contact" | "deal" | "note" | "task";
    resourceId?: string | null;
    externalId?: string | null;
    status: "success" | "error";
    errorMessage?: string | null;
  }): Promise<CrmSyncEvent>;
  findSyncEventByExternalId(externalId: string, resourceType: string): Promise<CrmSyncEvent | undefined>;
  getOrderById(orderId: number): Promise<Order | undefined>;
  recordReputationEvent(input: {
    agentUserId: string;
    eventType: string;
    weight: number;
    relatedLeadId?: number | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface CrmSyncDeps {
  storage: CrmSyncStorage;
  getAdapter?: (provider: string) => CrmAdapter | null;
  logger?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}

export interface SyncResultPerConnection {
  connectionId: number;
  provider: CrmProvider | string;
  contactExternalId?: string;
  dealExternalId?: string;
  error?: string;
}

function priceToCents(price: string | number): number {
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Sync a freshly-purchased order out to every CRM connection on the buyer's
 * org. Failures are isolated per-connection: the orchestrator never throws
 * because purchase flow already committed.
 */
export async function syncOrderToCrms(
  order: Order,
  deps: CrmSyncDeps,
): Promise<SyncResultPerConnection[]> {
  const { storage } = deps;
  const log = deps.logger ?? console;
  const getAdapter = deps.getAdapter ?? defaultGetAdapter;

  const orgId = order.orgId;
  if (!orgId) return []; // direct buyer purchases (no org) — nothing to sync

  let connections: CrmConnection[] = [];
  try {
    connections = await storage.getCrmConnectionsForOrg(orgId);
  } catch (err) {
    log.error("[crmSync] failed to fetch connections for org", orgId, err);
    return [];
  }
  if (connections.length === 0) return [];

  const lead = await storage.getLead(order.leadId).catch(() => undefined);
  if (!lead) {
    log.error("[crmSync] lead missing for order", order.id);
    return [];
  }

  const leadInput: CrmLeadInput = {
    id: lead.id,
    name: lead.consumerName ?? null,
    phone: lead.consumerPhone ?? null,
    email: lead.consumerEmail ?? null,
    state: lead.state ?? null,
    zipCode: lead.zipCode ?? null,
  };
  const salePriceCents = priceToCents(order.price);

  const results: SyncResultPerConnection[] = [];
  for (const conn of connections) {
    if (conn.status !== "active") continue;
    const result: SyncResultPerConnection = { connectionId: conn.id, provider: conn.provider };

    const adapter = getAdapter(conn.provider);
    if (!adapter) {
      result.error = `no_adapter_for_${conn.provider}`;
      await safeRecord(storage, log, {
        connectionId: conn.id,
        direction: "out",
        resourceType: "contact",
        status: "error",
        errorMessage: result.error,
      });
      results.push(result);
      continue;
    }

    const token = conn.accessToken ?? "";
    let contactExternalId: string | undefined;
    try {
      const contact = await adapter.upsertContact(token, leadInput);
      contactExternalId = contact.externalId;
      result.contactExternalId = contact.externalId;
      await safeRecord(storage, log, {
        connectionId: conn.id,
        direction: "out",
        resourceType: "contact",
        resourceId: String(lead.id),
        externalId: contact.externalId,
        status: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.error = `contact:${msg}`;
      await safeRecord(storage, log, {
        connectionId: conn.id,
        direction: "out",
        resourceType: "contact",
        resourceId: String(lead.id),
        status: "error",
        errorMessage: msg,
      });
      results.push(result);
      continue; // no contact → can't create deal
    }

    try {
      const deal = await adapter.createDeal(token, contactExternalId, salePriceCents);
      result.dealExternalId = deal.externalId;
      await safeRecord(storage, log, {
        connectionId: conn.id,
        direction: "out",
        resourceType: "deal",
        resourceId: String(order.id),
        externalId: deal.externalId,
        status: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.error = `deal:${msg}`;
      await safeRecord(storage, log, {
        connectionId: conn.id,
        direction: "out",
        resourceType: "deal",
        resourceId: String(order.id),
        status: "error",
        errorMessage: msg,
      });
    }

    results.push(result);
  }
  return results;
}

async function safeRecord(
  storage: CrmSyncStorage,
  log: { error: (...args: unknown[]) => void },
  event: Parameters<CrmSyncStorage["recordCrmSyncEvent"]>[0],
): Promise<void> {
  try {
    await storage.recordCrmSyncEvent(event);
  } catch (err) {
    log.error("[crmSync] failed to record sync event", err);
  }
}

// ──────────────────────────────────────────────────────
// Inbound webhook normalisation
// ──────────────────────────────────────────────────────

export interface NormalizedWebhookPayload {
  resourceType: "contact" | "deal" | "note" | "task";
  externalId: string;
  status: string;
}

/**
 * Per-provider payload shapes will diverge significantly in production
 * (HubSpot delivers an event envelope, Salesforce uses platform events,
 * GHL has its own webhook schema, Pipedrive nests under `current`). For
 * now we accept a normalised dev shape and provide a thin shim per
 * provider that hydrates the common fields. Webhook signature verification
 * is intentionally TODO — wired at the route layer when real OAuth lands.
 */
export function parseWebhookPayload(
  provider: string,
  body: unknown,
): NormalizedWebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  // Dev / generic shape (also used by the stub route in dev): callers send
  // { resourceType, externalId, status } directly.
  if (typeof b.resourceType === "string" && typeof b.externalId === "string" && typeof b.status === "string") {
    if (!isResourceType(b.resourceType)) return null;
    return { resourceType: b.resourceType, externalId: b.externalId, status: b.status };
  }

  switch (provider) {
    case "hubspot": {
      // HubSpot delivers an array of events; we pick the first deal stage change.
      const events = Array.isArray((b as any).events) ? (b as any).events : Array.isArray(body) ? (body as any[]) : null;
      const ev = events?.find?.((e: any) => e?.subscriptionType?.includes?.("deal") || e?.objectType === "deal");
      if (ev && typeof ev.objectId !== "undefined") {
        return {
          resourceType: "deal",
          externalId: String(ev.objectId),
          status: typeof ev.propertyValue === "string" ? ev.propertyValue : "closed_won",
        };
      }
      return null;
    }
    case "salesforce": {
      // Salesforce platform events: { Id, Stage, Type }
      if (typeof b.Id === "string" && typeof b.Stage === "string") {
        return { resourceType: "deal", externalId: b.Id, status: b.Stage };
      }
      return null;
    }
    case "ghl": {
      // GHL: { type: 'OpportunityStatusUpdate', opportunityId, status }
      if (typeof b.opportunityId === "string") {
        return { resourceType: "deal", externalId: b.opportunityId, status: String(b.status ?? "") };
      }
      return null;
    }
    case "pipedrive": {
      // Pipedrive: { event: 'updated.deal', current: { id, status } }
      const current = b.current as { id?: number | string; status?: string } | undefined;
      if (current && typeof current.id !== "undefined") {
        return { resourceType: "deal", externalId: String(current.id), status: String(current.status ?? "") };
      }
      return null;
    }
    default:
      return null;
  }
}

function isResourceType(v: string): v is NormalizedWebhookPayload["resourceType"] {
  return v === "contact" || v === "deal" || v === "note" || v === "task";
}

const CLOSED_WON_VALUES = new Set([
  "closed_won",
  "closedwon",
  "won",
  "closed_won".toLowerCase(),
]);

export function isClosedWon(status: string): boolean {
  return CLOSED_WON_VALUES.has(status.toLowerCase().replace(/\s|-/g, "_"));
}

/**
 * Handle an inbound webhook hit. Returns whether a reputation event was
 * emitted so the route can return a useful 200 body. The reputation event
 * itself (eventType=`crm_deal_closed`, weight=+10) is the K5 integration
 * point — K5 owns the score computation.
 */
export async function handleInboundWebhook(
  provider: string,
  body: unknown,
  deps: CrmSyncDeps,
): Promise<{ matched: boolean; repEmitted: boolean; reason?: string }> {
  const { storage } = deps;
  const log = deps.logger ?? console;

  const normalised = parseWebhookPayload(provider, body);
  if (!normalised) return { matched: false, repEmitted: false, reason: "unparseable" };

  // Only deal events change reputation today. Other types are recorded but
  // don't fire repuation updates.
  if (normalised.resourceType !== "deal") {
    return { matched: false, repEmitted: false, reason: "not_a_deal" };
  }

  const match = await storage.findSyncEventByExternalId(normalised.externalId, "deal").catch(() => undefined);
  if (!match) return { matched: false, repEmitted: false, reason: "no_matching_event" };

  // Record the inbound event for audit trail.
  await safeRecord(storage, log, {
    connectionId: match.connectionId,
    direction: "in",
    resourceType: "deal",
    resourceId: match.resourceId ?? null,
    externalId: normalised.externalId,
    status: "success",
  });

  if (!isClosedWon(normalised.status)) {
    return { matched: true, repEmitted: false, reason: `status_${normalised.status}` };
  }

  // Resolve the original order → buying agent for the reputation event.
  const orderId = match.resourceId ? Number(match.resourceId) : NaN;
  if (!Number.isFinite(orderId)) {
    return { matched: true, repEmitted: false, reason: "order_id_missing" };
  }
  const order = await storage.getOrderById(orderId).catch(() => undefined);
  if (!order || !order.userId) {
    return { matched: true, repEmitted: false, reason: "order_not_found" };
  }

  // Dedup at the application level so a replayed closed-won webhook
  // can't pump up an agent's reputation indefinitely. Even a properly
  // signed webhook from a real CRM can fire twice on retry.
  const idempotencyKey = `${provider}:${normalised.externalId}`;
  if (!crmReputationIdempotency.markSeenOnce(idempotencyKey)) {
    return { matched: true, repEmitted: false, reason: "rep_already_emitted" };
  }

  try {
    await storage.recordReputationEvent({
      agentUserId: order.userId,
      eventType: "crm_deal_closed",
      weight: 10,
      relatedLeadId: order.leadId,
      metadata: { provider, externalId: normalised.externalId, orderId },
    });
  } catch (err) {
    log.error("[crmSync] failed to record reputation event", err);
    return { matched: true, repEmitted: false, reason: "rep_write_failed" };
  }

  return { matched: true, repEmitted: true };
}
