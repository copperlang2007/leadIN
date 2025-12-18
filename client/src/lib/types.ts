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
  soldAt: string | null;
  purchasedBy: string | null;
  createdAt: string | null;
  vendor: Vendor;
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
