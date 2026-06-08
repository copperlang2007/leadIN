// Tests for the NIPR/DOI auto-verification sync layer.
//
// `./storage` and `./emailNotifications` are mocked at the module level so
// these tests don't touch Postgres or call out to SendGrid/Resend. The NIPR
// backend is the real stub from ./lib/nipr (NIPR_API_KEY unset).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ──────────────────────────────────────────────────────
// Mocks — must be declared before the SUT import
// ──────────────────────────────────────────────────────
interface FakeProfile {
  userId: string;
  orgId: string;
  licensedStates: string[];
  licenseNumber: string | null;
  niprVerifiedAt: Date | null;
  niprLicenseExpiry: Date | null;
  niprLastError: string | null;
}

interface FakeUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface FakeStorageState {
  profiles: Map<string, FakeProfile>;
  users: Map<string, FakeUser>;
  expiringResult: (FakeProfile & { user: FakeUser })[];
}

const state: FakeStorageState = {
  profiles: new Map(),
  users: new Map(),
  expiringResult: [],
};

vi.mock("./storage", () => ({
  storage: {
    getAgentProfile: vi.fn(async (userId: string) => state.profiles.get(userId)),
    updateAgentNipr: vi.fn(async (
      userId: string,
      fields: { verifiedAt?: Date | null; expiry?: Date | null; error?: string | null },
    ) => {
      const p = state.profiles.get(userId);
      if (!p) throw new Error("Agent profile not found");
      if (fields.verifiedAt !== undefined) p.niprVerifiedAt = fields.verifiedAt;
      if (fields.expiry !== undefined) p.niprLicenseExpiry = fields.expiry;
      if (fields.error !== undefined) p.niprLastError = fields.error;
      return p as any;
    }),
    findAgentsExpiringWithin: vi.fn(async (_days: number) => state.expiringResult),
  },
}));

// vi.mock factories are hoisted; declare the spies inside the factory and
// re-export them so tests can grab a reference via dynamic import.
vi.mock("./emailNotifications", () => ({
  sendEmail: vi.fn(async (_to: string, _subject: string, _html: string) => true),
}));

vi.mock("./lib/cronRegistry", () => ({
  registerCron: vi.fn(),
}));

// Import SUT after mocks are in place.
import {
  verifyAgentLicense,
  runRenewalAlerts,
  startNiprRenewalCron,
} from "./niprSync";
import { sendEmail } from "./emailNotifications";
import { registerCron } from "./lib/cronRegistry";

const sendEmailMock = sendEmail as unknown as ReturnType<typeof vi.fn>;
const registerCronMock = registerCron as unknown as ReturnType<typeof vi.fn>;

function seedProfile(overrides: Partial<FakeProfile> = {}): FakeProfile {
  const p: FakeProfile = {
    userId: "u1",
    orgId: "org1",
    licensedStates: ["FL"],
    licenseNumber: "ABC12345",
    niprVerifiedAt: null,
    niprLicenseExpiry: null,
    niprLastError: null,
    ...overrides,
  };
  state.profiles.set(p.userId, p);
  return p;
}

function seedUser(overrides: Partial<FakeUser> = {}): FakeUser {
  const u: FakeUser = {
    id: "u1",
    email: "agent@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  };
  state.users.set(u.id, u);
  return u;
}

describe("verifyAgentLicense", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.NIPR_API_KEY;
    delete process.env.NIPR_API_KEY; // force stub
    state.profiles.clear();
    state.users.clear();
    state.expiringResult = [];
    sendEmailMock.mockClear();
    registerCronMock.mockClear();
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.NIPR_API_KEY = savedKey;
  });

  it("stamps niprVerifiedAt + expiry on a successful stub verify", async () => {
    seedProfile({ licenseNumber: "VALID12345" });

    const res = await verifyAgentLicense("u1");

    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.expiresAt).toBeInstanceOf(Date);
    const p = state.profiles.get("u1")!;
    expect(p.niprVerifiedAt).toBeInstanceOf(Date);
    expect(p.niprLicenseExpiry).toBeInstanceOf(Date);
    expect(p.niprLastError).toBeNull();
  });

  it("records an error and clears verified state when stub rejects (license too short)", async () => {
    seedProfile({ licenseNumber: "abc" }); // <6 chars → stub returns verified=false

    const res = await verifyAgentLicense("u1");

    expect(res.ok).toBe(false);
    expect(res.verified).toBe(false);
    expect(res.error).toBeTruthy();
    const p = state.profiles.get("u1")!;
    expect(p.niprVerifiedAt).toBeNull();
    expect(p.niprLicenseExpiry).toBeNull();
    expect(p.niprLastError).toBeTruthy();
  });

  it("skips when there is no agent profile", async () => {
    const res = await verifyAgentLicense("missing");
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it("skips when the profile has no license number or no licensed state", async () => {
    seedProfile({ licenseNumber: null });
    let res = await verifyAgentLicense("u1");
    expect(res.skipped).toBe(true);
    expect(res.error).toMatch(/license number/);

    seedProfile({ userId: "u1", licenseNumber: "ABC12345", licensedStates: [] });
    res = await verifyAgentLicense("u1");
    expect(res.skipped).toBe(true);
    expect(res.error).toMatch(/state/);
  });
});

describe("runRenewalAlerts", () => {
  beforeEach(() => {
    state.profiles.clear();
    state.users.clear();
    state.expiringResult = [];
    sendEmailMock.mockClear();
  });

  it("sends one email per expiring agent with a valid email", async () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const p1 = seedProfile({ userId: "u1", niprLicenseExpiry: inThreeDays });
    const u1 = seedUser({ id: "u1", email: "a@x.com" });
    const p2 = seedProfile({ userId: "u2", niprLicenseExpiry: inThreeDays });
    const u2 = seedUser({ id: "u2", email: "b@x.com" });
    state.expiringResult = [
      { ...p1, user: u1 } as any,
      { ...p2, user: u2 } as any,
    ];

    const summary = await runRenewalAlerts();

    expect(summary.scanned).toBe(2);
    expect(summary.alerted).toBe(2);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const subject = (sendEmailMock.mock.calls[0] as any[])[1] as string;
    expect(subject).toMatch(/expires in/);
  });

  it("skips agents with no email", async () => {
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const p1 = seedProfile({ userId: "u1", niprLicenseExpiry: inFiveDays });
    const u1 = seedUser({ id: "u1", email: null });
    state.expiringResult = [{ ...p1, user: u1 } as any];

    const summary = await runRenewalAlerts();

    expect(summary.scanned).toBe(1);
    expect(summary.alerted).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns a zero summary when nothing is expiring", async () => {
    state.expiringResult = [];
    const summary = await runRenewalAlerts();
    expect(summary).toEqual({ scanned: 0, alerted: 0, errors: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("counts send failures into the errors tally without throwing", async () => {
    const inOneDay = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const p1 = seedProfile({ userId: "u1", niprLicenseExpiry: inOneDay });
    const u1 = seedUser({ id: "u1", email: "a@x.com" });
    state.expiringResult = [{ ...p1, user: u1 } as any];
    sendEmailMock.mockRejectedValueOnce(new Error("smtp down"));

    const summary = await runRenewalAlerts();

    expect(summary.scanned).toBe(1);
    expect(summary.alerted).toBe(0);
    expect(summary.errors).toBe(1);
  });
});

describe("startNiprRenewalCron", () => {
  beforeEach(() => {
    registerCronMock.mockClear();
  });

  it("registers a daily 09:00 UTC cron job", () => {
    startNiprRenewalCron();
    expect(registerCronMock).toHaveBeenCalledTimes(1);
    const job = registerCronMock.mock.calls[0][0] as { name: string; schedule: string };
    expect(job.name).toBe("nipr-renewal-alerts");
    expect(job.schedule).toBe("0 9 * * *");
  });
});
