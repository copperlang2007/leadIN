// LCP-side client for the MedicareCallForge (MCF) compliance/telephony service
// (ADR-0002, Phase 3).
//
// Flag-gated: entirely inert unless BOTH `MCF_URL` and `MCF_SERVICE_SECRET`
// are configured, so this ships safely ahead of the MCF deploy. Every call is
// guarded — a down, slow, or misconfigured service returns a null/false result
// and never throws into the caller or blocks a request.

import { signServiceRequest } from "./lib/serviceAuth";
import { logError } from "./lib/safeError";

const REQUEST_TIMEOUT_MS = 5000;

function config(): { url?: string; secret?: string } {
  const url = process.env.MCF_URL?.trim();
  const secret = process.env.MCF_SERVICE_SECRET?.trim();
  return { url: url || undefined, secret: secret || undefined };
}

export function isComplianceServiceEnabled(): boolean {
  const { url, secret } = config();
  return !!url && !!secret;
}

export interface ComplianceServiceStatus {
  enabled: boolean;
  urlConfigured: boolean;
  secretConfigured: boolean;
}

/** Config status only — never returns the secret itself. */
export function getComplianceServiceStatus(): ComplianceServiceStatus {
  const { url, secret } = config();
  return { enabled: !!url && !!secret, urlConfigured: !!url, secretConfigured: !!secret };
}

interface ServiceResponse<T> {
  ok: boolean;
  status: number;
  body: T | null;
}

async function signedFetch<T = unknown>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<ServiceResponse<T> | null> {
  const { url, secret } = config();
  if (!url || !secret) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Serialize inside the guard so an un-serializable body (BigInt, cyclic
    // ref) fails open to null instead of throwing into the caller.
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...signServiceRequest(payload, secret),
    };
    // Strip ALL trailing slashes so a `MCF_URL=…//` misconfig doesn't produce
    // a `//path` that strict routers 404.
    const res = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : payload,
      signal: controller.signal,
    });
    // Read the body while the timeout is still armed — otherwise a stalled
    // chunked body would hang past REQUEST_TIMEOUT_MS.
    let parsed: T | null = null;
    if (res.ok) {
      try {
        parsed = (await res.json()) as T;
      } catch {
        parsed = null;
      }
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    logError("[compliance-service] request failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CertificateVerification {
  valid: boolean;
  reason?: string;
}

/**
 * Ask MCF to verify a compliance certificate. Returns null when the service is
 * disabled or unreachable (caller decides how to treat "unknown").
 */
export async function verifyCertificate(
  certificate: unknown,
): Promise<CertificateVerification | null> {
  const res = await signedFetch<CertificateVerification>("/compliance/verify", "POST", {
    certificate,
  });
  if (!res || !res.ok) return null;
  return res.body;
}

/** Best-effort health check against MCF. False when disabled or unreachable. */
export async function pingComplianceService(): Promise<boolean> {
  const res = await signedFetch("/health", "GET");
  return !!res && res.ok;
}
