// Wave 7 (T4) — NIPR/DOI auto-verification.
//
// `verifyAgentLicense(userId)` hits NIPR via `./lib/nipr` and caches the
// outcome on agent_profiles (niprVerifiedAt / niprLicenseExpiry / niprLastError).
// It's fire-and-forget at the call site: the function swallows transport
// errors and records them on the profile so onboarding never blocks on NIPR.
//
// `runRenewalAlerts()` (registered as a daily 09:00 UTC cron) scans for
// licenses expiring within 30 days and emails the agent via `sendEmail`
// (a no-op when no provider is configured).

import { storage } from "./storage";
import { verifyLicense } from "./lib/nipr";
import { sendEmail } from "./emailNotifications";
import { registerCron } from "./lib/cronRegistry";

const RENEWAL_WINDOW_DAYS = 30;

export interface VerifyAgentLicenseResult {
  ok: boolean;
  verified?: boolean;
  expiresAt?: Date;
  error?: string;
  skipped?: boolean;
}

// Verify an agent's license via NIPR and persist the outcome.
// Returns `{ skipped: true }` when there's nothing to verify (no profile / no
// license number / no licensed state). Returns `{ ok: false, error }` and
// records the error on the profile when NIPR returns a failure.
export async function verifyAgentLicense(userId: string): Promise<VerifyAgentLicenseResult> {
  const profile = await storage.getAgentProfile(userId);
  if (!profile) return { ok: false, skipped: true, error: "no profile" };
  if (!profile.licenseNumber) return { ok: false, skipped: true, error: "no license number" };
  const state = profile.licensedStates?.[0];
  if (!state) return { ok: false, skipped: true, error: "no licensed state" };

  try {
    const res = await verifyLicense({
      state,
      licenseNumber: profile.licenseNumber,
    });

    if (!res.verified) {
      await storage.updateAgentNipr(userId, {
        verifiedAt: null,
        expiry: null,
        error: res.error ?? "not verified",
      });
      return { ok: false, verified: false, error: res.error };
    }

    await storage.updateAgentNipr(userId, {
      verifiedAt: new Date(),
      expiry: res.expiresAt ?? null,
      error: null,
    });
    return { ok: true, verified: true, expiresAt: res.expiresAt };
  } catch (err: any) {
    const message = err?.message ?? "nipr verify threw";
    // Don't let a transport blip clobber a previously good verification;
    // record only the error string so operators can see the failure trail.
    await storage.updateAgentNipr(userId, { error: message }).catch(() => {});
    return { ok: false, error: message };
  }
}

function buildRenewalEmailHtml(agentName: string, expiresAt: Date, daysLeft: number): string {
  const dateStr = expiresAt.toISOString().slice(0, 10);
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #b45309; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px;">License Renewal Reminder</h1>
      </div>
      <div style="background: #fef3c7; padding: 20px; border: 1px solid #fcd34d; border-top: none;">
        <p>Hi ${agentName || "there"},</p>
        <p>Your producer license on file with us expires on <strong>${dateStr}</strong> (${daysLeft} day${daysLeft === 1 ? "" : "s"} from today).</p>
        <p>Renew at the NIPR portal to keep receiving routed leads without interruption.</p>
        <p style="color:#92400e; font-size:13px;">You're receiving this because your license expiry is within ${RENEWAL_WINDOW_DAYS} days.</p>
      </div>
    </div>
  `;
}

export interface RenewalAlertSummary {
  scanned: number;
  alerted: number;
  errors: number;
}

// Daily cron: find agents whose license expires within RENEWAL_WINDOW_DAYS
// and email them. Idempotent at the send layer — sendEmail is a no-op when
// no provider env vars are set, so this is safe to run in CI/dev.
export async function runRenewalAlerts(): Promise<RenewalAlertSummary> {
  const expiring = await storage.findAgentsExpiringWithin(RENEWAL_WINDOW_DAYS);
  let alerted = 0;
  let errors = 0;
  const now = Date.now();

  for (const a of expiring) {
    if (!a.user.email) continue;
    if (!a.niprLicenseExpiry) continue;
    const daysLeft = Math.max(
      0,
      Math.ceil((a.niprLicenseExpiry.getTime() - now) / (24 * 60 * 60 * 1000)),
    );
    const name = [a.user.firstName, a.user.lastName].filter(Boolean).join(" ").trim();
    try {
      await sendEmail(
        a.user.email,
        `Your insurance license expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        buildRenewalEmailHtml(name, a.niprLicenseExpiry, daysLeft),
      );
      alerted += 1;
    } catch (err: any) {
      console.error(`[nipr-renewal] send failed for ${a.userId}:`, err?.message);
      errors += 1;
    }
  }

  if (expiring.length > 0) {
    console.log(`[nipr-renewal] scanned ${expiring.length} expiring licenses, alerted ${alerted}, errors ${errors}`);
  }
  return { scanned: expiring.length, alerted, errors };
}

export function startNiprRenewalCron(): void {
  // 09:00 UTC daily — early enough that any same-day onboarding pre-checks
  // see a fresh expiry signal but outside the 02:00-04:00 maintenance window.
  registerCron({
    name: "nipr-renewal-alerts",
    schedule: "0 9 * * *",
    fn: async () => { await runRenewalAlerts(); },
  });
}
