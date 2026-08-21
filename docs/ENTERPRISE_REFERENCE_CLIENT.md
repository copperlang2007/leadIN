# Lead Connect Pro Enterprise Reference Client

## Purpose

`copperlang2007/Lead-Connect-Pro` is the first internal reference customer for the Enterprise version of the Lead Recovery Engine.

The commercial product is Stripe-backed for paying customers. The internal reference tenant is intentionally provisioned as an active enterprise subscription **without a Stripe customer or subscription**, so the platform owner can use the product indefinitely without creating a recurring charge to the owner.

This is an explicit first-party entitlement, not a public coupon, discount code, or payment bypass.

## Commercial Enterprise Plan

Default list price: **$2,500/month** (`ENTERPRISE_MONTHLY_PRICE_CENTS=250000`).

Enterprise includes:

- Unlimited agents
- Lead Recovery Engine
- Canonical lead intelligence
- Autonomous follow-up workflows
- Advanced analytics and ROI reporting
- Priority support
- Custom integrations
- Enterprise onboarding

Stripe remains the billing system for external enterprise customers. The repository already contains the Stripe client and subscription/webhook infrastructure.

## Provision the Stripe Enterprise Product

From a machine with the repository checked out and `STRIPE_SECRET_KEY` configured:

```bash
ENTERPRISE_MONTHLY_PRICE_CENTS=250000 npx tsx scripts/setup-enterprise-stripe.ts
```

The script creates a Stripe product and recurring monthly price and prints:

```text
STRIPE_PRICE_ENTERPRISE=price_...
```

Store that value in the deployment environment. Never commit the Stripe secret key or generated environment file.

## Provision the First-Party Reference Client

1. Sign in to Lead Connect Pro once so the owner account exists in `users`.
2. Point `DATABASE_URL` at the production Neon database.
3. Set the owner email only in the local/deployment environment:

```bash
export ENTERPRISE_REFERENCE_OWNER_EMAIL="your-owner-email"
```

4. Run:

```bash
npx tsx scripts/provision-enterprise-reference-client.ts
```

The script creates or updates the unique `lead-connect-pro` organization with:

- `subscription_tier = enterprise`
- `subscription_status = active`
- owner membership
- active organization context for the owner
- no Stripe customer
- no Stripe subscription

The existing application billing gate treats an organization with an active subscription status as subscribed, so this internal tenant does not require a payment method.

## Important Boundary

Only the designated internal organization is provisioned this way. External customers must use the normal Stripe checkout and webhook lifecycle. Do not expose the provisioning script as an HTTP endpoint and do not accept an internal-org flag from client input.

## Product Positioning

The customer-facing offer is outcome-based:

> **Recover the money already sitting in your lead database.**

The first commercial product should demonstrate:

1. Lead inventory audit
2. Neglected/stale lead detection
3. High-value opportunity ranking
4. Recommended recovery actions
5. Automated follow-up
6. Attribution and recovered-revenue reporting

The internal reference tenant should be used to produce the evidence, workflows, screenshots, tests, and ROI story required before selling the enterprise tier broadly.
