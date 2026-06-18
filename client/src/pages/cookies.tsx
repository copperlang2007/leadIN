// Public cookie policy. Linked from the footer alongside Privacy +
// Terms. Required by ePrivacy / state cookie disclosure laws if the
// site sets any non-essential cookies (analytics, marketing).

import { LegalLayout, H2, DLRow } from "./legal-layout";

const LAST_UPDATED = "January 1, 2026";

export default function CookiePolicy() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Cookie Policy explains how LeadMarket uses cookies and
        similar technologies on our website. It supplements our{" "}
        <a href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </a>{" "}
        and our{" "}
        <a href="/terms" className="text-primary hover:underline">
          Terms of Service
        </a>
        .
      </p>

      <H2 id="what-are-cookies">1. What is a cookie?</H2>
      <p>
        A cookie is a small text file a website places on your device to
        remember information about your visit — your preferences, your
        sign-in state, or whether you've seen a particular notice. Some
        cookies are essential for the site to work; others are optional
        and provide analytics or marketing features.
      </p>

      <H2 id="categories">2. Categories of cookies we use</H2>
      <dl className="border rounded-lg divide-y">
        <DLRow
          term="Strictly necessary"
          def="Session cookies that keep you signed in (express-session + connect-pg-simple). Required for the Services to work; cannot be disabled."
        />
        <DLRow
          term="CSRF protection"
          def="A non-httpOnly token cookie the SPA reads to attach a double-submit header on state-changing requests."
        />
        <DLRow
          term="Stripe checkout"
          def="When you redirect to Stripe for wallet top-up or subscription checkout, Stripe sets its own session cookies on stripe.com. Governed by Stripe's privacy policy."
        />
        <DLRow
          term="Functional preferences"
          def="UI preferences (theme, table column widths) — currently stored in localStorage, not cookies."
        />
        <DLRow
          term="Analytics"
          def="Aggregate page-view and behavior signals used to compute MediScore inputs and to improve the product. We don't share this with third-party advertising networks."
        />
      </dl>

      <H2 id="choices">3. Your choices</H2>
      <p>
        Most browsers let you block or delete cookies. Blocking the
        strictly-necessary cookies will sign you out and prevent you
        from using authenticated features. Blocking analytics has no
        effect on the Services beyond reducing the precision of
        platform-level engagement metrics.
      </p>
      <p>
        If you're in a jurisdiction that requires consent for
        non-essential cookies (EEA/UK), you'll see a banner the first
        time you visit. You can change your choice at any time via the
        "Cookie preferences" link in the footer once the banner has been
        actioned.
      </p>

      <H2 id="changes">4. Changes to this policy</H2>
      <p>
        We may update this Cookie Policy from time to time. We'll
        announce material changes via in-app notice or email and reset
        the "Last updated" date above.
      </p>
    </LegalLayout>
  );
}
