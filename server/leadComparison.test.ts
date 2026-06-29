import { describe, it, expect } from "vitest";
import { addToComparison, removeFromComparison, MAX_COMPARE } from "./leadComparison";

describe("addToComparison", () => {
  it("adds a lead to an empty list", () => {
    const result = addToComparison([], 1);
    expect(result).toEqual({ ok: true, list: [1] });
  });

  it("appends a new lead to an existing list", () => {
    const result = addToComparison([1, 2], 3);
    expect(result).toEqual({ ok: true, list: [1, 2, 3] });
  });

  it("rejects a duplicate with 409 and returns the unchanged list", () => {
    const result = addToComparison([1, 2], 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.list).toEqual([1, 2]);
    }
  });

  it("rejects with 400 once the list is full", () => {
    const full = Array.from({ length: MAX_COMPARE }, (_, i) => i + 1);
    const result = addToComparison(full, 99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.list).toEqual(full);
    }
  });

  it("does not mutate the input array", () => {
    const input = [1, 2];
    addToComparison(input, 3);
    expect(input).toEqual([1, 2]);
  });
});

describe("removeFromComparison", () => {
  it("removes the given lead", () => {
    expect(removeFromComparison([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("is a no-op when the lead is absent", () => {
    expect(removeFromComparison([1, 2], 9)).toEqual([1, 2]);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];
    removeFromComparison(input, 2);
    expect(input).toEqual([1, 2, 3]);
  });
});
