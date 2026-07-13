import { describe, it, expect } from "vitest";
import { leadMatchesCriteria, type MatchableLead } from "./savedSearch";
import type { SavedSearchCriteria } from "@shared/schema";

const baseLead: MatchableLead = {
  type: "Medicare Advantage",
  state: "CA",
  price: "25.00",
  mediscore: 70,
  verified: true,
};

describe("leadMatchesCriteria", () => {
  describe("empty / omitted criteria", () => {
    it("matches when criteria is null", () => {
      expect(leadMatchesCriteria(baseLead, null)).toBe(true);
    });

    it("matches when criteria is undefined", () => {
      expect(leadMatchesCriteria(baseLead, undefined)).toBe(true);
    });

    it("matches when criteria is an empty object", () => {
      expect(leadMatchesCriteria(baseLead, {})).toBe(true);
    });

    it("does not constrain on empty arrays", () => {
      expect(leadMatchesCriteria(baseLead, { types: [], states: [] })).toBe(true);
    });
  });

  describe("type", () => {
    it("matches when lead type is in the list", () => {
      expect(
        leadMatchesCriteria(baseLead, { types: ["Medicare Advantage", "ACA"] }),
      ).toBe(true);
    });

    it("rejects when lead type is not in the list", () => {
      expect(leadMatchesCriteria(baseLead, { types: ["ACA"] })).toBe(false);
    });

    it("is case-sensitive / exact match", () => {
      expect(leadMatchesCriteria(baseLead, { types: ["medicare advantage"] })).toBe(false);
    });
  });

  describe("state", () => {
    it("matches when lead state is in the list", () => {
      expect(leadMatchesCriteria(baseLead, { states: ["CA", "TX"] })).toBe(true);
    });

    it("rejects when lead state is not in the list", () => {
      expect(leadMatchesCriteria(baseLead, { states: ["TX"] })).toBe(false);
    });
  });

  describe("price band", () => {
    it("matches at the lower boundary (inclusive)", () => {
      expect(leadMatchesCriteria(baseLead, { minPrice: 25 })).toBe(true);
    });

    it("matches at the upper boundary (inclusive)", () => {
      expect(leadMatchesCriteria(baseLead, { maxPrice: 25 })).toBe(true);
    });

    it("rejects below minPrice", () => {
      expect(leadMatchesCriteria(baseLead, { minPrice: 25.01 })).toBe(false);
    });

    it("rejects above maxPrice", () => {
      expect(leadMatchesCriteria(baseLead, { maxPrice: 24.99 })).toBe(false);
    });

    it("matches within a band", () => {
      expect(leadMatchesCriteria(baseLead, { minPrice: 10, maxPrice: 50 })).toBe(true);
    });

    it("rejects outside a band", () => {
      expect(leadMatchesCriteria({ ...baseLead, price: "100.00" }, { minPrice: 10, maxPrice: 50 })).toBe(false);
    });

    it("parses numeric price values too", () => {
      expect(leadMatchesCriteria({ ...baseLead, price: 30 }, { minPrice: 20, maxPrice: 40 })).toBe(true);
    });

    it("rejects a non-numeric price when a price bound is present", () => {
      expect(leadMatchesCriteria({ ...baseLead, price: "abc" }, { minPrice: 10 })).toBe(false);
      expect(leadMatchesCriteria({ ...baseLead, price: "abc" }, { maxPrice: 10 })).toBe(false);
    });

    it("ignores a non-numeric price when no price bound is present", () => {
      expect(leadMatchesCriteria({ ...baseLead, price: "abc" }, { types: ["Medicare Advantage"] })).toBe(true);
    });
  });

  describe("minMediscore", () => {
    it("matches at the boundary (inclusive)", () => {
      expect(leadMatchesCriteria(baseLead, { minMediscore: 70 })).toBe(true);
    });

    it("rejects below the floor", () => {
      expect(leadMatchesCriteria(baseLead, { minMediscore: 71 })).toBe(false);
    });

    it("treats missing mediscore as 0", () => {
      expect(leadMatchesCriteria({ ...baseLead, mediscore: undefined }, { minMediscore: 1 })).toBe(false);
      expect(leadMatchesCriteria({ ...baseLead, mediscore: null }, { minMediscore: 0 })).toBe(true);
    });
  });

  describe("verifiedOnly", () => {
    it("matches a verified lead", () => {
      expect(leadMatchesCriteria(baseLead, { verifiedOnly: true })).toBe(true);
    });

    it("rejects an unverified lead", () => {
      expect(leadMatchesCriteria({ ...baseLead, verified: false }, { verifiedOnly: true })).toBe(false);
    });

    it("rejects a lead with null verified", () => {
      expect(leadMatchesCriteria({ ...baseLead, verified: null }, { verifiedOnly: true })).toBe(false);
    });

    it("does not constrain when verifiedOnly is false", () => {
      expect(leadMatchesCriteria({ ...baseLead, verified: false }, { verifiedOnly: false })).toBe(true);
    });
  });

  describe("combined criteria", () => {
    const criteria: SavedSearchCriteria = {
      types: ["Medicare Advantage"],
      states: ["CA", "NV"],
      minPrice: 10,
      maxPrice: 50,
      minMediscore: 60,
      verifiedOnly: true,
    };

    it("matches when every constraint is satisfied", () => {
      expect(leadMatchesCriteria(baseLead, criteria)).toBe(true);
    });

    it("fails if any single constraint is violated (state)", () => {
      expect(leadMatchesCriteria({ ...baseLead, state: "TX" }, criteria)).toBe(false);
    });

    it("fails if any single constraint is violated (mediscore)", () => {
      expect(leadMatchesCriteria({ ...baseLead, mediscore: 59 }, criteria)).toBe(false);
    });

    it("fails if any single constraint is violated (verified)", () => {
      expect(leadMatchesCriteria({ ...baseLead, verified: false }, criteria)).toBe(false);
    });

    it("fails if any single constraint is violated (price)", () => {
      expect(leadMatchesCriteria({ ...baseLead, price: "51.00" }, criteria)).toBe(false);
    });
  });
});
