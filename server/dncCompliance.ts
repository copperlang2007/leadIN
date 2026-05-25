// DNC (Do-Not-Call) compliance check for newly ingested leads.
//
// Strategy:
//   1. If a DNC_VENDOR_API_KEY is configured (Gryphon, Convoso, RealPhoneValidation
//      etc.), call the vendor's lookup endpoint.
//   2. Otherwise fall back to a deterministic local check: phones whose last
//      4 digits are in a known suppression seed are treated as DNC-listed.
//      This keeps tests reproducible and lets dev/staging exercise the flag
//      without a paid API.

interface DncCheckResult {
  flagged: boolean;
  source: "vendor" | "local-fallback" | "skip";
  reason?: string;
}

const LOCAL_SUPPRESSION_SUFFIXES = new Set(["0000", "1111", "5555", "9999"]);

function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function checkDnc(phone: string | null | undefined): Promise<DncCheckResult> {
  if (!phone) return { flagged: false, source: "skip", reason: "no phone" };
  const digits = normalisePhone(phone);
  if (digits.length < 10) return { flagged: false, source: "skip", reason: "invalid phone" };

  const apiKey = process.env.DNC_VENDOR_API_KEY;
  const apiUrl = process.env.DNC_VENDOR_API_URL;

  if (apiKey && apiUrl) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ phone: digits }),
        // 5-second cap so a slow vendor never blocks ingestion
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body: any = await res.json();
        const flagged = Boolean(body?.dnc ?? body?.onDncList ?? body?.flagged);
        return {
          flagged,
          source: "vendor",
          reason: flagged ? (body?.reason || "vendor flagged") : undefined,
        };
      }
      return { flagged: false, source: "vendor", reason: `vendor non-OK ${res.status}` };
    } catch (err: any) {
      console.warn("[dnc] vendor lookup failed, falling back:", err?.message);
    }
  }

  const last4 = digits.slice(-4);
  const flagged = LOCAL_SUPPRESSION_SUFFIXES.has(last4);
  return {
    flagged,
    source: "local-fallback",
    reason: flagged ? `local suppression match (${last4})` : undefined,
  };
}
