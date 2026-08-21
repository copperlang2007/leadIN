/** Enterprise commercial plan + first-party reference entitlement. */

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

/** This is the designated internal reference tenant; it is not a public coupon. */
export const INTERNAL_REFERENCE_ORG_SLUG = "lead-connect-pro";

export function isInternalReferenceOrganization(slug: string | null | undefined): boolean {
  return slug === INTERNAL_REFERENCE_ORG_SLUG;
}

export function getEnterpriseStripePriceId(): string | undefined {
  return ENTERPRISE_PLAN.stripePriceId || undefined;
}
