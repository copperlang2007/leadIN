import { describe, it, expect } from "vitest";
import { isWithinCallingHours, localTimeInZone, STATE_TIMEZONES } from "./callingHours";

describe("localTimeInZone (DST handled by Intl)", () => {
  it("converts a UTC instant to Eastern summer time (EDT, UTC-4)", () => {
    const t = localTimeInZone(new Date("2026-06-27T14:00:00Z"), "America/New_York");
    expect(t.hour).toBe(10);
    expect(t.minute).toBe(0);
  });
  it("converts a UTC instant to Eastern winter time (EST, UTC-5)", () => {
    const t = localTimeInZone(new Date("2026-01-15T14:00:00Z"), "America/New_York");
    expect(t.hour).toBe(9);
  });
  it("handles Hawaii (no DST, UTC-10)", () => {
    const t = localTimeInZone(new Date("2026-06-27T18:30:00Z"), "Pacific/Honolulu");
    expect(t.hour).toBe(8);
    expect(t.minute).toBe(30);
  });
});

describe("isWithinCallingHours — single-zone states", () => {
  it("allows a mid-morning call in NY", () => {
    const r = isWithinCallingHours("NY", new Date("2026-06-27T14:00:00Z")); // 10:00 EDT
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("within_calling_hours");
  });

  it("blocks a pre-8am call in NY", () => {
    const r = isWithinCallingHours("NY", new Date("2026-06-27T11:30:00Z")); // 07:30 EDT
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/outside_calling_hours/);
  });

  it("blocks a 9pm-or-later call in CA", () => {
    const r = isWithinCallingHours("CA", new Date("2026-06-28T04:00:00Z")); // 21:00 PDT exactly -> blocked
    expect(r.allowed).toBe(false);
  });

  it("allows 8:00am exactly (window is inclusive of start)", () => {
    const r = isWithinCallingHours("CA", new Date("2026-06-27T15:00:00Z")); // 08:00 PDT
    expect(r.allowed).toBe(true);
  });
});

describe("isWithinCallingHours — multi-zone states use the conservative intersection", () => {
  it("blocks Florida when the Central panhandle is before 8am even though Eastern is OK", () => {
    // 12:30Z -> 08:30 EDT (NY ok) but 07:30 CDT (Chicago not ok) => blocked
    const r = isWithinCallingHours("FL", new Date("2026-06-27T12:30:00Z"));
    expect(r.allowed).toBe(false);
    expect(r.zonesChecked).toEqual(STATE_TIMEZONES.FL);
  });

  it("allows Florida once both zones are inside the window", () => {
    // 14:00Z -> 10:00 EDT and 09:00 CDT => both ok
    const r = isWithinCallingHours("FL", new Date("2026-06-27T14:00:00Z"));
    expect(r.allowed).toBe(true);
  });

  it("blocks Texas in the evening when El Paso (Mountain) is still inside but Central is past 9pm", () => {
    // 03:30Z next day -> 22:30 CDT (blocked) ; Mountain 21:30 (blocked too) => blocked
    const r = isWithinCallingHours("TX", new Date("2026-06-28T03:30:00Z"));
    expect(r.allowed).toBe(false);
  });
});

describe("isWithinCallingHours — fail-closed", () => {
  it("blocks unknown/empty states", () => {
    expect(isWithinCallingHours("XX", new Date("2026-06-27T18:00:00Z")).allowed).toBe(false);
    expect(isWithinCallingHours("", new Date("2026-06-27T18:00:00Z")).reason).toBe("unknown_state_fail_closed");
  });

  it("is case-insensitive and trims", () => {
    const r = isWithinCallingHours(" ny ", new Date("2026-06-27T14:00:00Z"));
    expect(r.allowed).toBe(true);
  });

  it("covers all 50 states + DC", () => {
    expect(Object.keys(STATE_TIMEZONES).length).toBe(51);
  });
});
