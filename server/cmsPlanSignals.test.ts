import { describe, it, expect } from "vitest";
import { parseCsvText } from "./cmsPlanSignals";

describe("parseCsvText", () => {
  it("parses a simple CSV", () => {
    const out = parseCsvText("a,b,c\n1,2,3\n");
    expect(out).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted fields with commas", () => {
    const out = parseCsvText('id,name\nH1234,"Humana, Inc."\n');
    expect(out).toEqual([["id", "name"], ["H1234", "Humana, Inc."]]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const out = parseCsvText('a,b\n1,"He said ""hi"""\n');
    expect(out[1]).toEqual(["1", 'He said "hi"']);
  });

  it("handles embedded newlines inside quoted fields", () => {
    const out = parseCsvText('a,b\n1,"line1\nline2"\n');
    expect(out).toEqual([["a", "b"], ["1", "line1\nline2"]]);
  });

  it("ignores empty rows", () => {
    const out = parseCsvText("a,b\n\n1,2\n\n");
    expect(out.length).toBe(2);
  });

  it("strips \\r in CRLF files", () => {
    const out = parseCsvText("a,b\r\n1,2\r\n");
    expect(out).toEqual([["a", "b"], ["1", "2"]]);
  });
});
