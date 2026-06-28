import { describe, it, expect } from "vitest";
import { verifyOidc } from "./verify-oidc";
import { verifyStripe } from "./verify-stripe";
import { verifyTwilio } from "./verify-twilio";
import { verifyNipr } from "./verify-nipr";
import { verifyEmail } from "./verify-email";
import { verifyTrustedForm } from "./verify-trustedform";
import { formatResult } from "./_shared";

// Offline tests: prove that each probe skips cleanly when its required
// env var is unset (the dev / CI default). Network-dependent paths are
// not exercised here — they need real credentials and live services.

function withClearedEnv<T extends (...args: any[]) => any>(
  vars: string[],
  fn: T,
): ReturnType<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of vars) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of vars) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  }
}

describe("verify probes — offline skip paths", () => {
  it("verifyOidc skips when ISSUER_URL is unset", async () => {
    const r = await withClearedEnv(["ISSUER_URL"], () => verifyOidc());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("oidc");
  });

  it("verifyStripe skips when STRIPE_SECRET_KEY is unset", async () => {
    const r = await withClearedEnv(["STRIPE_SECRET_KEY"], () => verifyStripe());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("stripe");
  });

  it("verifyTwilio skips when TWILIO_ACCOUNT_SID is unset", async () => {
    const r = await withClearedEnv(["TWILIO_ACCOUNT_SID"], () => verifyTwilio());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("twilio");
  });

  it("verifyTwilio fails (not skips) when SID is set but TOKEN is missing", async () => {
    const r = await withClearedEnv(["TWILIO_AUTH_TOKEN"], async () => {
      process.env.TWILIO_ACCOUNT_SID = "AC_test";
      try {
        return await verifyTwilio();
      } finally {
        delete process.env.TWILIO_ACCOUNT_SID;
      }
    });
    expect(r.outcome).toBe("fail");
    expect(r.detail).toContain("TWILIO_AUTH_TOKEN");
  });

  it("verifyNipr skips when NIPR_API_KEY is unset", async () => {
    const r = await withClearedEnv(["NIPR_API_KEY"], () => verifyNipr());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("nipr");
  });

  it("verifyEmail skips when neither provider key is set", async () => {
    const r = await withClearedEnv(["SENDGRID_API_KEY", "RESEND_API_KEY"], () => verifyEmail());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("email");
  });

  it("verifyTrustedForm skips when TRUSTEDFORM_API_KEY is unset", async () => {
    const r = await withClearedEnv(["TRUSTEDFORM_API_KEY"], () => verifyTrustedForm());
    expect(r.outcome).toBe("skip");
    expect(r.service).toBe("trustedform");
  });
});

describe("formatResult", () => {
  it("renders a pass result with the service name padded", () => {
    const out = formatResult({ service: "stripe", outcome: "pass", detail: "ok" });
    expect(out).toContain("stripe");
    expect(out).toContain("ok");
  });

  it("renders fail and skip distinct icons", () => {
    const fail = formatResult({ service: "x", outcome: "fail", detail: "bad" });
    const skip = formatResult({ service: "x", outcome: "skip", detail: "n/a" });
    expect(fail).not.toBe(skip);
  });
});
