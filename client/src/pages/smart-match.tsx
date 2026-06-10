import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Trash2, Loader2, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";

interface SmartMatchSubscription {
  id: number;
  agentUserId: string;
  monthlyLeadQuota: number;
  monthlyPriceCents: number;
  filterCriteria: {
    types?: string[];
    states?: string[];
    minMediscore?: number;
    maxPriceCents?: number;
  };
  status: string;
  cyclesDelivered: number;
  leadsDeliveredThisCycle: number;
  cycleStartedAt: string | null;
  createdAt: string | null;
}

interface SmartMatchTier {
  quota: number;
  priceCents: number;
}

// Comma-separated user input → trimmed, deduplicated array. Empty input
// becomes `undefined` so the criterion is omitted (matches anything).
function parseList(input: string): string[] | undefined {
  const parts = input
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length === 0 ? undefined : Array.from(new Set(parts));
}

export default function SmartMatchPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedQuota, setSelectedQuota] = useState<number>(25);
  const [types, setTypes] = useState("");
  const [states, setStates] = useState("");
  const [minMediscore, setMinMediscore] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const { data: tiersData } = useQuery<{ tiers: SmartMatchTier[] }>({
    queryKey: ["/api/smart-match/tiers"],
  });
  const tiers = tiersData?.tiers ?? [
    { quota: 25, priceCents: 9900 },
    { quota: 50, priceCents: 17900 },
    { quota: 100, priceCents: 32900 },
  ];

  const { data: subs = [], isLoading } = useQuery<SmartMatchSubscription[]>({
    queryKey: ["/api/smart-match"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const filterCriteria: Record<string, unknown> = {};
      const typesParsed = parseList(types);
      const statesParsed = parseList(states);
      if (typesParsed) filterCriteria.types = typesParsed;
      if (statesParsed) filterCriteria.states = statesParsed.map(s => s.toUpperCase());
      const minRaw = parseInt(minMediscore, 10);
      if (Number.isFinite(minRaw)) filterCriteria.minMediscore = minRaw;
      const maxRaw = parseFloat(maxPrice);
      if (Number.isFinite(maxRaw) && maxRaw > 0) filterCriteria.maxPriceCents = Math.round(maxRaw * 100);

      const res = await fetch("/api/smart-match", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyLeadQuota: selectedQuota,
          filterCriteria,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      setTypes("");
      setStates("");
      setMinMediscore("");
      setMaxPrice("");
      queryClient.invalidateQueries({ queryKey: ["/api/smart-match"] });
      toast({ title: "Smart-match subscription created", description: "Matching leads will auto-deliver." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/smart-match/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/smart-match"] });
      toast({ title: "Subscription cancelled" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" /> Smart-Match Subscriptions
          </h1>
          <p className="text-muted-foreground mt-1">
            Flat-rate monthly plan: tell us what kind of leads you want, and we'll auto-deliver matches the moment they hit the marketplace.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick a tier</CardTitle>
            <CardDescription>Quota resets every 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {tiers.map(tier => {
                const active = selectedQuota === tier.quota;
                return (
                  <button
                    key={tier.quota}
                    type="button"
                    onClick={() => setSelectedQuota(tier.quota)}
                    className={`text-left rounded-lg border p-4 transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                    data-testid={`button-tier-${tier.quota}`}
                  >
                    <div className="text-2xl font-bold">{tier.quota}<span className="text-sm font-normal text-muted-foreground"> leads/mo</span></div>
                    <div className="text-sm text-muted-foreground mt-1">
                      ${(tier.priceCents / 100).toFixed(0)}/mo · ${(tier.priceCents / 100 / tier.quota).toFixed(2)}/lead
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead filter</CardTitle>
            <CardDescription>Leave a field blank to match anything.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sm-types">Lead types (comma-separated)</Label>
                <Input
                  id="sm-types"
                  placeholder="medicare, aca, auto"
                  value={types}
                  onChange={e => setTypes(e.target.value)}
                  data-testid="input-types"
                />
              </div>
              <div>
                <Label htmlFor="sm-states">States (comma-separated, two-letter)</Label>
                <Input
                  id="sm-states"
                  placeholder="FL, TX, CA"
                  value={states}
                  onChange={e => setStates(e.target.value)}
                  data-testid="input-states"
                />
              </div>
              <div>
                <Label htmlFor="sm-min-mediscore">Minimum MediScore</Label>
                <Input
                  id="sm-min-mediscore"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="60"
                  value={minMediscore}
                  onChange={e => setMinMediscore(e.target.value)}
                  data-testid="input-min-mediscore"
                />
              </div>
              <div>
                <Label htmlFor="sm-max-price">Max price per lead ($)</Label>
                <Input
                  id="sm-max-price"
                  type="number"
                  min="0"
                  step="0.50"
                  placeholder="30"
                  value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)}
                  data-testid="input-max-price"
                />
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="button-subscribe"
            >
              {createMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
              ) : (
                <>Subscribe — ${(tiers.find(t => t.quota === selectedQuota)?.priceCents ?? 0) / 100}/mo</>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your active subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              // Skeleton stack matches subscription card height — three
              // rows so the visual weight stays consistent during refetch.
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : subs.length === 0 ? (
              <EmptyState
                icon={Zap}
                title="No active subscriptions yet"
                description="Set up a smart-match subscription above and we'll auto-route matching leads straight to you — no marketplace scrolling required."
                compact
                data-testid="smart-match-empty"
              />
            ) : (
              <div className="space-y-3">
                {subs.map(s => {
                  const remaining = Math.max(0, s.monthlyLeadQuota - s.leadsDeliveredThisCycle);
                  const f = s.filterCriteria ?? {};
                  return (
                    <div
                      key={s.id}
                      className="border rounded-lg p-4 flex items-start justify-between gap-4"
                      data-testid={`row-subscription-${s.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{s.monthlyLeadQuota} leads/mo</span>
                          <Badge variant="secondary">${(s.monthlyPriceCents / 100).toFixed(0)}/mo</Badge>
                          <Badge>{s.leadsDeliveredThisCycle} delivered · {remaining} left</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          {f.types?.length ? <span>Types: {f.types.join(", ")}</span> : null}
                          {f.states?.length ? <span>States: {f.states.join(", ")}</span> : null}
                          {typeof f.minMediscore === "number" ? <span>MediScore ≥ {f.minMediscore}</span> : null}
                          {typeof f.maxPriceCents === "number" ? <span>Max ${(f.maxPriceCents / 100).toFixed(2)}/lead</span> : null}
                          {!f.types?.length && !f.states?.length && typeof f.minMediscore !== "number" && typeof f.maxPriceCents !== "number" ? (
                            <span>No filter — anything goes</span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelMutation.mutate(s.id)}
                        disabled={cancelMutation.isPending}
                        data-testid={`button-cancel-${s.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
