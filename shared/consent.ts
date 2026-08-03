// Canonical TCPA consent disclosure for the first-party quote funnel.
//
// The quote form renders this text next to the consent checkbox, and the
// server snapshots the SAME constant into `leads.consent_disclosure_text`
// when it captures the lead — so the stored record provably matches what the
// consumer saw. Edit it here and only here; if the wording changes, previously
// captured leads keep the wording they were shown (the snapshot is per-lead).
export const QUOTE_TCPA_DISCLOSURE =
  "By checking this box I agree to be contacted by a licensed insurance agent at the phone number " +
  "provided, including via autodialer and prerecorded messages (TCPA consent). Consent is not a " +
  "condition of purchase.";
