import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set. Please connect Stripe integration.");
  }
  return new Stripe(secretKey, { apiVersion: "2026-02-25.clover" });
}
