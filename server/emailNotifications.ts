import { storage } from "./storage";
import { safeError } from "./lib/safeError";

// Simple email service that uses environment variables for SendGrid or Resend
// Falls back gracefully if email service is not configured

async function sendEmailViaSendGrid(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: process.env.SENDGRID_FROM_EMAIL || "noreply@leadmarket.io" },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "noreply@leadmarket.io",
        to: [to],
        subject,
        html,
      }),
    });
    return response.ok;
  } catch {
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
  // Log but don't fail if no email service is configured
  console.log(`[Email] Would send to ${to}: ${subject} (no email service configured)`);
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
    console.error("Error sending lead notifications:", safeError(err));
  }
}
