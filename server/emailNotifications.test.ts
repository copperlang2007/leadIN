import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendEmail, maskEmail } from "./emailNotifications";

describe("maskEmail", () => {
  it("keeps the first local char + full domain", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
  });
  it("handles single-char local parts", () => {
    expect(maskEmail("a@x.io")).toBe("a***@x.io");
  });
  it("returns *** for malformed input (no @)", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@nolocal.com")).toBe("***");
  });
});

describe("sendEmail provider selection + failure observability", () => {
  let savedSg: string | undefined;
  let savedResend: string | undefined;
  let savedSgFrom: string | undefined;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedSg = process.env.SENDGRID_API_KEY;
    savedResend = process.env.RESEND_API_KEY;
    savedSgFrom = process.env.SENDGRID_FROM_EMAIL;
    savedFetch = global.fetch;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (savedSg !== undefined) process.env.SENDGRID_API_KEY = savedSg;
    else delete process.env.SENDGRID_API_KEY;
    if (savedResend !== undefined) process.env.RESEND_API_KEY = savedResend;
    else delete process.env.RESEND_API_KEY;
    if (savedSgFrom !== undefined) process.env.SENDGRID_FROM_EMAIL = savedSgFrom;
    else delete process.env.SENDGRID_FROM_EMAIL;
    global.fetch = savedFetch;
  });

  it("returns false (no throw) when no provider is configured", async () => {
    const ok = await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(ok).toBe(false);
  });

  it("returns true on a 2xx SendGrid response", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.SENDGRID_FROM_EMAIL = "noreply@leadmarket.app";
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    const ok = await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/mail/send",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns false and does NOT throw on a 403 (unverified-sender / DKIM trap)", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.SENDGRID_FROM_EMAIL = "noreply@leadmarket.app";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "from address not verified" }] }), {
        status: 403,
      }),
    );
    const ok = await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(ok).toBe(false);
  });

  it("returns false and does NOT throw on a network error", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const ok = await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(ok).toBe(false);
  });

  it("prefers SendGrid when both keys are set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    global.fetch = fetchMock;
    await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(fetchMock.mock.calls[0][0]).toContain("sendgrid.com");
  });

  it("falls through to Resend when only its key is set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    global.fetch = fetchMock;
    const ok = await sendEmail("jane@example.com", "Hi", "<p>Hi</p>");
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("resend.com");
  });
});
