import "dotenv/config";
import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) throw new Error("STRIPE_SECRET_KEY is required");

const stripe = new Stripe(secret, { apiVersion: "2026-02-25.clover" });
const monthlyPriceCents = Number(process.env.ENTERPRISE_MONTHLY_PRICE_CENTS || 250000);

async function main() {
  const product = await stripe.products.create({
    name: "Lead Connect Pro Enterprise",
    description: "Enterprise Lead Recovery Engine, autonomous sales operations, analytics and integrations.",
    metadata: { app: "lead-connect-pro", plan: "enterprise" },
  });

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: monthlyPriceCents,
    recurring: { interval: "month" },
    metadata: { app: "lead-connect-pro", plan: "enterprise" },
  });

  console.log(JSON.stringify({
    productId: product.id,
    priceId: price.id,
    monthlyPriceCents,
    envLine: `STRIPE_PRICE_ENTERPRISE=${price.id}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
