import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Link, useLocation } from "wouter";
import { Briefcase, DollarSign, Target, TrendingUp, Users, Building2, Inbox, Settings as SettingsIcon, Award, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@/lib/types";

interface DashboardResponse {
  profile: {
    verificationStatus: string;
    licensedStates: string[];
    capacityLimit: number;
    acceptingLeads: boolean;
  } | null;
  stats: {
    openLeads: number;
    purchasedLeads: number;
    totalSpent: string;
    averageCpl: string;
    estimatedCommissions: string;
    conversionRate: string;
  };
  assignedLeads: Lead[];
  orgStats: {
    totalLeads: number;
    assignedLeads: number;
    soldLeads: number;
    totalSpent: string;
    activeAgents: number;
  } | null;
}

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-bold mt-2">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AgentSettingsCard({
  capacityLimit,
  acceptingLeads,
  openLeads,
}: {
  capacityLimit: number;
  acceptingLeads: boolean;
  openLeads: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [capacityDraft, setCapacityDraft] = useState<string>(String(capacityLimit));

  // Keep local draft in sync if the server value changes (e.g. after refetch).
  useEffect(() => {
    setCapacityDraft(String(capacityLimit));
  }, [capacityLimit]);

  const mutation = useMutation({
    mutationFn: async (patch: { capacityLimit?: number; acceptingLeads?: boolean }) => {
      const res = await apiRequest("PATCH", "/api/agent/me", patch);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/dashboard"] });
      toast({
        title: "Settings updated",
        description:
          variables.acceptingLeads !== undefined
            ? `You are ${variables.acceptingLeads ? "now accepting" : "paused on"} new leads.`
            : `Capacity set to ${variables.capacityLimit}.`,
      });
    },
    onError: (err: Error) => {
      // Revert capacity draft on failure so the input matches reality.
      setCapacityDraft(String(capacityLimit));
      toast({
        title: "Update failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const commitCapacity = () => {
    const parsed = Number(capacityDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      toast({
        title: "Invalid capacity",
        description: "Capacity must be a whole number between 1 and 500.",
        variant: "destructive",
      });
      setCapacityDraft(String(capacityLimit));
      return;
    }
    if (parsed === capacityLimit) return;
    mutation.mutate({ capacityLimit: parsed });
  };

  return (
    <Card data-testid="agent-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" /> Agent settings
        </CardTitle>
        <CardDescription>
          Adjust your capacity and pause new leads without re-running onboarding.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-1.5">
          <Label htmlFor="agent-capacity">Capacity limit</Label>
          <Input
            id="agent-capacity"
            type="number"
            min={1}
            max={500}
            step={1}
            value={capacityDraft}
            disabled={mutation.isPending}
            onChange={(e) => setCapacityDraft(e.target.value)}
            onBlur={commitCapacity}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            data-testid="input-capacity-limit"
          />
          <p className="text-xs text-muted-foreground">
            {openLeads} of {capacityLimit} slots used
          </p>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="agent-accepting">Accepting new leads</Label>
            <p className="text-xs text-muted-foreground">
              Turn off to temporarily stop the routing engine from assigning you new leads.
            </p>
          </div>
          <Switch
            id="agent-accepting"
            checked={acceptingLeads}
            disabled={mutation.isPending}
            onCheckedChange={(checked) => mutation.mutate({ acceptingLeads: checked })}
            data-testid="switch-accepting-leads"
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface ReputationResponse {
  score: number;
  windowDays: number;
  events: Array<{ id: number; eventType: string; weight: number; createdAt: string | null }>;
}

export default function AgentDashboard() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<DashboardResponse>({ queryKey: ["/api/agent/dashboard"] });
  // Reputation is loaded as a side-fetch so a slow aggregate doesn't block the
  // main dashboard render. If it fails or hasn't loaded yet we show "—".
  const { data: reputation } = useQuery<ReputationResponse>({ queryKey: ["/api/agent/me/reputation"] });

  if (isLoading || !data) {
    return (
      <Layout>
        <div className="space-y-4 max-w-6xl mx-auto">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      </Layout>
    );
  }

  const needsOnboarding = !data.profile;

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Briefcase className="h-7 w-7 text-primary" /> Agent Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              Your pipeline, spend, and projected commissions in one place.
            </p>
          </div>
          {data.profile && (
            <Badge
              className={
                data.profile.verificationStatus === "verified" ? "bg-emerald-600" :
                data.profile.verificationStatus === "rejected" ? "bg-destructive text-destructive-foreground" : ""
              }
              variant={data.profile.verificationStatus === "verified" ? "default" : "outline"}
            >
              {data.profile.verificationStatus}
            </Badge>
          )}
        </div>

        {needsOnboarding && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Complete agent onboarding</CardTitle>
              <CardDescription>
                Set your licenses, carriers and territory so the routing engine can auto-assign leads.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/agent/onboarding">
                <a className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">
                  Start onboarding →
                </a>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard icon={Inbox} label="Open pipeline" value={data.stats.openLeads.toString()} sub={`Cap: ${data.profile?.capacityLimit ?? "—"}`} />
          <StatCard icon={Target} label="Purchased leads" value={data.stats.purchasedLeads.toString()} />
          <StatCard icon={DollarSign} label="Total spend" value={`$${data.stats.totalSpent}`} sub={`Avg CPL $${data.stats.averageCpl}`} />
          <StatCard icon={TrendingUp} label="Est. commissions" value={`$${data.stats.estimatedCommissions}`} sub={`${data.stats.conversionRate}% conv.`} />
          <StatCard
            icon={Award}
            label="Reputation"
            value={reputation ? reputation.score.toString() : "—"}
            sub={reputation ? `${reputation.events.length} events / ${reputation.windowDays}d` : "Trailing 90d"}
          />
        </div>

        {data.profile && (
          <AgentSettingsCard
            capacityLimit={data.profile.capacityLimit}
            acceptingLeads={data.profile.acceptingLeads}
            openLeads={data.stats.openLeads}
          />
        )}

        {data.orgStats && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Organization metrics</CardTitle>
              <CardDescription>Aggregate view for admins/owners across the whole org.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div><div className="text-xs text-muted-foreground">Total leads</div><div className="text-xl font-bold">{data.orgStats.totalLeads}</div></div>
              <div><div className="text-xs text-muted-foreground">Assigned</div><div className="text-xl font-bold">{data.orgStats.assignedLeads}</div></div>
              <div><div className="text-xs text-muted-foreground">Sold</div><div className="text-xl font-bold">{data.orgStats.soldLeads}</div></div>
              <div><div className="text-xs text-muted-foreground">Org spend</div><div className="text-xl font-bold">${data.orgStats.totalSpent}</div></div>
              <div className="flex items-center gap-1.5"><Users className="h-4 w-4 text-muted-foreground" /><div><div className="text-xs text-muted-foreground">Active agents</div><div className="text-xl font-bold">{data.orgStats.activeAgents}</div></div></div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Assigned leads</CardTitle>
            <CardDescription>
              Routing engine matches. Contact info is revealed because these leads are reserved for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.assignedLeads.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No assigned leads yet"
                description="Routing assigns high-scoring leads automatically based on your license, territory, and conversion history. New ones will appear here in real time."
                action={{
                  label: "Browse the marketplace",
                  onClick: () => navigate("/marketplace"),
                  variant: "outline",
                  testId: "dashboard-browse-marketplace",
                  trackCta: "dashboard-empty-browse",
                }}
                compact
                data-testid="dashboard-no-assigned-leads"
              />
            ) : (
              <div className="space-y-2">
                {data.assignedLeads.map(lead => (
                  <div key={lead.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {lead.consumerName || `Lead #${lead.id}`} · {lead.type}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {lead.state} {lead.zipCode} · {lead.consumerPhone || "—"} · {lead.consumerEmail || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">Score {lead.compatibilityScore}</Badge>
                      <span className="text-sm font-mono">${parseFloat(lead.price).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
