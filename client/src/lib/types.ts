// Frontend types matching the database schema

export type LeadType = "Medicare Advantage" | "Medicare Supplement" | "Final Expense";
export type LeadSource = "Facebook" | "Direct Mail" | "Call Center Transfer" | "Organic Search";
export type Exclusivity = "Exclusive" | "Shared (2)" | "Shared (4)" | "Aged";

export interface ProvenanceStep {
  date: string;
  action: string;
  actor: string;
  icon: "check" | "lock" | "eye" | "mail";
}

export interface Vendor {
  id: number;
  name: string;
  rating: string; // decimal from DB
  verified: boolean;
  createdAt: string | null;
}

// Vendor Trust Signals — surfaced on marketplace lead cards so buyers can
// judge a vendor's reliability (dispute rate over completed-sale volume)
// before purchase. Mirrors the server `VendorTrustStats` shape.
export type VendorTrustTier = "new" | "excellent" | "good" | "watch";

export interface VendorTrustStats {
  soldCount: number;
  disputeCount: number;
  disputeRate: number | null; // null when soldCount === 0
  tier: VendorTrustTier;
}

// GET /api/vendors/trust-stats returns a map keyed by vendorId.
export type VendorTrustStatsMap = Record<number, VendorTrustStats>;

export interface Lead {
  id: number;
  vendorId: number;
  type: LeadType;
  source: LeadSource;
  exclusivity: Exclusivity;
  price: string; // decimal from DB
  consumerAge: number;
  state: string;
  zipCode: string;
  verified: boolean;
  compatibilityScore: number;
  income: string | null;
  hasCondition: boolean | null;
  homeowner: boolean | null;
  gender: string | null;
  smoker: boolean | null;
  provenance: ProvenanceStep[];
  sold: boolean;
  flagged: boolean;
  removed: boolean;
  soldAt: string | null;
  purchasedBy: string | null;
  // M6 — Second-Look Re-list: sticker price + flag when the lead has been
  // re-listed at a decayed price.
  originalPrice: string | null;
  secondLook: boolean;
  repricedAt: string | null;
  createdAt: string | null;
  vendor: Vendor;
  // PII fields (null until purchased)
  consumerName: string | null;
  consumerPhone: string | null;
  consumerEmail: string | null;
  consumerAddress: string | null;
  piiGated?: boolean;
  // Phase 4 signal enrichment
  dncFlagged?: boolean;
  // Wave 2: TrustedForm / Jornaya server-side verification
  tcpaVerifiedAt: string | null;
  tcpaCertId: string | null;
  tcpaVerifiedSource: string | null;
  mediscore?: number;
  mediscoreSignals?: {
    score: number;
    activeSignalCount: number;
    signals: { key: string; label: string; weight: number; hit: boolean }[];
    computedAt: string;
  } | null;
}

export interface UserProfile {
  id: number;
  userId: string;
  licensedStates: string[];
  preferredTypes: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  balance: string; // decimal from DB
  role: string;
  notificationsEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  profile: UserProfile | null;
}

export interface Order {
  id: number;
  userId: string;
  leadId: number;
  price: string;
  status: string;
  createdAt: string | null;
  lead?: Lead;
}
