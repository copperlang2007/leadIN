// Public terms of service. Linked from the footer; required for
// Stripe live mode and standard GTM credibility. Template — banner
// at top of LegalLayout flags that explicitly.

import { LegalLayout, H2 } from "./legal-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useCanonicalUrl } from "@/hooks/useCanonicalUrl";

const LAST_UPDATED = "January 1, 2026";

export default function TermsOfService() {
  useDocumentTitle("Terms of Service");
  useCanonicalUrl("/terms");
  return (
    <LegalLayout title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service ("Terms") govern your access to and use of
        the LeadMarket website, applications, and APIs (collectively, the
        "Services") operated by LeadMarket ("we", "us"). By creating an
        account, listing a lead, or purchasing a lead you agree to these
        Terms. If you don't agree, don't use the Services.
      </p>

      <H2 id="accounts">1. Accounts</H2>
      <p>
        You must be at least 18 years old and legally able to enter into
        a binding contract. You're responsible for safeguarding your
        account credentials and for all activity under your account. You
        must promptly notify us of any unauthorized access.
      </p>

      <H2 id="roles">2. Roles</H2>
      <p>
        The Services support multiple user types: agents who purchase
        leads, vendors who list leads, and organization admins who
        manage members and billing. Specific obligations depend on your
        role:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Buyers (agents).</strong> You represent that you hold the
          insurance license(s) required for the lead types and states you
          purchase. You agree to comply with all DNC, TCPA, and state-level
          telemarketing requirements when contacting consumers.
        </li>
        <li>
          <strong>Vendors.</strong> You represent that every lead you list
          was generated in compliance with TCPA and applicable consumer
          consent rules, that you have proof of consent (TrustedForm /
          Jornaya certificate or equivalent), and that the lead has not
          been previously sold as exclusive.
        </li>
        <li>
          <strong>Org admins.</strong> You agree to keep the membership
          and billing information for your organization accurate and to
          revoke access for members who leave promptly.
        </li>
      </ul>

      <H2 id="acceptable-use">3. Acceptable use</H2>
      <p>You agree not to:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Re-sell, redistribute, or post leads on third-party
            marketplaces without our written permission.</li>
        <li>Contact consumers in violation of TCPA, DNC, or state
            do-not-call rules. The platform's DNC re-check at dial time
            is a guardrail, not a substitute for your own compliance.</li>
        <li>Misuse the API or webhooks (e.g. forging webhook events,
            spamming our rate limits, attempting to extract bulk PII).</li>
        <li>Reverse engineer or attempt to access the Services
            outside the documented interfaces.</li>
      </ul>

      <H2 id="payments">4. Payments and refunds</H2>
      <p>
        Wallet top-ups, per-lead purchases, and subscription billing are
        processed through Stripe. All charges are denominated in USD.
        Per-lead purchases are final at the moment of the transaction,
        subject to the dispute process described below. Subscriptions
        renew automatically on the cadence you select (monthly or annual)
        and can be cancelled at any time from the billing settings — your
        access continues through the end of the current paid period.
      </p>

      <H2 id="disputes">5. Lead disputes</H2>
      <p>
        Buyers may dispute a purchased lead within seven days for the
        documented reasons: bad contact info, duplicate lead, TCPA
        non-compliance, or material misrepresentation by the vendor.
        Disputes are reviewed and, where approved, refunded to your
        wallet (or to the original payment method at our discretion). The
        platform's dispute history feeds vendor reputation and may
        result in vendor suspension.
      </p>

      <H2 id="ip">6. Intellectual property</H2>
      <p>
        The Services, their content (excluding user-supplied lead data),
        and all associated trademarks are owned by us or our licensors.
        We grant you a limited, non-exclusive, non-transferable licence
        to access and use the Services for your internal business
        purposes for the duration of your account.
      </p>

      <H2 id="warranties">7. Disclaimers</H2>
      <p>
        The Services are provided "as is" and "as available". We do not
        warrant that every lead will convert, that consumer information
        is current at the time of contact, or that the Services will be
        uninterrupted or error-free. Compliance with TCPA, DNC, and
        state telemarketing rules is your responsibility as the
        contacting party.
      </p>

      <H2 id="liability">8. Limitation of liability</H2>
      <p>
        To the maximum extent permitted by law, our aggregate liability
        for any claim arising out of or relating to the Services is
        limited to the greater of (a) the fees paid by you to us in the
        12 months preceding the event giving rise to the claim, or (b)
        US$100. In no event will we be liable for indirect, incidental,
        consequential, or punitive damages.
      </p>

      <H2 id="indemnity">9. Indemnification</H2>
      <p>
        You agree to indemnify and hold us harmless from any third-party
        claim arising out of your breach of these Terms, your violation
        of applicable law (including TCPA and DNC), or your misuse of
        leads obtained through the Services.
      </p>

      <H2 id="termination">10. Termination</H2>
      <p>
        Either party may terminate the account relationship at any time.
        We may suspend or terminate accounts immediately for material
        breach (TCPA violation, fraud, payment failure). Sections that by
        their nature should survive — payment obligations, disclaimers,
        liability limits, indemnity, dispute resolution — survive any
        termination.
      </p>

      <H2 id="law">11. Governing law and dispute resolution</H2>
      <p>
        These Terms are governed by the laws of the State of [STATE],
        excluding its conflicts of laws principles. Any dispute will be
        resolved by binding arbitration in [VENUE] before a single
        arbitrator under the AAA Commercial Rules, except either party
        may seek injunctive relief in court for misuse of intellectual
        property or unauthorised access. [Operator: replace bracketed
        values with your real venue.]
      </p>

      <H2 id="changes">12. Changes to these Terms</H2>
      <p>
        We may revise these Terms from time to time. Material changes
        will be announced via in-app notice or email at least 30 days
        before they take effect. Your continued use of the Services
        after that point constitutes acceptance of the revised Terms.
      </p>
    </LegalLayout>
  );
}
