// Daily email digest for org owners + admins. Summarises the last 24h:
// new leads ingested, assignments routed, purchases, DNC flags.
// No-op when neither SENDGRID_API_KEY nor RESEND_API_KEY is configured —
// keeps dev/CI quiet.

import { db } from "./db";
import { and, eq, gte, sql, count, inArray } from "drizzle-orm";
import { leads, orders, leadAssignments, orgMembers, users, organizations } from "@shared/schema";
import { sendEmail } from "./emailNotifications";
import { registerCron } from "./lib/cronRegistry";

interface OrgDigest {
  orgName: string;
  newLeads: number;
  newAssignments: number;
  orders: number;
  revenue: string;
  dncFlagged: number;
}

async function buildDigestForOrg(orgId: string, since: Date): Promise<OrgDigest | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;

  const [newLeadsRow] = await db
    .select({ c: count(), flagged: sql<number>`COUNT(*) FILTER (WHERE ${leads.dncFlagged} = true)::int` })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, since)));

  const [assignRow] = await db
    .select({ c: count() })
    .from(leadAssignments)
    .where(and(eq(leadAssignments.orgId, orgId), gte(leadAssignments.createdAt, since)));

  const [orderRow] = await db
    .select({ c: count(), total: sql<string>`COALESCE(SUM(${orders.price}::numeric), 0)::text` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, since)));

  return {
    orgName: org.name,
    newLeads: Number(newLeadsRow?.c ?? 0),
    newAssignments: Number(assignRow?.c ?? 0),
    orders: Number(orderRow?.c ?? 0),
    revenue: String(orderRow?.total ?? "0"),
    dncFlagged: Number(newLeadsRow?.flagged ?? 0),
  };
}

function digestHtml(d: OrgDigest): string {
  return `
    <h2 style="font-family: -apple-system, sans-serif; color: #111;">Daily digest — ${d.orgName}</h2>
    <p style="font-family: -apple-system, sans-serif; color: #555;">Last 24 hours.</p>
    <table style="font-family: -apple-system, sans-serif; border-collapse: collapse; min-width: 280px;">
      <tr><td style="padding: 6px 12px;">New leads</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">${d.newLeads}</td></tr>
      <tr><td style="padding: 6px 12px;">Of which DNC-flagged</td><td style="padding: 6px 12px; text-align: right; color: #c14b4b;">${d.dncFlagged}</td></tr>
      <tr><td style="padding: 6px 12px;">Routed assignments</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">${d.newAssignments}</td></tr>
      <tr><td style="padding: 6px 12px;">Purchases</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">${d.orders}</td></tr>
      <tr><td style="padding: 6px 12px;">Revenue</td><td style="padding: 6px 12px; text-align: right; font-weight: 600;">$${parseFloat(d.revenue).toFixed(2)}</td></tr>
    </table>
  `;
}

export async function runDailyDigest(): Promise<{ orgsScanned: number; emailsSent: number }> {
  // Skip entirely if no email provider is configured.
  if (!process.env.SENDGRID_API_KEY && !process.env.RESEND_API_KEY) {
    return { orgsScanned: 0, emailsSent: 0 };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const orgs = await db.select().from(organizations);

  let emailsSent = 0;
  for (const org of orgs) {
    const digest = await buildDigestForOrg(org.id, since);
    if (!digest) continue;
    if (digest.newLeads === 0 && digest.newAssignments === 0 && digest.orders === 0) continue;

    const adminRows = await db
      .select()
      .from(orgMembers)
      .leftJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, org.id), inArray(orgMembers.role, ["owner", "admin"])));

    const html = digestHtml(digest);
    for (const row of adminRows) {
      if (!row.users?.email) continue;
      const ok = await sendEmail(row.users.email, `LeadMarket digest — ${digest.orgName}`, html);
      if (ok) emailsSent += 1;
    }
  }
  return { orgsScanned: orgs.length, emailsSent };
}

export function startEmailDigestCron(): void {
  // 08:00 UTC — late evening US, fresh data for the next morning's stand-up.
  registerCron({
    name: "email-digest",
    schedule: "0 8 * * *",
    fn: async () => { await runDailyDigest(); },
  });
}
