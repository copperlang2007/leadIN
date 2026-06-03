import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirrors the zod schema used inline by PATCH /api/agent/me. Kept in sync
// here so we can exercise the validation rules without spinning up the
// full Express harness.
const agentCapacitySchema = z
  .object({
    capacityLimit: z.number().int().min(1).max(500).optional(),
    acceptingLeads: z.boolean().optional(),
  })
  .refine(
    (v) => v.capacityLimit !== undefined || v.acceptingLeads !== undefined,
    { message: "Provide capacityLimit and/or acceptingLeads" },
  );

describe("PATCH /api/agent/me validation", () => {
  it("accepts a valid capacity update", () => {
    const result = agentCapacitySchema.safeParse({ capacityLimit: 50 });
    expect(result.success).toBe(true);
  });

  it("accepts a valid acceptingLeads toggle", () => {
    const result = agentCapacitySchema.safeParse({ acceptingLeads: false });
    expect(result.success).toBe(true);
  });

  it("accepts both fields together", () => {
    const result = agentCapacitySchema.safeParse({
      capacityLimit: 25,
      acceptingLeads: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = agentCapacitySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects capacity below 1", () => {
    const result = agentCapacitySchema.safeParse({ capacityLimit: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects capacity above 500", () => {
    const result = agentCapacitySchema.safeParse({ capacityLimit: 501 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer capacity", () => {
    const result = agentCapacitySchema.safeParse({ capacityLimit: 12.5 });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean acceptingLeads", () => {
    const result = agentCapacitySchema.safeParse({ acceptingLeads: "yes" });
    expect(result.success).toBe(false);
  });
});
