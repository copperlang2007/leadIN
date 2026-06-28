import { storage } from "./storage";
import { logError } from "./lib/safeError";

// Email service over SendGrid or Resend, selected by which API key is set.
//
// Observability is the whole point of this module's shape: the #1 reason
// production email silently stops working is an UNVERIFIED SENDER DOMAIN —
// the provider accepts the API key but rejects the send with 403 because
// DKIM/SPF isn't set up for the from-address. Previously every failure
// path here returned `false` with no log, so that 403 was indistinguishable
// from "no email service configured" and from a transient network blip.
// Now every non-success logs the provider + HTTP status + a masked
// recipient so an operator can actually diagnose a dead pipeline.

const SEND_TIMEOUT_MS = 10_000;
// Brand fallback when the operator hasn't set a from-address. Note: sending
// from a domain you don't control guarantees a DKIM failure, so we also
// warn when we fall back — the env var should always be set in prod.
const DEFAULT_FROM = "noreply@leadmarket.app";

/** Mask an email for logs: j***@example.com — enough to correlate a
 *  bounce without writing the full PII address to stdout / log shippers. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local[0] ?? "";
  return `${head}***@${domain}`;
}

function fromAddress(envVar: string | undefined, provider: string): string {
  if (envVar && envVar.trim()) return envVar.trim();
  console.warn(
    `[email] ${provider}: from-address env var unset — falling back to ${DEFAULT_FROM}. ` +
      `Set the *_FROM_EMAIL var to a DKIM-verified address or sends will be rejected.`,
  );
  return DEFAULT_FROM;
}

async function postWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmailViaSendGrid(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await postWithTimeout("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromAddress(process.env.SENDGRID_FROM_EMAIL, "sendgrid") },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });
    if (!response.ok) {
      // 401 = bad key, 403 = unverified sender (the DKIM trap), 413 =
      // payload too large, 429 = rate limited. Surface the status + a
      // short body so the operator knows which.
      const body = (await response.text().catch(() => "")).slice(0, 500);
      logError(
        "email.sendgrid non-OK",
        new Error(`HTTP ${response.status} to ${maskEmail(to)}: ${body}`),
      );
      return false;
    }
    return true;
  } catch (err) {
    logError(`email.sendgrid failed to ${maskEmail(to)}`, err);
    return false;
  }
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await postWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(process.env.RESEND_FROM_EMAIL, "resend"),
        to: [to],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 500);
      logError(
        "email.resend non-OK",
        new Error(`HTTP ${response.status} to ${maskEmail(to)}: ${body}`),
      );
      return false;
    }
    return true;
  } catch (err) {
    logError(`email.resend failed to ${maskEmail(to)}`, err);
    return false;
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  // Try SendGrid first, then Resend
  if (process.env.SENDGRID_API_KEY) {
    return sendEmailViaSendGrid(to, subject, html);
  }
  if (process.env.RESEND_API_KEY) {
    return sendEmailViaResend(to, subject, html);
  }
  // No provider configured — dev/CI. Log at info so a developer wondering
  // "why didn't the email send" sees it, but don't treat it as an error.
  console.log(`[email] no provider configured — would send to ${maskEmail(to)}: ${subject}`);
  return false;
}

function buildNewLeadEmailHtml(leadData: {
  id: number;
  type: string;
  state: string;
  price: string;
  exclusivity: string;
  vendorName: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #1a56db; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">New Lead Available</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">A new lead matching your preferences just hit the marketplace</p>
      </div>
      <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Lead Type</td>
            <td style="padding: 8px 0; font-weight: 600; text-align: right;">${leadData.type}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">State</td>
            <td style="padding: 8px 0; font-weight: 600; text-align: right;">${leadData.state}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Price</td>
            <td style="padding: 8px 0; font-weight: 600; text-align: right; color: #1a56db;">$${parseFloat(leadData.price).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Exclusivity</td>
            <td style="padding: 8px 0; font-weight: 600; text-align: right;">${leadData.exclusivity}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Vendor</td>
            <td style="padding: 8px 0; font-weight: 600; text-align: right;">${leadData.vendorName}</td>
          </tr>
        </table>
        <div style="margin-top: 24px; text-align: center;">
          <a href="${process.env.APP_URL || 'https://leadmarket.io'}" 
             style="background: #1a56db; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
            View Lead in Marketplace
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 24px;">
          You're receiving this because you have email notifications enabled. 
          <a href="${process.env.APP_URL || 'https://leadmarket.io'}/profile" style="color: #1a56db;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;
}

export async function notifyUsersAboutNewLead(lead: {
  id: number;
  type: string;
  state: string;
  price: string;
  exclusivity: string;
  vendorName: string;
}): Promise<void> {
  try {
    const matchingUsers = await storage.getMatchingUsersForLead(lead.type, lead.state);

    const emailPromises = matchingUsers
      .filter(user => user.email)
      .map(async user => {
        // Check if we already sent a notification for this lead
        const alreadySent = await storage.hasNotification(user.id, lead.id);
        if (alreadySent) return;

        const html = buildNewLeadEmailHtml(lead);
        await sendEmail(
          user.email!,
          `New ${lead.type} Lead Available in ${lead.state}`,
          html
        );

        // Record that we sent the notification
        await storage.recordNotification(user.id, lead.id);
      });

    await Promise.allSettled(emailPromises);
  } catch (err) {
    logError("Error sending lead notifications:", err);
  }
}
