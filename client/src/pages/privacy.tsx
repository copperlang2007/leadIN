// Public privacy policy. Linked from the footer; required for Stripe
// live mode and any GTM workflow that involves real user signups.
// Template content — banner at the top of the layout makes that
// explicit for operators.

import { LegalLayout, H2 } from "./legal-layout";

const LAST_UPDATED = "January 1, 2026";

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Privacy Policy describes how LeadMarket ("we", "us", "our")
        collects, uses, and shares personal information when you visit our
        website, register for an account, purchase or list leads, or
        otherwise interact with our services (collectively, the "Services").
        By using the Services you consent to the practices described here.
      </p>

      <H2 id="data-we-collect">1. Information we collect</H2>
      <p>We collect the following categories of information:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Account data.</strong> Name, email address, phone number,
          organization name, role, and any profile data you provide
          (licensed states, preferred lead types, etc.).
        </li>
        <li>
          <strong>Authentication data.</strong> OpenID Connect identifiers
          received from the identity provider you sign in with, including
          subject claim, name, email, and profile image URL.
        </li>
        <li>
          <strong>Transaction data.</strong> Wallet balance, top-up history,
          subscription tier, Stripe customer ID, and the identifiers of
          leads you purchase. Payment card details are processed directly by
          our payment processor (Stripe) and never stored on our servers.
        </li>
        <li>
          <strong>Lead data.</strong> When you list a lead with us, we
          collect the consumer information you supply (name, phone, email,
          address, age, state) along with provenance metadata
          (TrustedForm/Jornaya certificates, source URL, capture timestamp).
        </li>
        <li>
          <strong>Behavioral data.</strong> Pages visited, features used,
          clicks on key calls-to-action, and aggregate engagement metrics.
          We use this to improve the product and to compute MediScore
          signals for purchasing agents.
        </li>
        <li>
          <strong>Technical data.</strong> IP address, user agent, request
          timestamp, request ID. We log these for security, abuse
          prevention, and rate limiting.
        </li>
      </ul>

      <H2 id="how-we-use">2. How we use information</H2>
      <ul className="list-disc pl-5 space-y-2">
        <li>To provide the Services, including matching leads to agents
            and processing purchases.</li>
        <li>To enforce our terms (DNC checks, TCPA compliance, fraud
            detection).</li>
        <li>To send transactional emails (purchase confirmations, daily
            digests if you opt in, account notifications).</li>
        <li>To compute reputation, MediScore, and other quality signals
            that the marketplace exposes to buyers.</li>
        <li>To meet our legal obligations and respond to lawful requests
            from authorities.</li>
      </ul>

      <H2 id="sharing">3. How we share information</H2>
      <p>We share personal information only as described below:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Buyers.</strong> When you purchase a lead, we release the
          consumer contact information for that lead to you.
        </li>
        <li>
          <strong>Service providers.</strong> Stripe (payments), Twilio
          (dialer + SMS), TrustedForm/Jornaya (consent verification), DNC
          registry vendors, NIPR (license verification), Sentry (error
          monitoring), and our cloud hosting provider. Each operates under
          a data processing agreement.
        </li>
        <li>
          <strong>CRM integrations.</strong> If you connect a CRM
          (HubSpot, Salesforce, GHL, Pipedrive), we sync purchased lead
          and deal data to it under your authorization.
        </li>
        <li>
          <strong>Legal obligations.</strong> When required by law,
          subpoena, or to protect the safety of users.
        </li>
      </ul>

      <H2 id="retention">4. Retention and deletion</H2>
      <p>
        We retain personal information for as long as your account is
        active. Lead PII is automatically scrubbed after the retention
        period configured by your organization (default 365 days). You
        may request deletion of your personal data at any time by emailing{" "}
        <a href="mailto:legal@leadmarket.app" className="text-primary hover:underline">
          legal@leadmarket.app
        </a>{" "}
        — we will respond within 30 days and confirm completion of the
        deletion or explain any retention required by law.
      </p>

      <H2 id="rights">5. Your rights</H2>
      <p>
        Depending on your jurisdiction (California CCPA/CPRA, EU/UK GDPR,
        etc.), you may have rights to access, correct, delete, or restrict
        processing of your personal data, to data portability, and to
        object to certain processing. Exercise these rights by emailing{" "}
        <a href="mailto:legal@leadmarket.app" className="text-primary hover:underline">
          legal@leadmarket.app
        </a>
        . We will not discriminate against you for exercising your rights.
      </p>

      <H2 id="security">6. Security</H2>
      <p>
        We use industry-standard safeguards including TLS in transit,
        encryption at rest for sensitive fields, scoped session cookies,
        rate limiting on auth endpoints, and audit logging on every PII
        reveal. No system is perfectly secure; if we discover a breach
        affecting your data we will notify you in accordance with
        applicable law.
      </p>

      <H2 id="children">7. Children</H2>
      <p>
        The Services are not directed to anyone under 18. We do not
        knowingly collect personal data from minors.
      </p>

      <H2 id="changes">8. Changes to this policy</H2>
      <p>
        We may update this Privacy Policy from time to time. We will post
        the updated version with a new "Last updated" date and, when
        changes are material, notify account holders by email at least 30
        days before the new version takes effect.
      </p>
    </LegalLayout>
  );
}
