import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Building2, ShieldCheck, ShieldX, Loader2, Key, Copy, Banknote } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

interface OrgList {
  activeOrgId: string | null;
  memberships: { orgId: string; role: string; org: { id: string; name: string; slug: string; subscriptionStatus: string; billingMode: string } }[];
}

interface Vendor {
  id: number;
  name: string;
  rating: string;
  verified: boolean;
}

interface VendorBalanceRow {
  vendor: { id: number; name: string; verified: boolean };
  pendingCents: number;
  paidCents: number;
}

interface OrgAgent {
  userId: string;
  orgId: string;
  licensedStates: string[];
  appointedCarriers: string[];
  capacityLimit: number;
  verificationStatus: string;
  acceptingLeads: boolean;
  conversionRate: string;
  licenseNumber: string | null;
  licenseDocumentUrl: string | null;
  openLeads: number;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null };
}

function formatCents(cents: number): string {
  const dollars = (cents || 0) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function OrgAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: orgs } = useQuery<OrgList>({ queryKey: ["/api/orgs"] });
  const activeMembership = orgs?.memberships.find(m => m.orgId === orgs.activeOrgId);
  const canManage = activeMembership && (activeMembership.role === "owner" || activeMembership.role === "admin");

  const { data: agents = [], isLoading } = useQuery<OrgAgent[]>({
    queryKey: [`/api/orgs/${orgs?.activeOrgId}/agents`],
    enabled: !!orgs?.activeOrgId,
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
    enabled: !!orgs?.activeOrgId,
  });

  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  const isPlatformAdmin = user?.role === "admin";

  const { data: vendorBalances = [], isLoading: balancesLoading } = useQuery<VendorBalanceRow[]>({
    queryKey: ["/api/admin/vendor-balances"],
    enabled: isPlatformAdmin,
  });

  const sweepMutation = useMutation({
    mutationFn: async (thresholdCents: number) => {
      const res = await fetch("/api/admin/vendor-payouts/sweep", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdCents }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Sweep failed");
      return res.json() as Promise<{ vendorsPaid: number; totalCentsSwept: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-balances"] });
      toast({
        title: "Sweep complete",
        description: `Paid out ${data.vendorsPaid} vendor${data.vendorsPaid === 1 ? "" : "s"} (${formatCents(data.totalCentsSwept)}).`,
      });
    },
    onError: (e: Error) => toast({ title: "Sweep failed", description: e.message, variant: "destructive" }),
  });

  const mintKeyMutation = useMutation({
    mutationFn: async () => {
      const vendorId = parseInt(selectedVendor, 10);
      if (!Number.isFinite(vendorId)) throw new Error("Select a vendor");
      const res = await fetch(`/api/orgs/${orgs!.activeOrgId}/vendor-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Mint failed");
      return res.json() as Promise<{ apiKey: string; keyPrefix: string }>;
    },
    onSuccess: (data) => {
      setMintedKey(data.apiKey);
      toast({ title: "Key minted", description: `Prefix: ${data.keyPrefix}. Copy it now — it won't be shown again.` });
    },
    onError: (e: Error) => toast({ title: "Mint failed", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "verified" | "rejected" | "pending" }) => {
      const res = await fetch(`/api/agent/${userId}/verification`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${orgs?.activeOrgId}/agents`] });
      toast({ title: "Agent updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const convRateMutation = useMutation({
    mutationFn: async ({ userId, rate }: { userId: string; rate: number }) => {
      const res = await fetch(`/api/agent/${userId}/conversion-rate`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${orgs?.activeOrgId}/agents`] });
      toast({ title: "Conversion rate updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (!user) {
    return <Layout><div /></Layout>;
  }

  if (!orgs?.activeOrgId) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto py-12 text-center">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-bold mt-3">No active organization</h1>
          <p className="text-muted-foreground">Create or activate an org from the agent onboarding page first.</p>
        </div>
      </Layout>
    );
  }

  if (!canManage) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto py-12 text-center">
          <ShieldX className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-bold mt-3">Owner or admin role required</h1>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-7 w-7 text-primary" /> {activeMembership.org.name}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant="outline">{activeMembership.role}</Badge>
            <Badge variant="outline">billing: {activeMembership.org.billingMode}</Badge>
            <Badge
              className={
                activeMembership.org.subscriptionStatus === "active" ? "bg-emerald-600" :
                activeMembership.org.subscriptionStatus === "cancelled" ? "bg-destructive text-destructive-foreground" : ""
              }
              variant={activeMembership.org.subscriptionStatus === "active" ? "default" : "outline"}
            >
              {activeMembership.org.subscriptionStatus}
            </Badge>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>
              Verify license documents and toggle agent status. Only verified, accepting agents are eligible for routing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32" />
            ) : agents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No agents in this organization yet.</p>
            ) : (
              <div className="space-y-2">
                {agents.map(a => {
                  const convPct = Math.round(parseFloat(a.conversionRate ?? "0") * 100);
                  return (
                  <div key={a.userId} className="border rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {a.user.firstName} {a.user.lastName} · {a.user.email}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.licensedStates.length} states · {a.appointedCarriers.length} carriers · capacity {a.openLeads}/{a.capacityLimit} · conv {convPct}% · {a.licenseNumber || "no license #"}
                      </div>
                      {a.licenseDocumentUrl && (
                        <a href={a.licenseDocumentUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-primary underline">
                          View document
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">Conv%</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={convPct}
                          onBlur={(e) => {
                            const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                            if (pct !== convPct) convRateMutation.mutate({ userId: a.userId, rate: pct / 100 });
                          }}
                          className="w-14 h-7 rounded border bg-background px-1 text-right"
                        />
                      </div>
                      <Badge
                        variant={a.verificationStatus === "verified" ? "default" : "outline"}
                        className={
                          a.verificationStatus === "verified" ? "bg-emerald-600" :
                          a.verificationStatus === "rejected" ? "bg-destructive text-destructive-foreground" : ""
                        }
                      >
                        {a.verificationStatus}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => verifyMutation.mutate({ userId: a.userId, status: "verified" })}
                        disabled={verifyMutation.isPending || a.verificationStatus === "verified"}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => verifyMutation.mutate({ userId: a.userId, status: "rejected" })}
                        disabled={verifyMutation.isPending || a.verificationStatus === "rejected"}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            {verifyMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Updating...
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Vendor API keys</CardTitle>
            <CardDescription>
              Mint a key for a vendor partner. Leads ingested with this key are scoped to this organization and routed by the engine.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 items-center">
              <select
                value={selectedVendor}
                onChange={e => setSelectedVendor(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm flex-1"
                data-testid="select-vendor"
              >
                <option value="">Select vendor…</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}{v.verified ? " ✓" : ""}</option>
                ))}
              </select>
              <Button
                onClick={() => mintKeyMutation.mutate()}
                disabled={mintKeyMutation.isPending || !selectedVendor}
              >
                {mintKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
                Mint key
              </Button>
            </div>
            {mintedKey && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 space-y-2">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Copy this key now — it won't be shown again.
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 font-mono text-xs bg-background border rounded px-2 py-1.5 break-all">{mintedKey}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(mintedKey); toast({ title: "Copied to clipboard" }); }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Vendors send leads via <code>POST /api/v1/leads/ingest</code> with the <code>X-Api-Key</code> header.
            </p>
          </CardContent>
        </Card>

        {isPlatformAdmin && (
          <Card data-testid="card-vendor-payouts">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" /> Vendor payouts
              </CardTitle>
              <CardDescription>
                Pending revenue share owed to each vendor. The Sweep button marks balances at or above $50 as paid
                (real Stripe Connect transfers will land here later).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => sweepMutation.mutate(5000)}
                  disabled={sweepMutation.isPending}
                  data-testid="button-sweep-vendor-payouts"
                >
                  {sweepMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Banknote className="h-4 w-4 mr-2" />
                  )}
                  Sweep ≥ $50
                </Button>
              </div>
              {balancesLoading ? (
                <Skeleton className="h-32" />
              ) : vendorBalances.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No vendors yet.</p>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <div className="col-span-6">Vendor</div>
                    <div className="col-span-3 text-right">Pending</div>
                    <div className="col-span-3 text-right">Paid</div>
                  </div>
                  {vendorBalances.map((row) => (
                    <div
                      key={row.vendor.id}
                      className="grid grid-cols-12 gap-2 items-center border rounded-md px-2 py-2 text-sm"
                      data-testid={`row-vendor-balance-${row.vendor.id}`}
                    >
                      <div className="col-span-6 truncate">
                        {row.vendor.name}
                        {row.vendor.verified && <span className="ml-1 text-emerald-600">✓</span>}
                      </div>
                      <div className="col-span-3 text-right font-mono" data-testid={`text-pending-${row.vendor.id}`}>
                        {formatCents(row.pendingCents)}
                      </div>
                      <div className="col-span-3 text-right font-mono text-muted-foreground">
                        {formatCents(row.paidCents)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
