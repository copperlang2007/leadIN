// TCPA calling-hours guard — DST-aware, per-state, fail-safe.
//
// Federal TCPA prohibits telemarketing calls before 8:00 AM or after 9:00 PM in
// the CALLED PARTY's local time. A common (and expensive) bug — seen in sibling
// dialers in this portfolio — is checking the *server's* clock instead of the
// consumer's. This module computes the consumer's local time from their state's
// IANA timezone using Intl (which handles DST transitions automatically), and
// for states that span multiple timezones it only permits a call when it is
// inside the window in EVERY zone the state touches. That way you never ring
// someone at 7:59 AM in the western edge of a state.
//
// Unknown/unsupported states fail CLOSED (call blocked) — consistent with the
// platform's "fail closed on compliance" principle.

// State -> IANA timezone(s). Multi-zone states list every zone they touch so we
// can take the conservative intersection.
export const STATE_TIMEZONES: Record<string, string[]> = {
  AL: ["America/Chicago"],
  AK: ["America/Anchorage", "America/Adak"],
  AZ: ["America/Phoenix"], // no DST
  AR: ["America/Chicago"],
  CA: ["America/Los_Angeles"],
  CO: ["America/Denver"],
  CT: ["America/New_York"],
  DE: ["America/New_York"],
  DC: ["America/New_York"],
  FL: ["America/New_York", "America/Chicago"], // panhandle is Central
  GA: ["America/New_York"],
  HI: ["Pacific/Honolulu"], // no DST
  ID: ["America/Boise", "America/Los_Angeles"], // north Idaho is Pacific
  IL: ["America/Chicago"],
  IN: ["America/Indiana/Indianapolis", "America/Chicago"], // NW corner Central
  IA: ["America/Chicago"],
  KS: ["America/Chicago", "America/Denver"], // few western counties Mountain
  KY: ["America/New_York", "America/Chicago"],
  LA: ["America/Chicago"],
  ME: ["America/New_York"],
  MD: ["America/New_York"],
  MA: ["America/New_York"],
  MI: ["America/Detroit", "America/Menominee"], // UP is Central
  MN: ["America/Chicago"],
  MS: ["America/Chicago"],
  MO: ["America/Chicago"],
  MT: ["America/Denver"],
  NE: ["America/Chicago", "America/Denver"], // western NE Mountain
  NV: ["America/Los_Angeles", "America/Denver"], // West Wendover Mountain
  NH: ["America/New_York"],
  NJ: ["America/New_York"],
  NM: ["America/Denver"],
  NY: ["America/New_York"],
  NC: ["America/New_York"],
  ND: ["America/Chicago", "America/Denver"], // SW ND Mountain
  OH: ["America/New_York"],
  OK: ["America/Chicago"],
  OR: ["America/Los_Angeles", "America/Boise"], // Malheur county Mountain
  PA: ["America/New_York"],
  RI: ["America/New_York"],
  SC: ["America/New_York"],
  SD: ["America/Chicago", "America/Denver"], // western SD Mountain
  TN: ["America/Chicago", "America/New_York"], // eastern TN Eastern
  TX: ["America/Chicago", "America/Denver"], // El Paso area Mountain
  UT: ["America/Denver"],
  VT: ["America/New_York"],
  VA: ["America/New_York"],
  WA: ["America/Los_Angeles"],
  WV: ["America/New_York"],
  WI: ["America/Chicago"],
  WY: ["America/Denver"],
};

// Federal default window: [8:00, 21:00) local — i.e. 8 AM allowed, 9 PM blocked.
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 21;

export interface CallingHoursResult {
  allowed: boolean;
  state: string;
  zonesChecked: string[];
  localTimes: Array<{ tz: string; hour: number; minute: number; withinWindow: boolean }>;
  reason: string;
}

/** Local wall-clock hour/minute for an instant in a given IANA timezone. */
export function localTimeInZone(instant: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hourStr = parts.find(p => p.type === "hour")?.value ?? "0";
  const minStr = parts.find(p => p.type === "minute")?.value ?? "0";
  // Intl can emit "24" for midnight in some ICU builds; normalize to 0..23.
  const hour = parseInt(hourStr, 10) % 24;
  const minute = parseInt(minStr, 10);
  return { hour, minute };
}

/**
 * Is it permissible to call a consumer in `state` right now? Pure (given an
 * explicit instant). Conservative across multi-zone states; fail-closed for
 * unknown states.
 */
export function isWithinCallingHours(
  state: string,
  instant: Date = new Date(),
  opts: { startHour?: number; endHour?: number } = {},
): CallingHoursResult {
  const startHour = opts.startHour ?? DEFAULT_START_HOUR;
  const endHour = opts.endHour ?? DEFAULT_END_HOUR;
  const startMin = startHour * 60;
  const endMin = endHour * 60;

  const code = (state ?? "").trim().toUpperCase();
  const zones = STATE_TIMEZONES[code];

  if (!zones) {
    return {
      allowed: false,
      state: code,
      zonesChecked: [],
      localTimes: [],
      reason: "unknown_state_fail_closed",
    };
  }

  const localTimes = zones.map(tz => {
    const { hour, minute } = localTimeInZone(instant, tz);
    const mins = hour * 60 + minute;
    return { tz, hour, minute, withinWindow: mins >= startMin && mins < endMin };
  });

  // Allowed only if within the window in EVERY zone the state spans.
  const allowed = localTimes.every(t => t.withinWindow);
  const reason = allowed
    ? "within_calling_hours"
    : `outside_calling_hours (${localTimes.filter(t => !t.withinWindow).map(t => `${t.tz} ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`).join(", ")})`;

  return { allowed, state: code, zonesChecked: zones, localTimes, reason };
}
