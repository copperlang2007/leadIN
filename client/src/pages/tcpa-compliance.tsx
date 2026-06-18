// Public TCPA compliance page. Linked from the footer; required for
// any lead-marketplace operator to legally surface its compliance
// posture to consumers, agents, and vendors. The internal /tcpa
// page is a different surface — the TCPA Defense Insurance product
// for paying org members. This page is for the public marketplace
// posture and consumer rights.

import { LegalLayout, H2 } from "./legal-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const LAST_UPDATED = "January 1, 2026";

export default function TcpaCompliance() {
  useDocumentTitle("TCPA Compliance");
  return (
    <LegalLayout title="TCPA Compliance" lastUpdated={LAST_UPDATED}>
      <p>
        The Telephone Consumer Protection Act (TCPA) governs how
        businesses may contact consumers by phone, SMS, and certain
        other channels in the United States. This page summarises
        LeadMarket's compliance posture as a marketplace operator and
        explains how leads sold through LeadMarket relate to your
        consent.
      </p>

      <H2 id="how-we-handle-consent">1. How leads reach LeadMarket</H2>
      <p>
        LeadMarket does not collect consumer information directly. Lead
        records arrive from independent vendors who run lead-generation
        websites and capture forms. Each vendor is contractually
        required to:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Capture the consumer's express written consent at the
            point of submission, with the language and call-to-contact
            disclosure required by TCPA's E-SIGN rules.</li>
        <li>Generate and submit a TrustedForm or Jornaya certificate
            with each lead, which we verify server-side before the
            lead becomes purchasable.</li>
        <li>Maintain the proof of consent for the duration of the
            applicable statute of limitations.</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Leads that fail TrustedForm verification at ingest are rejected
        and never appear in the marketplace.
      </p>

      <H2 id="dnc">2. DNC compliance</H2>
      <p>
        Every lead is checked against the National Do Not Call
        registry at ingest time. Leads that match the DNC are flagged
        in the marketplace and their PII is gated behind a separate
        confirmation before reveal. The platform also re-checks the
        DNC at dial time — if a consumer registered between ingest
        and the agent's first call attempt, the dialer blocks the
        call and the agent receives a replacement credit.
      </p>

      <H2 id="call-windows">3. Call-window enforcement</H2>
      <p>
        TCPA restricts marketing calls and SMS to the hours of
        8:00&nbsp;a.m. to 9:00&nbsp;p.m. in the consumer's local time
        zone. The built-in dialer enforces these windows automatically
        based on the consumer's area code. Agents may not bypass the
        window for marketing contact. (Express-consent return calls
        within an active inbound contact are not subject to this
        restriction.)
      </p>

      <H2 id="agent-responsibilities">4. Agent responsibilities</H2>
      <p>
        Agents who purchase leads from LeadMarket are responsible for
        their own compliance posture. By purchasing a lead the agent
        acknowledges:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>The consumer's consent runs to the agent's outreach for
            the licensed product and state matching the lead.</li>
        <li>The agent will honour any consumer revocation of consent
            received during outreach (verbal or written).</li>
        <li>The agent will maintain its own DNC scrub list and call
            audit log as required by TCPA and applicable state law.</li>
      </ul>

      <H2 id="consumer-rights">5. If you're a consumer</H2>
      <p>
        If you believe you were contacted in violation of TCPA, the
        consumer rights are:
      </p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <strong>Revoke consent.</strong> Tell the agent verbally or
          in writing that you no longer wish to be contacted. The
          agent must stop within a reasonable time (we recommend less
          than 24 hours).
        </li>
        <li>
          <strong>Request the source.</strong> Email{" "}
          <a href="mailto:compliance@leadmarket.app" className="text-primary hover:underline">
            compliance@leadmarket.app
          </a>{" "}
          with the phone number you were contacted at and we will
          identify the originating vendor and TrustedForm certificate
          within 7 business days.
        </li>
        <li>
          <strong>Request deletion.</strong> Email the same address to
          have your lead record scrubbed of PII from our systems. We
          honour deletion requests within 30 days.
        </li>
      </ul>

      <H2 id="reporting">6. Reporting a violation</H2>
      <p>
        Report suspected vendor-side non-compliance (e.g. a vendor
        submitting a lead without consent) to{" "}
        <a href="mailto:compliance@leadmarket.app" className="text-primary hover:underline">
          compliance@leadmarket.app
        </a>
        . Confirmed violations result in immediate suspension of the
        offending vendor and a refund of any affected purchase to the
        buying agent.
      </p>

      <H2 id="changes">7. Changes to this page</H2>
      <p>
        We may update this page as TCPA regulations evolve (most
        recently with the FCC's 2024 consent-revocation amendments and
        the one-to-one consent rule). Material changes will be
        announced via in-app notice or email at least 30 days before
        they take effect.
      </p>
    </LegalLayout>
  );
}
