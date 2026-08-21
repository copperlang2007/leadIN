import "dotenv/config";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_EMAIL = process.env.ENTERPRISE_REFERENCE_OWNER_EMAIL?.trim().toLowerCase();

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!OWNER_EMAIL) throw new Error("ENTERPRISE_REFERENCE_OWNER_EMAIL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 2, ssl: DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const user = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [OWNER_EMAIL],
    );
    if (user.rowCount !== 1) {
      throw new Error(`No existing user found for ENTERPRISE_REFERENCE_OWNER_EMAIL=${OWNER_EMAIL}. Sign in once first so the account exists.`);
    }

    const userId = user.rows[0].id;

    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations
        (name, slug, billing_mode, subscription_tier, subscription_status, routing_score_threshold)
       VALUES
        ('Lead Connect Pro — Internal Enterprise', 'lead-connect-pro', 'subscription', 'enterprise', 'active', 70)
       ON CONFLICT (slug) DO UPDATE SET
         billing_mode = 'subscription',
         subscription_tier = 'enterprise',
         subscription_status = 'active',
         updated_at = NOW()
       RETURNING id`,
    );

    const orgId = org.rows[0].id;

    await client.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner'`,
      [orgId, userId],
    );

    await client.query(
      `UPDATE users SET active_org_id = $1, updated_at = NOW() WHERE id = $2`,
      [orgId, userId],
    );

    await client.query("COMMIT");
    console.log(JSON.stringify({
      ok: true,
      orgId,
      ownerEmail: OWNER_EMAIL,
      tier: "enterprise",
      billingStatus: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      note: "Internal reference entitlement: no Stripe subscription is required for this designated first-party client.",
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
