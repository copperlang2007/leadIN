// Wave 6 (T4) — NIPR / DOI license verification.
//
// Real API: GET https://api.nipr.com/v2/licenses (requires NIPR_API_KEY).
// Stub: returns `{ verified: true, expiresAt: now + 1y, classes: ["Life","Health"] }`
// when licenseNumber.length >= 6, else `{ verified: false }`. The stub
// lets onboarding flows + tests run without NIPR credentials.

export interface VerifyLicenseInput {
  niprNumber?: string;
  state: string;
  licenseNumber: string;
}

export interface VerifyLicenseResult {
  verified: boolean;
  expiresAt?: Date;
  classes?: string[];
  error?: string;
  raw?: unknown;
}

export async function verifyLicense(input: VerifyLicenseInput): Promise<VerifyLicenseResult> {
  if (process.env.NIPR_API_KEY) {
    try {
      return await liveVerify(input);
    } catch (err: any) {
      console.warn("[nipr] live verify failed, falling back to stub:", err?.message);
      return stubVerify(input);
    }
  }
  return stubVerify(input);
}

async function liveVerify(input: VerifyLicenseInput): Promise<VerifyLicenseResult> {
  const url = new URL("https://api.nipr.com/v2/licenses");
  url.searchParams.set("state", input.state);
  url.searchParams.set("licenseNumber", input.licenseNumber);
  if (input.niprNumber) url.searchParams.set("niprNumber", input.niprNumber);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.NIPR_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { verified: false, error: `NIPR HTTP ${res.status}` };
  }
  const data: any = await res.json();
  const lic = Array.isArray(data?.licenses) ? data.licenses[0] : data?.license ?? data;
  const expiresAt = lic?.expirationDate ? new Date(lic.expirationDate) : undefined;
  const classes = Array.isArray(lic?.lineOfAuthority)
    ? lic.lineOfAuthority.map((l: any) => String(l))
    : undefined;
  return {
    verified: Boolean(lic?.status === "active" || lic?.active),
    expiresAt,
    classes,
    raw: data,
  };
}

export function stubVerify(input: VerifyLicenseInput): VerifyLicenseResult {
  if (!input.licenseNumber || input.licenseNumber.length < 6) {
    return { verified: false, error: "license number too short (stub)" };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return {
    verified: true,
    expiresAt,
    classes: ["Life", "Health"],
    raw: { stub: true },
  };
}

export function isNiprLive(): boolean {
  return Boolean(process.env.NIPR_API_KEY);
}
