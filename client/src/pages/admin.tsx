import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useEffect } from "react";
import {
  ShieldCheck, TrendingUp, Package, Activity, Wifi, Users,
  Flag, Trash2, AlertTriangle, RefreshCw
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { EmptyState } from "@/components/empty-state";

interface PlatformStats {
  totalLeads: number;
  totalRevenue: string;
  soldLeads: number;
  availableLeads: number;
  activeWebSocketConnections: number;
  topVendors: { vendorId: number; name: string; leadCount: number }[];
}

export default function Admin() {
  useDocumentTitle("Admin");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user]);

  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>({
    queryKey: ["/api/admin/stats"],
    enabled: user?.role === "admin",
    refetchInterval: 15000,
  });

  const { data: leads = [], isLoading: leadsLoading, refetch: refetchLeads } = useQuery<(Lead & { vendor: { name: string } })[]>({
    queryKey: ["/api/admin/leads"],
    enabled: user?.role === "admin",
  });

  const flagMutation = useMutation({
    mutationFn: async ({ id, flagged }: { id: number; flagged: boolean }) => {
      const res = await fetch(`/api/admin/leads/${id}/flag`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagged }),
      });
      if (!res.ok) throw new Error("Failed to flag lead");
      return res.json();
    },
    onSuccess: (_, { flagged }) => {
      toast({
        title: flagged ? "Lead flagged" : "Flag removed",
        description: flagged ? "Lead has been flagged for review." : "Lead flag has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leads"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/leads/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove lead");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lead removed", description: "Lead has been removed from the marketplace." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

  const seedAdminMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/seed-admin", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Admin role assigned!" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  if (!user) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Skeleton className="h-16 w-64" />
        </div>
      </Layout>
    );
  }

  if (user.role !== "admin") {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto pt-20 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500" />
          <h1 className="text-2xl font-bold">Admin Access Required</h1>
          <p className="text-muted-foreground">You need admin role to access this page.</p>
          <Button
            onClick={() => seedAdminMutation.mutate()}
            disabled={seedAdminMutation.isPending}
            variant="outline"
          >
            {seedAdminMutation.isPending ? "Granting..." : "Grant Admin Role to My Account"}
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-primary" />
              Admin Panel
            </h1>
            <p className="text-muted-foreground mt-1">Platform management and operational metrics</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchLeads()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Stats Grid */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> Total Leads
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">{stats.totalLeads}</p>
                <p className="text-xs text-muted-foreground">{stats.soldLeads} sold · {stats.availableLeads} available</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">${parseFloat(stats.totalRevenue || "0").toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">All time</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" /> Sold / Available
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">{stats.soldLeads} / {stats.availableLeads}</p>
                <p className="text-xs text-muted-foreground">leads</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5" /> Active WS Connections
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">{stats.activeWebSocketConnections}</p>
                <p className="text-xs text-muted-foreground">live clients</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Top Vendors */}
        {stats?.topVendors && stats.topVendors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" /> Top Vendors by Lead Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.topVendors.map((vendor, i) => (
                  <div key={vendor.vendorId} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{vendor.name}</span>
                        <span className="text-xs text-muted-foreground">{vendor.leadCount} leads</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${(vendor.leadCount / (stats.topVendors[0]?.leadCount || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lead Management Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Lead Management</CardTitle>
          </CardHeader>
          <CardContent>
            {leadsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
              </div>
            ) : leads.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No leads in the platform yet"
                description="As vendors start ingesting leads via the API, they'll appear here for moderation, flagging, and removal. Hit refresh to re-query."
                compact
                action={{
                  label: "Refresh",
                  onClick: () => refetchLeads(),
                  variant: "outline",
                  testId: "admin-no-leads-refresh",
                }}
                data-testid="admin-no-leads"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">ID</th>
                      <th className="pb-2 font-medium text-muted-foreground">Type</th>
                      <th className="pb-2 font-medium text-muted-foreground">State</th>
                      <th className="pb-2 font-medium text-muted-foreground">Price</th>
                      <th className="pb-2 font-medium text-muted-foreground">Vendor</th>
                      <th className="pb-2 font-medium text-muted-foreground">Status</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {leads.slice(0, 50).map((lead) => (
                      <tr key={lead.id} className={`${lead.removed ? "opacity-50" : ""} ${lead.flagged ? "bg-amber-50 dark:bg-amber-950/10" : ""}`}
                        data-testid={`row-admin-lead-${lead.id}`}>
                        <td className="py-2 font-mono text-xs">#{lead.id}</td>
                        <td className="py-2">
                          <span className="text-xs font-medium">{lead.type}</span>
                        </td>
                        <td className="py-2 font-semibold">{lead.state}</td>
                        <td className="py-2 font-mono">${parseFloat(lead.price).toFixed(2)}</td>
                        <td className="py-2 text-xs text-muted-foreground">{lead.vendor?.name}</td>
                        <td className="py-2">
                          {lead.removed ? (
                            <Badge variant="outline" className="text-[10px] border-red-200 text-red-600">Removed</Badge>
                          ) : lead.flagged ? (
                            <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-600">Flagged</Badge>
                          ) : lead.sold ? (
                            <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-600">Sold</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Available</Badge>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!lead.removed && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => flagMutation.mutate({ id: lead.id, flagged: !lead.flagged })}
                                  disabled={flagMutation.isPending}
                                  title={lead.flagged ? "Remove flag" : "Flag lead"}
                                  data-testid={`button-flag-${lead.id}`}
                                >
                                  <Flag className={`h-3.5 w-3.5 ${lead.flagged ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => removeMutation.mutate(lead.id)}
                                  disabled={removeMutation.isPending}
                                  title="Remove lead"
                                  data-testid={`button-remove-${lead.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {leads.length > 50 && (
                  <p className="text-xs text-muted-foreground mt-3 text-center">Showing first 50 of {leads.length} leads</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
