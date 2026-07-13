// Builders for the in-app notifications produced by platform events.
//
// Harvested from the leadmarket sibling repo (see ADR 0001). Kept pure and
// separate from the route handlers so the copy/shape can be unit-tested without
// a DB round-trip; the handlers just hand the result to storage.

import type { InsertUserNotification } from "@shared/schema";

export function purchaseNotification(userId: string, leadId: number): InsertUserNotification {
  return {
    userId,
    title: "Lead purchased",
    message: `You purchased lead #${leadId}.`,
    type: "success",
  };
}

export function walletFundedNotification(userId: string, amount: number): InsertUserNotification {
  return {
    userId,
    title: "Wallet funded",
    message: `$${amount.toFixed(2)} has been added to your balance.`,
    type: "success",
  };
}

export function savedSearchMatchNotification(
  userId: string,
  searchName: string,
  leadId: number,
): InsertUserNotification {
  return {
    userId,
    title: "New lead matches your saved search",
    message: `A new lead matches your saved search "${searchName}" (lead #${leadId}).`,
    type: "info",
  };
}
