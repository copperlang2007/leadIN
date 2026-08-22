// One-shot provisioning for the three subscription tiers and (optionally) the
// Stripe webhook endpoint, so a fresh deploy can be configured without
// clicking through the Stripe dashboard.
//
//   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-plan-prices.ts
//
// Pass a webhook URL to also create the endpoint and print its signing secret:
//
//   STRIPE_SECRET_KEY=sk_test_... \
//   WEBHOOK_URL=https://your-host/api/stripe/webhook \
//     npx tsx scripts/setup-plan-prices.ts
//
// The script prints the env lines to paste into the host's config. It is safe
// to re-run: products, prices and the endpoint are looked up by metadata /
// URL first and reused rather than duplicated.
//
// Note: no `import "dotenv/config"` here on purpose — dotenv is not a
// dependency of this repo, so importing it fails at startup. Pass the key
// inline as shown above, or export it in your shell.

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error(
    "STRIPE_SECRET_KEY is required.\n" +
      "Find it at https://dashboard.stripe.com/apikeys (use the test-mode key while setting up).",
  );
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: "2026-02-25.clover" });

// Amounts mirror SUBSCRIPTION_TIERS in server/routes.ts. Keep them in sync —
// the server falls back to inline price_data at these amounts when a price id
// is not configured, so a mismatch here would silently change what a
// configured tier charges relative to the fallback.
const TIERS = [
  { key: "starter", envVar: "STRIPE_PRICE_STARTER", name: "Starter (up to 3 agents)", monthlyCents: 9900 },
  { key: "growth", envVar: "STRIPE_PRICE_GROWTH", name: "Growth (up to 15 agents)", monthlyCents: 29900 },
  { key: "scale", envVar: "STRIPE_PRICE_SCALE", name: "Scale (unlimited agents)", monthlyCents: 79900 },
] as const;

// The events server/routes.ts actually handles at POST /api/stripe/webhook.
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const APP = "lead-connect-pro";

// Stripe has no "get product by metadata" lookup, so search the recent list.
// A fresh account has far fewer than 100 products; this is only a convenience
// so re-running doesn't mint duplicates.
async function findProduct(plan: string): Promise<Stripe.Product | null> {
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (product.active && product.metadata?.app === APP && product.metadata?.plan === plan) {
      return product;
    }
  }
  return null;
}

async function findPrice(productId: string, monthlyCents: number): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({ product: productId, limit: 100 })) {
    if (
      price.active &&
      price.currency === "usd" &&
      price.unit_amount === monthlyCents &&
      price.recurring?.interval === "month"
    ) {
      return price;
    }
  }
  return null;
}

async function provisionTier(tier: (typeof TIERS)[number]): Promise<string> {
  const existingProduct = await findProduct(tier.key);
  const product =
    existingProduct ??
    (await stripe.products.create({
      name: `LeadMarket ${tier.name}`,
      metadata: { app: APP, plan: tier.key },
    }));

  const existingPrice = await findPrice(product.id, tier.monthlyCents);
  const price =
    existingPrice ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: tier.monthlyCents,
      recurring: { interval: "month" },
      metadata: { app: APP, plan: tier.key },
    }));

  const dollars = (tier.monthlyCents / 100).toFixed(2);
  const reused = existingPrice ? " (reused)" : "";
  console.error(`  ${tier.key.padEnd(8)} $${dollars}/mo  ${price.id}${reused}`);
  return price.id;
}

async function provisionWebhook(url: string): Promise<string | null> {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === url && endpoint.status === "enabled") {
      console.error(`  endpoint already exists: ${endpoint.id}`);
      // Stripe returns the signing secret only when the endpoint is created,
      // so an existing endpoint's secret has to come from the dashboard.
      return null;
    }
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    metadata: { app: APP },
  });
  console.error(`  created endpoint ${endpoint.id} for ${url}`);
  return endpoint.secret ?? null;
}

async function main(): Promise<void> {
  const mode = secret!.startsWith("sk_live_") ? "LIVE" : "test";
  console.error(`Stripe mode: ${mode}\n\nSubscription tiers:`);

  const envLines: string[] = [];
  for (const tier of TIERS) {
    envLines.push(`${tier.envVar}=${await provisionTier(tier)}`);
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    console.error("\nWebhook endpoint:");
    const signingSecret = await provisionWebhook(webhookUrl);
    if (signingSecret) {
      envLines.push(`STRIPE_WEBHOOK_SECRET=${signingSecret}`);
    } else {
      console.error(
        "  signing secret not shown for an existing endpoint — copy it from\n" +
          "  https://dashboard.stripe.com/webhooks (click the endpoint, reveal the signing secret)",
      );
    }
  } else {
    console.error("\nWEBHOOK_URL not set — skipping webhook endpoint creation.");
  }

  // Diagnostics go to stderr, the env lines to stdout, so this can be piped
  // straight into a file or a `railway variables` invocation.
  console.log(envLines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
