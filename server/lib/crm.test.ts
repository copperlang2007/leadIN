import { describe, it, expect, beforeEach } from "vitest";
import { getAdapter, listProviders, __getStubCalls, __resetStubCalls } from "./crm.js";

describe("crm stub adapters", () => {
  beforeEach(() => {
    __resetStubCalls();
  });

  it("lists all four providers", () => {
    const providers = listProviders().sort();
    expect(providers).toEqual(["ghl", "hubspot", "pipedrive", "salesforce"]);
  });

  it("returns null for an unknown provider", () => {
    expect(getAdapter("zoho")).toBeNull();
  });

  it("upsertContact records the call and returns deterministic id", async () => {
    const adapter = getAdapter("hubspot")!;
    const r1 = await adapter.upsertContact("tok", { id: 42, email: "a@b.com", phone: "+15551112222" });
    const r2 = await adapter.upsertContact("tok", { id: 42, email: "a@b.com", phone: "+15551112222" });
    expect(r1.externalId).toBe(r2.externalId);
    expect(r1.externalId.startsWith("hubspot_")).toBe(true);
    expect(__getStubCalls().length).toBe(2);
  });

  it("createDeal/addNote/createTask round-trip", async () => {
    const adapter = getAdapter("salesforce")!;
    const deal = await adapter.createDeal("tok", "c1", 5000);
    const note = await adapter.addNote("tok", "c1", "hello");
    const task = await adapter.createTask("tok", "c1", "follow up");
    expect(deal.externalId.startsWith("salesforce_")).toBe(true);
    expect(note.externalId.startsWith("salesforce_")).toBe(true);
    expect(task.externalId.startsWith("salesforce_")).toBe(true);
  });
});
