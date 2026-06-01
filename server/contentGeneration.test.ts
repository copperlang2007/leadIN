import { describe, it, expect } from "vitest";
import { slugify } from "./contentGeneration";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("strips punctuation", () => {
    expect(slugify("Plan G vs. Plan N: 2025!")).toBe("plan-g-vs-plan-n-2025");
  });
  it("collapses repeated hyphens", () => {
    expect(slugify("a  b   c")).toBe("a-b-c");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });
});
