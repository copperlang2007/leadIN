import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { verifyCrmWebhook, __resetCrmWebhookAuthForTests } from "./crmWebhookAuth";

const BODY = Buffer.from(JSON.stringify({ event: "deal.won", externalId: "abc" }));
const SECRET = "test-secret";

function signed(secret: string, body: Buffer, fmt: "sha256" | "bare" = "sha256"): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return fmt === "sha256" ? `sha256=${hex}` : hex;
}

describe("verifyCrmWebhook", () => {
  beforeEach(() => __resetCrmWebhookAuthForTests());

  it("passes through (verified=false) when no secret is configured — dev / E2E path", () => {
    const r = verifyCrmWebhook(BODY, {}, undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(false);
  });

  it("treats empty-string secret like unset — pass-through", () => {
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": "anything" }, "");
    expect(r.ok).toBe(true);
  });

  it("401s when secret is set but header is missing", () => {
    const r = verifyCrmWebhook(BODY, {}, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.reason).toBe("missing-signature");
    }
  });

  it("401s when header is malformed (non-hex)", () => {
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": "sha256=not-hex!" }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-signature");
  });

  it("401s when signature is the wrong length (length-mismatch first, before timingSafeEqual)", () => {
    // Valid hex but wrong length — guards crypto.timingSafeEqual from throwing on unequal buffers.
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": "sha256=deadbeef" }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-mismatch");
  });

  it("401s on a correctly-formatted but wrong signature", () => {
    const wrong = signed("different-secret", BODY);
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": wrong }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-mismatch");
  });

  it("accepts a valid sha256=<hex> signature", () => {
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": signed(SECRET, BODY) }, SECRET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(true);
  });

  it("accepts a valid bare-hex signature (vendors that don't use a prefix)", () => {
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": signed(SECRET, BODY, "bare") }, SECRET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(true);
  });

  it("string body works the same as Buffer body (charset agnostic for ASCII)", () => {
    const sig = signed(SECRET, BODY);
    const r = verifyCrmWebhook(BODY.toString("utf8"), { "x-lcp-signature": sig }, SECRET);
    expect(r.ok).toBe(true);
  });

  it("first-byte-only timing leak: same length but flipped first byte still 401s", () => {
    const goodHex = crypto.createHmac("sha256", SECRET).update(BODY).digest("hex");
    const flippedHex = (goodHex[0] === "f" ? "e" : "f") + goodHex.slice(1);
    const r = verifyCrmWebhook(BODY, { "x-lcp-signature": `sha256=${flippedHex}` }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-mismatch");
  });
});
