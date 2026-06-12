// Wave 6 (K4) — Orchestrator unit tests.
//
// We stub `CrmSyncStorage` in-memory so we exercise the full outbound +
// inbound flow without booting Postgres or the real CRM adapters. The
// adapter layer is injected via `deps.getAdapter`, so we can simulate
// per-connection failures and confirm they're isolated.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { syncOrderToCrms, handleInboundWebhook, parseWebhookPayload, isClosedWon } from "./crmSync.js";
import { crmReputationIdempotency } from "./lib/eventIdempotency.js";
import type { CrmAdapter } from "./lib/crm.js";
import type { CrmSyncStorage } from "./crmSync.js";
import type { CrmConnection, CrmSyncEvent, Order } from "@shared/schema";

function makeStubStorage() {
  const connections: CrmConnection[] = [];
  const events: CrmSyncEvent[] = [];
  const reputationEvents: Array<{
    agentUserId: string;
    eventType: string;
    weight: number;
    relatedLeadId?: number | null;
    metadata?: Record<string, unknown>;
  }> = [];
  const leads = new Map<number, any>();
  const orders = new Map<number, Order>();
  let nextEventId = 1;

  const storage: CrmSyncStorage = {
    async getLead(id) {
      return leads.get(id);
    },
    async getCrmConnectionsForOrg(_orgId) {
      return connections;
    },
    async recordCrmSyncEvent(event) {
      const row = {
        id: nextEventId++,
        connectionId: event.connectionId,
        direction: event.direction,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        externalId: event.externalId ?? null,
        status: event.status,
        errorMessage: event.errorMessage ?? null,
        createdAt: new Date(),
      } as CrmSyncEvent;
      events.push(row);
      return row;
    },
    async findSyncEventByExternalId(externalId, resourceType) {
      return events.find(
        e => e.externalId === externalId && e.resourceType === resourceType && e.direction === "out",
      );
    },
    async getOrderById(orderId) {
      return orders.get(orderId);
    },
    async recordReputationEvent(input) {
      reputationEvents.push(input);
    },
  };

  return { storage, connections, events, reputationEvents, leads, orders };
}

function makeFakeAdapter(overrides: Partial<CrmAdapter> = {}): CrmAdapter {
  return {
    provider: "hubspot",
    async upsertContact(_t, lead) {
      return { externalId: `contact_${lead.id}` };
    },
    async createDeal(_t, contactId, amount) {
      return { externalId: `deal_${contactId}_${amount}` };
    },
    async addNote(_t, contactId, body) {
      return { externalId: `note_${contactId}` };
    },
    async createTask(_t, contactId) {
      return { externalId: `task_${contactId}` };
    },
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 100,
    userId: "agent-1",
    orgId: "org-1",
    leadId: 7,
    price: "50.00",
    status: "completed",
    createdAt: new Date(),
    ...overrides,
  } as Order;
}

function makeConnection(overrides: Partial<CrmConnection> = {}): CrmConnection {
  return {
    id: 1,
    orgId: "org-1",
    provider: "hubspot",
    accessToken: "tok",
    refreshToken: null,
    tokenExpiresAt: null,
    scopes: null,
    externalAccountId: null,
    status: "active",
    createdAt: new Date(),
    ...overrides,
  } as CrmConnection;
}

const silentLogger = { error: () => {}, info: () => {} };

describe("syncOrderToCrms", () => {
  let s: ReturnType<typeof makeStubStorage>;
  beforeEach(() => {
    s = makeStubStorage();
    s.leads.set(7, { id: 7, consumerName: "Jane", consumerPhone: "+15550001234", consumerEmail: "jane@x.com", state: "CA", zipCode: "94110" });
  });

  it("returns [] when the order has no org (direct buyer)", async () => {
    const result = await syncOrderToCrms(makeOrder({ orgId: null }), {
      storage: s.storage,
      getAdapter: () => makeFakeAdapter(),
      logger: silentLogger,
    });
    expect(result).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it("returns [] when the org has no CRM connections", async () => {
    const result = await syncOrderToCrms(makeOrder(), {
      storage: s.storage,
      getAdapter: () => makeFakeAdapter(),
      logger: silentLogger,
    });
    expect(result).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it("upserts a contact and creates a deal per active connection, recording both events", async () => {
    s.connections.push(makeConnection());
    s.connections.push(makeConnection({ id: 2, provider: "salesforce" }));

    const adapter = makeFakeAdapter();
    const result = await syncOrderToCrms(makeOrder(), {
      storage: s.storage,
      getAdapter: () => adapter,
      logger: silentLogger,
    });

    expect(result).toHaveLength(2);
    expect(result[0].contactExternalId).toBe("contact_7");
    expect(result[0].dealExternalId).toBe("deal_contact_7_5000");
    expect(result[0].error).toBeUndefined();

    // Each connection records one contact event + one deal event.
    expect(s.events).toHaveLength(4);
    const dealEvents = s.events.filter(e => e.resourceType === "deal");
    expect(dealEvents).toHaveLength(2);
    expect(dealEvents.every(e => e.status === "success")).toBe(true);
    expect(dealEvents.every(e => e.direction === "out")).toBe(true);
  });

  it("skips connections marked inactive", async () => {
    s.connections.push(makeConnection({ status: "revoked" }));
    const result = await syncOrderToCrms(makeOrder(), {
      storage: s.storage,
      getAdapter: () => makeFakeAdapter(),
      logger: silentLogger,
    });
    expect(result).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it("isolates errors per connection — one broken token does not block siblings", async () => {
    s.connections.push(makeConnection({ id: 1, provider: "hubspot" }));
    s.connections.push(makeConnection({ id: 2, provider: "salesforce" }));

    const adapter: CrmAdapter = makeFakeAdapter({
      async upsertContact(_t, lead) {
        // Fail hubspot, succeed salesforce.
        if (this.provider === "hubspot") throw new Error("invalid_token");
        return { externalId: `contact_${lead.id}` };
      },
    });

    const getAdapter = (provider: string) => ({ ...adapter, provider } as CrmAdapter);

    const result = await syncOrderToCrms(makeOrder(), {
      storage: s.storage,
      getAdapter,
      logger: silentLogger,
    });

    expect(result).toHaveLength(2);
    const hs = result.find(r => r.provider === "hubspot")!;
    const sf = result.find(r => r.provider === "salesforce")!;
    expect(hs.error).toMatch(/invalid_token/);
    expect(hs.dealExternalId).toBeUndefined();
    expect(sf.error).toBeUndefined();
    expect(sf.dealExternalId).toBeDefined();

    // Hubspot recorded the contact failure but no deal attempt.
    const hsEvents = s.events.filter(e => e.connectionId === 1);
    expect(hsEvents).toHaveLength(1);
    expect(hsEvents[0].status).toBe("error");
    expect(hsEvents[0].resourceType).toBe("contact");
  });

  it("records an error event when no adapter is registered for the provider", async () => {
    s.connections.push(makeConnection({ provider: "zoho" as any }));
    const result = await syncOrderToCrms(makeOrder(), {
      storage: s.storage,
      getAdapter: () => null,
      logger: silentLogger,
    });
    expect(result[0].error).toBe("no_adapter_for_zoho");
    expect(s.events).toHaveLength(1);
    expect(s.events[0].status).toBe("error");
  });

  it("never throws when the storage layer throws (purchase already committed)", async () => {
    s.connections.push(makeConnection());
    const adapter = makeFakeAdapter({
      async createDeal() {
        throw new Error("network");
      },
    });
    // Even with a thrown error inside createDeal, syncOrderToCrms resolves.
    await expect(
      syncOrderToCrms(makeOrder(), { storage: s.storage, getAdapter: () => adapter, logger: silentLogger }),
    ).resolves.toBeDefined();
  });

  it("converts price strings to cents for createDeal", async () => {
    s.connections.push(makeConnection());
    const createDeal = vi.fn(async (_t: string, contactId: string, amount: number) => ({
      externalId: `deal_${contactId}_${amount}`,
    }));
    const adapter = makeFakeAdapter({ createDeal });
    await syncOrderToCrms(makeOrder({ price: "123.45" }), {
      storage: s.storage,
      getAdapter: () => adapter,
      logger: silentLogger,
    });
    expect(createDeal).toHaveBeenCalledWith("tok", "contact_7", 12345);
  });
});

describe("parseWebhookPayload", () => {
  it("accepts the generic/dev shape", () => {
    const result = parseWebhookPayload("hubspot", { resourceType: "deal", externalId: "abc", status: "closed_won" });
    expect(result).toEqual({ resourceType: "deal", externalId: "abc", status: "closed_won" });
  });

  it("rejects an unknown resourceType in the generic shape", () => {
    const result = parseWebhookPayload("hubspot", { resourceType: "ghost", externalId: "abc", status: "x" });
    expect(result).toBeNull();
  });

  it("parses a hubspot event envelope", () => {
    const result = parseWebhookPayload("hubspot", {
      events: [{ subscriptionType: "deal.propertyChange", objectId: 99, propertyValue: "closedwon" }],
    });
    expect(result).toEqual({ resourceType: "deal", externalId: "99", status: "closedwon" });
  });

  it("parses a salesforce platform event", () => {
    const result = parseWebhookPayload("salesforce", { Id: "006xx", Stage: "Closed Won" });
    expect(result).toEqual({ resourceType: "deal", externalId: "006xx", status: "Closed Won" });
  });

  it("parses a ghl opportunity update", () => {
    const result = parseWebhookPayload("ghl", { opportunityId: "opp_1", status: "won" });
    expect(result).toEqual({ resourceType: "deal", externalId: "opp_1", status: "won" });
  });

  it("parses a pipedrive deal update", () => {
    const result = parseWebhookPayload("pipedrive", { event: "updated.deal", current: { id: 42, status: "won" } });
    expect(result).toEqual({ resourceType: "deal", externalId: "42", status: "won" });
  });

  it("returns null on garbage", () => {
    expect(parseWebhookPayload("hubspot", null)).toBeNull();
    expect(parseWebhookPayload("hubspot", "not-an-object")).toBeNull();
    expect(parseWebhookPayload("unknown", { foo: 1 })).toBeNull();
  });
});

describe("isClosedWon", () => {
  it("recognises common won variants", () => {
    expect(isClosedWon("closed_won")).toBe(true);
    expect(isClosedWon("Closed Won")).toBe(true);
    expect(isClosedWon("closed-won")).toBe(true);
    expect(isClosedWon("won")).toBe(true);
  });
  it("does not match non-won statuses", () => {
    expect(isClosedWon("open")).toBe(false);
    expect(isClosedWon("closed_lost")).toBe(false);
  });
});

describe("handleInboundWebhook", () => {
  let s: ReturnType<typeof makeStubStorage>;
  beforeEach(() => {
    // The reputation idempotency tracker is module-level; reset it so each
    // test sees a clean cache. The Stripe equivalent does the same dance.
    crmReputationIdempotency.clear();
    s = makeStubStorage();
    s.leads.set(7, { id: 7 });
    s.orders.set(100, makeOrder());
    s.connections.push(makeConnection());
    // Pre-record an outbound deal event so we have something to match.
    s.events.push({
      id: 1,
      connectionId: 1,
      direction: "out",
      resourceType: "deal",
      resourceId: "100",
      externalId: "deal_contact_7_5000",
      status: "success",
      errorMessage: null,
      createdAt: new Date(),
    } as CrmSyncEvent);
  });

  it("emits a +10 reputation event when an outbound deal flips to closed_won", async () => {
    const result = await handleInboundWebhook(
      "hubspot",
      { resourceType: "deal", externalId: "deal_contact_7_5000", status: "closed_won" },
      { storage: s.storage, logger: silentLogger },
    );
    expect(result).toEqual({ matched: true, repEmitted: true });
    expect(s.reputationEvents).toHaveLength(1);
    expect(s.reputationEvents[0]).toMatchObject({
      agentUserId: "agent-1",
      eventType: "crm_deal_closed",
      weight: 10,
      relatedLeadId: 7,
    });
  });

  it("matches but does not emit when the status is not closed_won", async () => {
    const result = await handleInboundWebhook(
      "hubspot",
      { resourceType: "deal", externalId: "deal_contact_7_5000", status: "open" },
      { storage: s.storage, logger: silentLogger },
    );
    expect(result.matched).toBe(true);
    expect(result.repEmitted).toBe(false);
    expect(s.reputationEvents).toHaveLength(0);
  });

  it("returns matched=false when the external id is unknown", async () => {
    const result = await handleInboundWebhook(
      "hubspot",
      { resourceType: "deal", externalId: "deal_unknown", status: "closed_won" },
      { storage: s.storage, logger: silentLogger },
    );
    expect(result.matched).toBe(false);
    expect(s.reputationEvents).toHaveLength(0);
  });

  it("returns matched=false for unparseable payloads", async () => {
    const result = await handleInboundWebhook("hubspot", "garbage", {
      storage: s.storage,
      logger: silentLogger,
    });
    expect(result).toMatchObject({ matched: false, repEmitted: false, reason: "unparseable" });
  });

  it("records the inbound event for audit even when status is not won", async () => {
    await handleInboundWebhook(
      "hubspot",
      { resourceType: "deal", externalId: "deal_contact_7_5000", status: "open" },
      { storage: s.storage, logger: silentLogger },
    );
    const inEvents = s.events.filter(e => e.direction === "in");
    expect(inEvents).toHaveLength(1);
    expect(inEvents[0].resourceType).toBe("deal");
  });

  it("dedups: a replayed closed_won webhook does not double-emit reputation", async () => {
    const payload = { resourceType: "deal", externalId: "deal_contact_7_5000", status: "closed_won" } as const;

    const first = await handleInboundWebhook("hubspot", payload, { storage: s.storage, logger: silentLogger });
    expect(first.repEmitted).toBe(true);
    expect(s.reputationEvents).toHaveLength(1);

    // Replay the exact same payload — Stripe-style retry or attacker replay.
    const second = await handleInboundWebhook("hubspot", payload, { storage: s.storage, logger: silentLogger });
    expect(second).toMatchObject({ matched: true, repEmitted: false, reason: "rep_already_emitted" });
    expect(s.reputationEvents).toHaveLength(1);
  });

  it("dedup key is per-(provider, externalId): same externalId from a different provider can still emit", async () => {
    // Pre-record an outbound deal event under a different provider for the SAME externalId,
    // so the second handler call has something to match too.
    s.events.push({
      id: 2,
      connectionId: 1,
      direction: "out",
      resourceType: "deal",
      resourceId: "100",
      externalId: "deal_contact_7_5000",
      status: "success",
      errorMessage: null,
      createdAt: new Date(),
    } as CrmSyncEvent);

    const payload = { resourceType: "deal", externalId: "deal_contact_7_5000", status: "closed_won" } as const;
    const a = await handleInboundWebhook("hubspot", payload, { storage: s.storage, logger: silentLogger });
    const b = await handleInboundWebhook("salesforce", payload, { storage: s.storage, logger: silentLogger });
    expect(a.repEmitted).toBe(true);
    expect(b.repEmitted).toBe(true);
    expect(s.reputationEvents).toHaveLength(2);
  });
});
