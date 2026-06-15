import { db } from "./db";
import { vendors, leads } from "@shared/schema";
import { safeError } from "./lib/safeError";

const VENDORS_DATA = [
  { name: "Apex Lead Gen", rating: "4.8", verified: true },
  { name: "MediConnect Sources", rating: "4.5", verified: true },
  { name: "Value Leads Direct", rating: "3.9", verified: false },
  { name: "Senior Benefits Data", rating: "4.9", verified: true },
];

const LEAD_TYPES = ["Medicare Advantage", "Medicare Supplement", "Final Expense"];
const LEAD_SOURCES = ["Facebook", "Direct Mail", "Call Center Transfer", "Organic Search"];
const EXCLUSIVITY_TYPES = ["Exclusive", "Shared (2)", "Shared (4)", "Aged"];
const STATES = ["FL", "TX", "CA", "AZ", "NC", "SC", "OH", "MI"];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateProvenance() {
  const now = new Date();
  const generated = new Date(now.getTime() - randomBetween(1, 72) * 60 * 60 * 1000);
  const verified = new Date(generated.getTime() + 60 * 60 * 1000);
  const scrubbed = new Date(verified.getTime() + 60 * 60 * 1000);

  return [
    {
      date: generated.toISOString(),
      action: "Lead Generated",
      actor: "Consumer Form",
      icon: "check"
    },
    {
      date: verified.toISOString(),
      action: "TCPA Verified",
      actor: "TrustedForm",
      icon: "lock"
    },
    {
      date: scrubbed.toISOString(),
      action: "Quality Scrub",
      actor: "System",
      icon: "eye"
    }
  ];
}

async function seed() {
  console.log("Starting seed...");

  // Check if vendors already exist
  const existingVendors = await db.select().from(vendors);
  
  let vendorIds: number[];

  if (existingVendors.length === 0) {
    console.log("Seeding vendors...");
    const insertedVendors = await db
      .insert(vendors)
      .values(VENDORS_DATA)
      .returning();
    vendorIds = insertedVendors.map(v => v.id);
    console.log(`Created ${vendorIds.length} vendors`);
  } else {
    vendorIds = existingVendors.map(v => v.id);
    console.log(`Using existing ${vendorIds.length} vendors`);
  }

  // Check if leads already exist
  const existingLeads = await db.select().from(leads);
  
  if (existingLeads.length === 0) {
    console.log("Seeding leads...");
    
    const leadsData = [];
    for (let i = 0; i < 100; i++) {
      const type = randomElement(LEAD_TYPES);
      const source = randomElement(LEAD_SOURCES);
      const exclusivity = randomElement(EXCLUSIVITY_TYPES);
      const state = randomElement(STATES);

      // Calculate price based on quality
      let basePrice = 0;
      if (type === "Medicare Advantage") basePrice = 45;
      if (type === "Medicare Supplement") basePrice = 35;
      if (type === "Final Expense") basePrice = 25;

      if (exclusivity === "Exclusive") basePrice *= 1.5;
      if (exclusivity === "Aged") basePrice *= 0.2;
      if (source === "Call Center Transfer") basePrice *= 2;

      const price = Math.round(basePrice);
      const compatibilityScore = randomBetween(60, 100);

      leadsData.push({
        vendorId: randomElement(vendorIds),
        type,
        source,
        exclusivity,
        price: price.toString(),
        consumerAge: randomBetween(65, 80),
        state,
        zipCode: randomBetween(10000, 99999).toString(),
        verified: Math.random() > 0.3,
        compatibilityScore,
        income: Math.random() > 0.5 ? "$25k-50k" : "$50k+",
        hasCondition: Math.random() > 0.5,
        homeowner: Math.random() > 0.4,
        gender: Math.random() > 0.5 ? "M" : "F",
        smoker: Math.random() > 0.8,
        provenance: generateProvenance(),
        sold: false,
      });
    }

    await db.insert(leads).values(leadsData);
    console.log(`Created ${leadsData.length} leads`);
    // Note: seed.ts runs as a standalone script (no WebSocket server running).
    // Leads ingested via POST /api/v1/leads/ingest will broadcast in real-time.
    // Use POST /api/admin/broadcast-recent-leads after the server starts to broadcast seed leads.
  } else {
    console.log(`Database already has ${existingLeads.length} leads, skipping seed`);
  }

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", safeError(error));
  process.exit(1);
});
