import { describe, it, expect } from "vitest";
import { evaluatePing, signOffer, verifyOffer, type PingAttributes, type OfferPayload } from "./pingPost";

const secret = "test-secret-key";
const attrs: PingAttributes = {
  type: "Medicare Advantage",
  state: "tx",
  exclusivity: "Exclusive",
  mediscoreEstimate: 100,
  intentScore: 100,
  hasPhone: true,
  hasConsent: true,
};
const baseOpts = { basePrice: 40, secret, pingId: "ping-1", nowMs: 1_700_000_000_000 };

describe("evaluatePing", () => {
  it("accepts a complete ping and returns a priced, signed offer", () => {
    const d = evaluatePing(attrs, baseOpts);
    expect(d.accept).toBe(true);
    // 40 * 1.5(q) * 1.6(intent) * 1.5(excl) * 1(demand) = 144.00
    expect(d.bidPrice).toBe("144.00");
    expect(d.token).toBeTruthy();
    expect(d.expiresAt).toBeTruthy();
  });

  it("rejects a ping missing phone or consent", () => {
    const d = evaluatePing({ ...attrs, hasPhone: false, hasConsent: false }, baseOpts);
    expect(d.accept).toBe(false);
    expect(d.reasons).toEqual(expect.arrayContaining(["missing_phone", "missing_consent"]));
    expect(d.token).toBeNull();
  });

  it("can waive consent at ping time via requireConsent:false", () => {
    const d = evaluatePing({ ...attrs, hasConsent: false }, { ...baseOpts, requireConsent: false });
    expect(d.accept).toBe(true);
  });

  it("applies surge via demandIndex", () => {
    const d = evaluatePing(attrs, { ...baseOpts, demandIndex: 2 });
    expect(d.bidPrice).toBe("288.00"); // 144 * 2
  });
});

describe("signOffer / verifyOffer", () => {
  const payload: OfferPayload = { pingId: "p1", type: "MA", state: "TX", bidPrice: "100.00", exp: 1_700_000_120 };

  it("round-trips a valid offer", () => {
    const token = signOffer(payload, secret);
    const r = verifyOffer(token, secret, 1_700_000_000_000);
    expect(r.valid).toBe(true);
    expect(r.payload).toEqual(payload);
  });

  it("rejects a tampered payload", () => {
    const token = signOffer(payload, secret);
    const [body, mac] = token.split(".");
    const forged = signOffer({ ...payload, bidPrice: "1.00" }, secret).split(".")[0] + "." + mac;
    expect(verifyOffer(forged, secret, 1_700_000_000_000).valid).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const token = signOffer(payload, secret);
    expect(verifyOffer(token, "other-secret", 1_700_000_000_000).valid).toBe(false);
  });

  it("rejects an expired offer", () => {
    const token = signOffer(payload, secret);
    // now is well past exp (exp=1_700_000_120s)
    expect(verifyOffer(token, secret, 1_700_000_200_000).reason).toBe("expired");
  });

  it("rejects malformed tokens", () => {
    expect(verifyOffer("garbage", secret).reason).toBe("malformed_token");
    expect(verifyOffer("", secret).reason).toBe("malformed_token");
    expect(verifyOffer("a.b.c", secret).reason).toBe("malformed_token"); // >2 segments
  });

  it("the token minted by evaluatePing verifies before expiry and fails after", () => {
    const d = evaluatePing(attrs, baseOpts);
    const beforeExp = baseOpts.nowMs + 60_000; // 60s later, ttl 120s
    const afterExp = baseOpts.nowMs + 130_000;
    expect(verifyOffer(d.token!, secret, beforeExp).valid).toBe(true);
    expect(verifyOffer(d.token!, secret, afterExp).valid).toBe(false);
  });
});
