import { describe, it, expect } from "vitest";
import { buildBuyerRoiReport, scoreBand, type RoiRecord } from "./buyerRoi";

const records: RoiRecord[] = [
  { cost: 40, mediscore: 90, vendorId: 1, vendorName: "Alpha", converted: true },
  { cost: 40, mediscore: 85, vendorId: 1, vendorName: "Alpha", converted: false },
  { cost: 20, mediscore: 30, vendorId: 2, vendorName: "Beta", converted: false },
  { cost: 20, mediscore: 35, vendorId: 2, vendorName: "Beta", converted: false },
];

describe("scoreBand", () => {
  it("buckets scores", () => {
    expect(scoreBand(0)).toBe("0-19");
    expect(scoreBand(19)).toBe("0-19");
    expect(scoreBand(20)).toBe("20-39");
    expect(scoreBand(59)).toBe("40-59");
    expect(scoreBand(80)).toBe("80-100");
    expect(scoreBand(100)).toBe("80-100");
    expect(scoreBand(150)).toBe("80-100"); // clamps
  });
});

describe("buildBuyerRoiReport — overall", () => {
  it("computes spend, CAC, conversion rate", () => {
    const r = buildBuyerRoiReport(records, { avgCommission: 500 });
    expect(r.overall.leads).toBe(4);
    expect(r.overall.spend).toBe("120.00");
    expect(r.overall.cac).toBe("30.00"); // 120 / 4
    expect(r.overall.conversions).toBe(1);
    expect(r.overall.conversionRate).toBe(0.25);
    expect(r.overall.costPerConversion).toBe("120.00"); // 120 / 1
  });

  it("derives revenue from avgCommission and computes ROI", () => {
    const r = buildBuyerRoiReport(records, { avgCommission: 500 });
    // 1 conversion * $500 = $500 revenue; spend $120 => ROI (500-120)/120 = 3.1667
    expect(r.overall.revenue).toBe("500.00");
    expect(r.overall.roi).toBeCloseTo(3.1667, 3);
  });

  it("prefers explicit per-record revenue when present", () => {
    const recs: RoiRecord[] = [
      { cost: 40, mediscore: 90, vendorId: 1, vendorName: "Alpha", converted: true, revenue: 1000 },
    ];
    const r = buildBuyerRoiReport(recs, { avgCommission: 500 });
    expect(r.overall.revenue).toBe("1000.00");
  });

  it("handles empty input without dividing by zero", () => {
    const r = buildBuyerRoiReport([], { avgCommission: 500 });
    expect(r.overall.leads).toBe(0);
    expect(r.overall.cac).toBe("0.00");
    expect(r.overall.roi).toBe(0);
    expect(r.overall.costPerConversion).toBe("0.00");
  });
});

describe("buildBuyerRoiReport — by vendor", () => {
  it("breaks down per vendor sorted by spend desc", () => {
    const r = buildBuyerRoiReport(records, { avgCommission: 500 });
    expect(r.byVendor).toHaveLength(2);
    expect(r.byVendor[0].vendorName).toBe("Alpha"); // 80 spend
    expect(r.byVendor[0].spend).toBe("80.00");
    expect(r.byVendor[0].conversions).toBe(1);
    expect(r.byVendor[1].vendorName).toBe("Beta"); // 40 spend
    expect(r.byVendor[1].conversions).toBe(0);
    expect(r.byVendor[1].roi).toBe(-1); // spent 40, earned 0 => (0-40)/40
  });
});

describe("buildBuyerRoiReport — by score band", () => {
  it("emits all five bands and attributes leads correctly", () => {
    const r = buildBuyerRoiReport(records, { avgCommission: 500 });
    expect(r.byScoreBand.map(b => b.band)).toEqual(["0-19", "20-39", "40-59", "60-79", "80-100"]);
    const top = r.byScoreBand.find(b => b.band === "80-100")!;
    expect(top.leads).toBe(2); // scores 90, 85
    expect(top.conversions).toBe(1);
    const low = r.byScoreBand.find(b => b.band === "20-39")!;
    expect(low.leads).toBe(2); // scores 30, 35
    expect(low.conversions).toBe(0);
    expect(low.roi).toBe(-1); // money in, nothing back — the insight buyers need
  });
});
