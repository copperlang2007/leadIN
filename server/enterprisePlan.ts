/**
 * Enterprise plan configuration.
 *
 * The public enterprise offer is Stripe-backed. The platform owner can also
 * provision a designated internal organization as a non-billable reference
 * customer. This is an entitlement, not a Stripe-payment bypass for ordinary
 * customers.
 */

export const ENTERPRISE_PLAN = {
  id: "enterprise",
  name: "Enterprise",
  monthlyPriceCents: Number(process.env.ENTERPRISE_MONTHLY_PRICE_CENTS || 250000),
  stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || "",
  features: [
    "Unlimited agents",
    "Lead Recovery Engine",
    "Canonical lead intelligence",
    "Autonomous follow-up workflows",
    "Advanced analytics and ROI reporting",
    "Priority support",
    "Custom integrations",
    "Enterprise onboarding",
  ],
} as const;

export const INTERNAL_REFERENCE_ORG_SLUG = "lead-connect-pro";

export function isInternalReferenceOrganization(slug: string | null | undefined): boolean {
  return slug === INTERNAL_REFERENCE_ORG_SLUG;
}

export function getEnterpriseCheckoutPrice(): string | undefined {
  return ENTERPRISE_PLAN.stripePriceId || undefined;
}
