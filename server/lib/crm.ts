// Wave 6 (K4) — CRM adapter interface + stub implementations for the
// four providers we support. Real OAuth + REST integrations come in a
// later wave (K4 will fill them in); for now, every adapter is a stub
// that records the call and returns a deterministic id so feature code
// can be wired end-to-end without external services.

import crypto from "node:crypto";

export type CrmProvider = "hubspot" | "salesforce" | "ghl" | "pipedrive";

export interface CrmLeadInput {
  id: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  zipCode?: string | null;
  notes?: string | null;
}

export interface CrmAdapterResult {
  externalId: string;
  raw?: unknown;
}

export interface CrmAdapter {
  provider: CrmProvider;
  upsertContact(token: string, lead: CrmLeadInput): Promise<CrmAdapterResult>;
  createDeal(token: string, contactId: string, amountCents: number): Promise<CrmAdapterResult>;
  addNote(token: string, contactId: string, body: string): Promise<CrmAdapterResult>;
  createTask(token: string, contactId: string, title: string, dueAt?: Date): Promise<CrmAdapterResult>;
}

// In-memory record of stub calls — used by tests to assert that the right
// adapter method was invoked. Cleared between tests via `__resetStubCalls`.
const stubCalls: Array<{ provider: CrmProvider; method: string; args: unknown }> = [];

export function __getStubCalls(): ReadonlyArray<{ provider: CrmProvider; method: string; args: unknown }> {
  return stubCalls;
}

export function __resetStubCalls(): void {
  stubCalls.length = 0;
}

function deterministicId(provider: CrmProvider, parts: unknown[]): string {
  const h = crypto.createHash("sha1");
  h.update(provider);
  for (const p of parts) h.update("|" + JSON.stringify(p));
  return provider + "_" + h.digest("hex").slice(0, 16);
}

function makeStubAdapter(provider: CrmProvider): CrmAdapter {
  return {
    provider,
    async upsertContact(_token, lead) {
      stubCalls.push({ provider, method: "upsertContact", args: lead });
      return { externalId: deterministicId(provider, ["contact", lead.id, lead.email, lead.phone]) };
    },
    async createDeal(_token, contactId, amountCents) {
      stubCalls.push({ provider, method: "createDeal", args: { contactId, amountCents } });
      return { externalId: deterministicId(provider, ["deal", contactId, amountCents]) };
    },
    async addNote(_token, contactId, body) {
      stubCalls.push({ provider, method: "addNote", args: { contactId, body } });
      return { externalId: deterministicId(provider, ["note", contactId, body]) };
    },
    async createTask(_token, contactId, title, dueAt) {
      stubCalls.push({ provider, method: "createTask", args: { contactId, title, dueAt } });
      return { externalId: deterministicId(provider, ["task", contactId, title]) };
    },
  };
}

const ADAPTERS: Record<CrmProvider, CrmAdapter> = {
  hubspot: makeStubAdapter("hubspot"),
  salesforce: makeStubAdapter("salesforce"),
  ghl: makeStubAdapter("ghl"),
  pipedrive: makeStubAdapter("pipedrive"),
};

export function getAdapter(provider: string): CrmAdapter | null {
  if (provider in ADAPTERS) return ADAPTERS[provider as CrmProvider];
  return null;
}

export function listProviders(): CrmProvider[] {
  return Object.keys(ADAPTERS) as CrmProvider[];
}
