import { format, subDays, subHours } from "date-fns";

export type LeadType = "Medicare Advantage" | "Medicare Supplement" | "Final Expense" | "Term Life";
export type LeadSource = "Facebook" | "Direct Mail" | "Call Center Transfer" | "Organic Search";
export type Exclusivity = "Exclusive" | "Shared (2)" | "Shared (4)" | "Aged";

export interface Lead {
  id: string;
  type: LeadType;
  source: LeadSource;
  exclusivity: Exclusivity;
  price: number;
  age: number; // Lead age in days
  consumerAge: number;
  state: string;
  zipCode: string;
  generatedAt: string;
  compatibilityScore: number; // 0-100
  verified: boolean;
  provenance: ProvenanceStep[];
  vendor: {
    name: string;
    rating: number; // 0-5
    verified: boolean;
  };
  attributes: {
    income?: string;
    hasCondition?: boolean;
    homeowner?: boolean;
    gender?: "M" | "F";
    smoker?: boolean;
  };
}

export interface ProvenanceStep {
  date: string;
  action: string;
  actor: string;
  icon: "check" | "lock" | "eye" | "mail";
}

const VENDORS = [
  { name: "Apex Lead Gen", rating: 4.8, verified: true },
  { name: "MediConnect Sources", rating: 4.5, verified: true },
  { name: "Value Leads Direct", rating: 3.9, verified: false },
  { name: "Senior Benefits Data", rating: 4.9, verified: true },
];

const STATES = ["FL", "TX", "CA", "AZ", "NC", "SC", "OH", "MI"];

export const MOCK_LEADS: Lead[] = Array.from({ length: 50 }).map((_, i) => {
  const type = ["Medicare Advantage", "Medicare Supplement", "Final Expense"][Math.floor(Math.random() * 3)] as LeadType;
  const source = ["Facebook", "Direct Mail", "Call Center Transfer"][Math.floor(Math.random() * 3)] as LeadSource;
  const exclusivity = ["Exclusive", "Shared (2)", "Shared (4)", "Aged"][Math.floor(Math.random() * 4)] as Exclusivity;
  const state = STATES[Math.floor(Math.random() * STATES.length)];
  const vendor = VENDORS[Math.floor(Math.random() * VENDORS.length)];
  
  // Calculate price based on quality
  let basePrice = 0;
  if (type === "Medicare Advantage") basePrice = 45;
  if (type === "Medicare Supplement") basePrice = 35;
  if (type === "Final Expense") basePrice = 25;
  
  if (exclusivity === "Exclusive") basePrice *= 1.5;
  if (exclusivity === "Aged") basePrice *= 0.2;
  if (source === "Call Center Transfer") basePrice *= 2;
  
  const generatedDate = subHours(new Date(), Math.floor(Math.random() * 72));
  
  return {
    id: `LD-${1000 + i}`,
    type,
    source,
    exclusivity,
    price: Math.round(basePrice),
    age: Math.floor(Math.random() * 5),
    consumerAge: 65 + Math.floor(Math.random() * 15),
    state,
    zipCode: `${Math.floor(10000 + Math.random() * 90000)}`,
    generatedAt: generatedDate.toISOString(),
    compatibilityScore: Math.floor(Math.random() * 40) + 60, // 60-100
    verified: Math.random() > 0.3,
    vendor,
    attributes: {
      income: Math.random() > 0.5 ? "$25k-50k" : "$50k+",
      homeowner: Math.random() > 0.4,
      gender: Math.random() > 0.5 ? "M" : "F",
      smoker: Math.random() > 0.8,
    },
    provenance: [
      { date: generatedDate.toISOString(), action: "Lead Generated", actor: "Consumer Form", icon: "check" },
      { date: subHours(generatedDate, -1).toISOString(), action: "TCPA Verified", actor: "TrustedForm", icon: "lock" },
      { date: subHours(generatedDate, -2).toISOString(), action: "Quality Scrub", actor: "System", icon: "eye" },
    ]
  };
});

// Mock user profile for compatibility matching
export const USER_PROFILE = {
  licensedStates: ["FL", "TX", "NC"],
  preferredTypes: ["Medicare Advantage"],
  budget: 5000,
};
