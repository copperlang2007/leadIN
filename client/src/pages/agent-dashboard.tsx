import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Briefcase, DollarSign, Target, TrendingUp, Users, Building2, Inbox } from "lucide-react";
import type { Lead } from "@/lib/types";

interface DashboardResponse {
  profile: {
    verificationStatus: string;
    licensedStates: string[];
    capacityLimit: number;
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

export default function AgentDashboard() {
  const { data, isLoading } = useQuery<DashboardResponse>({ queryKey: ["/api/agent/dashboard"] });

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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard icon={Inbox} label="Open pipeline" value={data.stats.openLeads.toString()} sub={`Cap: ${data.profile?.capacityLimit ?? "—"}`} />
          <StatCard icon={Target} label="Purchased leads" value={data.stats.purchasedLeads.toString()} />
          <StatCard icon={DollarSign} label="Total spend" value={`$${data.stats.totalSpent}`} sub={`Avg CPL $${data.stats.averageCpl}`} />
          <StatCard icon={TrendingUp} label="Est. commissions" value={`$${data.stats.estimatedCommissions}`} sub={`${data.stats.conversionRate}% conv.`} />
        </div>

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
              <p className="text-sm text-muted-foreground py-8 text-center">
                No assigned leads yet. New high-scoring leads will appear here automatically.
              </p>
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
