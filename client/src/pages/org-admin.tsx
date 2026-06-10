import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Building2, ShieldCheck, Loader2, Key, Copy, Banknote, Trash2, AlertTriangle, Users, Store } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { PermissionRequired } from "@/components/permission-required";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

interface VendorApiKeyRow {
  id: number;
  vendorId: number;
  vendorName: string | null;
  keyPrefix: string;
  active: boolean;
  createdAt: string | null;
  revokedAt: string | null;
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
  // Wave 7 (T4): NIPR/DOI verification cache columns.
  niprVerifiedAt: string | null;
  niprLicenseExpiry: string | null;
  niprLastError: string | null;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null };
}

// Agents whose license expires within this many days are surfaced in the
// org-admin renewal banner. Keep in sync with RENEWAL_WINDOW_DAYS in
// server/niprSync.ts.
const RENEWAL_WINDOW_DAYS = 30;

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

  const { data: agents = [], isLoading, error: agentsError } = useQuery<OrgAgent[]>({
    queryKey: [`/api/orgs/${orgs?.activeOrgId}/agents`],
    enabled: !!orgs?.activeOrgId,
  });
  const agentsForbidden = agentsError?.message?.startsWith("403:");

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
    enabled: !!orgs?.activeOrgId,
  });

  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<VendorApiKeyRow | null>(null);

  const isPlatformAdmin = user?.role === "admin";

  const { data: vendorKeys = [], isLoading: keysLoading } = useQuery<VendorApiKeyRow[]>({
    queryKey: [`/api/orgs/${orgs?.activeOrgId}/vendor-keys`],
    enabled: !!orgs?.activeOrgId,
  });

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
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${orgs?.activeOrgId}/vendor-keys`] });
      toast({ title: "Key minted", description: `Prefix: ${data.keyPrefix}. Copy it now — it won't be shown again.` });
    },
    onError: (e: Error) => toast({ title: "Mint failed", description: e.message, variant: "destructive" }),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await fetch(`/api/orgs/${orgs!.activeOrgId}/vendor-keys/${keyId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Revoke failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${orgs?.activeOrgId}/vendor-keys`] });
      toast({ title: "API key revoked" });
      setKeyToRevoke(null);
    },
    onError: (e: Error) => {
      toast({ title: "Revoke failed", description: e.message, variant: "destructive" });
      setKeyToRevoke(null);
    },
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

  if (!canManage || agentsForbidden) {
    return (
      <PermissionRequired
        title="Owner or admin role required"
        description="Only organization owners or admins can manage agents, vendor keys, and payouts."
      />
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

        {/* Wave 7 (T4): license-expiry alerts. Surfaces every agent in the
            org whose NIPR-cached expiry is within RENEWAL_WINDOW_DAYS so
            owners/admins can chase the renewal before routing breaks. */}
        {(() => {
          const horizon = Date.now() + RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
          const expiring = agents.filter(a => {
            if (!a.niprLicenseExpiry) return false;
            const t = new Date(a.niprLicenseExpiry).getTime();
            return Number.isFinite(t) && t < horizon;
          });
          if (expiring.length === 0) return null;
          return (
            <div
              className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3"
              data-testid="banner-license-expiry"
            >
              <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                {expiring.length} agent{expiring.length === 1 ? "" : "s"} {expiring.length === 1 ? "has" : "have"} a license expiring within {RENEWAL_WINDOW_DAYS} days
              </div>
              <ul className="mt-2 text-sm text-amber-900 dark:text-amber-100 space-y-0.5">
                {expiring.map(a => {
                  const days = Math.max(
                    0,
                    Math.ceil(
                      (new Date(a.niprLicenseExpiry!).getTime() - Date.now()) /
                        (24 * 60 * 60 * 1000),
                    ),
                  );
                  return (
                    <li key={a.userId} data-testid={`row-expiry-${a.userId}`}>
                      {a.user.firstName} {a.user.lastName} ({a.user.email}) — expires in {days} day{days === 1 ? "" : "s"}
                      {" "}
                      <span className="text-xs opacity-75">
                        ({new Date(a.niprLicenseExpiry!).toISOString().slice(0, 10)})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

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
            ) : agentsError ? (
              <p className="text-sm text-destructive py-6 text-center">
                Couldn't load agents: {agentsError.message}
              </p>
            ) : agents.length === 0 ? (
              <div className="text-center py-10 px-6 border border-dashed rounded-xl bg-muted/20" data-testid="org-admin-no-agents">
                <div className="inline-flex h-12 w-12 rounded-full bg-background border items-center justify-center mb-3">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">No agents in this org yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Invite agents from the user list above, or share the org's signup link. As soon as they accept, their profile shows up here with conversion and capacity stats.
                </p>
              </div>
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

            <div className="pt-3 border-t">
              <h3 className="text-sm font-semibold mb-2">Active API keys</h3>
              {keysLoading ? (
                <Skeleton className="h-20" />
              ) : vendorKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-vendor-keys">
                  No vendor API keys yet.
                </p>
              ) : (
                <div className="space-y-1" data-testid="list-vendor-keys">
                  <div className="grid grid-cols-12 gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <div className="col-span-4">Vendor</div>
                    <div className="col-span-3">Prefix</div>
                    <div className="col-span-2">Created</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-1 text-right">Action</div>
                  </div>
                  {vendorKeys.map((k) => {
                    const isRevoked = !k.active;
                    return (
                      <div
                        key={k.id}
                        className="grid grid-cols-12 gap-2 items-center border rounded-md px-2 py-2 text-sm"
                        data-testid={`row-vendor-key-${k.id}`}
                      >
                        <div className="col-span-4 truncate">{k.vendorName ?? `Vendor #${k.vendorId}`}</div>
                        <div className="col-span-3 font-mono text-xs truncate">{k.keyPrefix}</div>
                        <div className="col-span-2 text-xs text-muted-foreground">
                          {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}
                        </div>
                        <div className="col-span-2">
                          <Badge
                            variant={isRevoked ? "outline" : "default"}
                            className={isRevoked ? "" : "bg-emerald-600"}
                          >
                            {isRevoked ? "Revoked" : "Active"}
                          </Badge>
                        </div>
                        <div className="col-span-1 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setKeyToRevoke(k)}
                            disabled={isRevoked || revokeKeyMutation.isPending}
                            data-testid={`button-revoke-${k.id}`}
                            aria-label="Revoke key"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={!!keyToRevoke} onOpenChange={(open) => { if (!open) setKeyToRevoke(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately disable the key with prefix{" "}
                <code className="font-mono">{keyToRevoke?.keyPrefix}</code>
                {keyToRevoke?.vendorName ? <> for {keyToRevoke.vendorName}</> : null}.
                Any vendor request using it will be rejected. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revokeKeyMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (keyToRevoke) revokeKeyMutation.mutate(keyToRevoke.id);
                }}
                disabled={revokeKeyMutation.isPending}
                data-testid="button-confirm-revoke"
              >
                {revokeKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
                <div className="text-center py-10 px-6 border border-dashed rounded-xl bg-muted/20" data-testid="org-admin-no-vendors">
                  <div className="inline-flex h-12 w-12 rounded-full bg-background border items-center justify-center mb-3">
                    <Store className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">No vendor payouts yet</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Vendor balances will appear here as soon as your first lead sale settles. Pending and paid totals refresh nightly.
                  </p>
                </div>
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
