import { describe, it, expect } from "vitest";
import {
  purchaseNotification,
  savedSearchMatchNotification,
  walletFundedNotification,
} from "./userNotificationMessages";

describe("purchaseNotification", () => {
  it("addresses the user and references the lead id", () => {
    expect(purchaseNotification("user-1", 42)).toEqual({
      userId: "user-1",
      title: "Lead purchased",
      message: "You purchased lead #42.",
      type: "success",
    });
  });
});

describe("walletFundedNotification", () => {
  it("formats the credited amount to two decimals", () => {
    expect(walletFundedNotification("user-1", 25)).toEqual({
      userId: "user-1",
      title: "Wallet funded",
      message: "$25.00 has been added to your balance.",
      type: "success",
    });
  });

  it("handles fractional amounts", () => {
    expect(walletFundedNotification("user-1", 12.5).message).toBe(
      "$12.50 has been added to your balance.",
    );
  });
});

describe("savedSearchMatchNotification", () => {
  it("names the search and references the lead id", () => {
    expect(savedSearchMatchNotification("user-1", "Cheap CA Medicare", 42)).toEqual({
      userId: "user-1",
      title: "New lead matches your saved search",
      message: 'A new lead matches your saved search "Cheap CA Medicare" (lead #42).',
      type: "info",
    });
  });
});
