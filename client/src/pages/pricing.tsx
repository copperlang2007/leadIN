import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, ShieldCheck, Zap } from "lucide-react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type SubscriptionTier = "starter" | "growth" | "scale";

interface OrgsResponse {
  activeOrgId: string | null;
  memberships: Array<{ orgId: string; role: string; org: unknown }>;
}

const TIERS = [
  {
    id: "per_lead" as const,
    name: "Pay per lead",
    price: "Wallet",
    cadence: "no monthly fee",
    bullets: [
      "Top up via Stripe in $10+ increments",
      "Pay only for leads you purchase",
      "Full MediScore + DNC compliance",
      "PII gated until purchase",
      "Multi-tenant org scoping",
    ],
    highlight: false,
  },
  {
    id: "starter" as const,
    name: "Starter",
    price: "$99",
    cadence: "/ month",
    bullets: [
      "Up to 3 agents",
      "Routing engine auto-assigns leads",
      "Agent accept / decline + re-route",
      "WebSocket lead-arrival notifications",
      "Full per-lead wallet still active",
    ],
    highlight: false,
  },
  {
    id: "growth" as const,
    name: "Growth",
    price: "$299",
    cadence: "/ month",
    bullets: [
      "Up to 15 agents",
      "Org-level reporting + analytics dashboard",
      "DNC nightly re-check",
      "MediScore signal breakdown per lead",
      "Vendor API key minting",
    ],
    highlight: true,
  },
  {
    id: "scale" as const,
    name: "Scale",
    price: "$799",
    cadence: "/ month",
    bullets: [
      "Unlimited agents",
      "Priority support",
      "Custom routing thresholds",
      "Dedicated success contact",
      "Everything in Growth",
    ],
    highlight: false,
  },
];

export default function Pricing() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const orgsQuery = useQuery<OrgsResponse>({
    queryKey: ["/api/orgs"],
    enabled: isAuthenticated,
  });

  const activeOrgId = orgsQuery.data?.activeOrgId ?? null;

  const subscribe = useMutation({
    mutationFn: async (tier: SubscriptionTier) => {
      if (!activeOrgId) throw new Error("No active organization");
      const res = await apiRequest(
        "POST",
        `/api/orgs/${activeOrgId}/subscription/checkout`,
        { tier },
      );
      return (await res.json()) as { url: string };
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({
          title: "Subscription error",
          description: "Stripe did not return a checkout URL.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({
        title: "Subscription error",
        description: e.message || "Failed to start checkout",
        variant: "destructive",
      });
    },
  });

  // Compute CTA per tier given the auth/org state.
  const renderTierCta = (tierId: "per_lead" | SubscriptionTier, highlight: boolean) => {
    const variant = highlight ? "default" : "outline";

    // Pay-per-lead tier always routes to the wallet page; never a subscription.
    if (tierId === "per_lead") {
      return (
        <Link href="/">
          <Button className="w-full" variant={variant} data-track-cta={`pricing-${tierId}`}>
            Add funds
          </Button>
        </Link>
      );
    }

    // While we don't yet know if the user is signed in, render a disabled placeholder
    // so the button doesn't flash through the wrong state.
    if (authLoading) {
      return (
        <Button className="w-full" variant={variant} disabled data-track-cta={`pricing-${tierId}`}>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </Button>
      );
    }

    // Not signed in → bounce to login, returning to /pricing afterwards.
    if (!isAuthenticated) {
      return (
        <Button
          className="w-full"
          variant={variant}
          data-track-cta={`pricing-${tierId}`}
          data-testid={`button-signin-${tierId}`}
          onClick={() => {
            window.location.href = "/api/login?returnTo=/pricing";
          }}
        >
          Sign in to subscribe
        </Button>
      );
    }

    // Signed in but no active org → push them through agent onboarding to create one.
    if (orgsQuery.isLoading) {
      return (
        <Button className="w-full" variant={variant} disabled data-track-cta={`pricing-${tierId}`}>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
        </Button>
      );
    }

    if (!activeOrgId) {
      return (
        <Link href="/agent/onboarding">
          <Button
            className="w-full"
            variant={variant}
            data-track-cta={`pricing-${tierId}`}
            data-testid={`button-create-org-${tierId}`}
          >
            Create an organization
          </Button>
        </Link>
      );
    }

    // Authenticated + active org → fire the Stripe checkout mutation.
    const isThisTierPending =
      subscribe.isPending && subscribe.variables === tierId;
    const isAnyTierPending = subscribe.isPending;

    return (
      <Button
        className="w-full"
        variant={variant}
        data-track-cta={`pricing-${tierId}`}
        data-testid={`button-subscribe-${tierId}`}
        disabled={isAnyTierPending}
        onClick={() => subscribe.mutate(tierId)}
      >
        {isThisTierPending ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting…</>
        ) : (
          <>Subscribe to {tierId.charAt(0).toUpperCase() + tierId.slice(1)}</>
        )}
      </Button>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-display font-bold text-xl flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> LeadMarket
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
            <Link href="/architect" className="text-muted-foreground hover:text-foreground">Platform</Link>
            <a href="/api/login" className="inline-flex h-9 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">
              Sign in
            </a>
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-display font-bold tracking-tight">Pricing</h1>
          <p className="text-lg text-muted-foreground mt-3">
            Start on the wallet. Subscribe when you need routing, multi-agent, or analytics.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
              <Zap className="h-3 w-3 mr-1" /> No setup fees
            </Badge>
            <Badge variant="outline">Cancel anytime</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {TIERS.map(tier => (
            <Card
              key={tier.id}
              className={tier.highlight ? "border-primary shadow-lg relative" : ""}
              data-track-tool={`pricing-card-${tier.id}`}
            >
              {tier.highlight && (
                <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  Most popular
                </Badge>
              )}
              <CardHeader className="pb-4">
                <CardTitle>{tier.name}</CardTitle>
                <CardDescription>
                  <span className="text-3xl font-bold text-foreground">{tier.price}</span>
                  <span className="text-sm ml-1">{tier.cadence}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-2">
                  {tier.bullets.map(b => (
                    <li key={b} className="text-sm flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {renderTierCta(tier.id, tier.highlight)}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-16 max-w-2xl mx-auto text-center space-y-3">
          <h2 className="text-2xl font-bold">Need something custom?</h2>
          <p className="text-muted-foreground">
            Vendor API integration, custom routing rules, or signal feeds for your stack?
            Email <a className="underline" href="mailto:sales@leadmarket.io">sales@leadmarket.io</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
