import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ShieldCheck, Loader2, FileWarning } from "lucide-react";

interface OrgList {
  activeOrgId: string | null;
  memberships: { orgId: string; role: string; org: { id: string; name: string } }[];
}

interface TcpaPolicy {
  id: number;
  orgId: string;
  carrierName: string | null;
  perClaimLimitCents: number;
  aggregateLimitCents: number;
  startedAt: string | null;
  endsAt: string | null;
  status: string;
}

interface TcpaClaim {
  id: number;
  policyId: number;
  orderId: number | null;
  agentUserId: string | null;
  claimReason: string | null;
  amountClaimedCents: number;
  amountPaidCents: number | null;
  status: string;
  filedAt: string | null;
  resolvedAt: string | null;
}

function formatCents(cents: number | null | undefined): string {
  const dollars = ((cents ?? 0) || 0) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusBadge(status: string) {
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "approved" ? "default" :
    status === "denied" ? "destructive" :
    status === "open" ? "secondary" : "outline";
  return <Badge variant={variant} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

export default function TcpaPage() {
  useDocumentTitle("TCPA Defense");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery<OrgList>({ queryKey: ["/api/orgs"] });
  const activeOrgId = orgs?.activeOrgId ?? null;
  const activeMembership = orgs?.memberships.find(m => m.orgId === activeOrgId);
  const canManage = activeMembership && (activeMembership.role === "owner" || activeMembership.role === "admin");

  const { data: policy, isLoading: policyLoading } = useQuery<TcpaPolicy | null>({
    queryKey: [`/api/orgs/${activeOrgId}/tcpa-policy`],
    enabled: !!activeOrgId,
  });

  const { data: claims = [], isLoading: claimsLoading } = useQuery<TcpaClaim[]>({
    queryKey: [`/api/orgs/${activeOrgId}/tcpa-claims`],
    enabled: !!activeOrgId,
  });

  const [carrierName, setCarrierName] = useState("");
  const [reason, setReason] = useState("");
  const [amountUsd, setAmountUsd] = useState("");

  const createPolicyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orgs/${activeOrgId}/tcpa-policy`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrierName: carrierName.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to create policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${activeOrgId}/tcpa-policy`] });
      toast({ title: "Policy activated", description: "Default limits: $25k per claim, $100k aggregate." });
      setCarrierName("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const fileClaimMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(amountUsd);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive amount");
      const amountClaimedCents = Math.round(amount * 100);
      const res = await fetch(`/api/orgs/${activeOrgId}/tcpa-claims`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimReason: reason, amountClaimedCents }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to file claim");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${activeOrgId}/tcpa-claims`] });
      toast({ title: "Claim filed", description: "Status: open. An admin will review." });
      setReason("");
      setAmountUsd("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (!activeOrgId) {
    return (
      <Layout>
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>TCPA Defense Insurance</CardTitle>
              <CardDescription>Select or join an organization to manage TCPA coverage.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </Layout>
    );
  }

  const aggregatePaid = claims
    .filter(c => c.status === "approved")
    .reduce((sum, c) => sum + (c.amountPaidCents ?? 0), 0);

  return (
    <Layout>
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="heading-tcpa">TCPA Defense Insurance</h1>
        </div>

        {/* Policy panel */}
        <Card>
          <CardHeader>
            <CardTitle>Active Policy</CardTitle>
            <CardDescription>
              Each organization may hold one active policy. Creating a new policy auto-expires the previous one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {policyLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : policy ? (
              <div className="space-y-3" data-testid="panel-policy">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Active</Badge>
                  {policy.carrierName && <span className="text-sm text-muted-foreground">{policy.carrierName}</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Per-claim limit</p>
                    <p className="text-lg font-semibold font-mono" data-testid="text-per-claim-limit">
                      {formatCents(policy.perClaimLimitCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Aggregate limit</p>
                    <p className="text-lg font-semibold font-mono" data-testid="text-aggregate-limit">
                      {formatCents(policy.aggregateLimitCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Paid to date</p>
                    <p className="text-lg font-semibold font-mono" data-testid="text-aggregate-paid">
                      {formatCents(aggregatePaid)}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">No active policy. Activate the default coverage below.</p>
                {canManage ? (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor="carrierName">Carrier name (optional)</Label>
                      <Input
                        id="carrierName"
                        value={carrierName}
                        onChange={(e) => setCarrierName(e.target.value)}
                        placeholder="e.g. Acme TCPA Defense"
                        data-testid="input-carrier-name"
                      />
                    </div>
                    <Button
                      onClick={() => createPolicyMutation.mutate()}
                      disabled={createPolicyMutation.isPending}
                      data-testid="button-create-policy"
                    >
                      {createPolicyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate Policy"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Only owners/admins can activate a policy.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* File claim */}
        {policy && (
          <Card>
            <CardHeader>
              <CardTitle>File a Claim</CardTitle>
              <CardDescription>
                Any org member can file. Claims open at <code>status=open</code>; a platform admin approves or denies.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="claimReason">Reason</Label>
                <Textarea
                  id="claimReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the TCPA litigation or defense cost being claimed"
                  data-testid="input-claim-reason"
                />
              </div>
              <div>
                <Label htmlFor="claimAmount">Amount claimed (USD)</Label>
                <Input
                  id="claimAmount"
                  type="number"
                  min="1"
                  step="0.01"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  placeholder="e.g. 7500.00"
                  data-testid="input-claim-amount"
                />
              </div>
              <Button
                onClick={() => fileClaimMutation.mutate()}
                disabled={fileClaimMutation.isPending || !reason || !amountUsd}
                data-testid="button-file-claim"
              >
                {fileClaimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><FileWarning className="h-4 w-4 mr-2" /> File Claim</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Claims list */}
        <Card>
          <CardHeader>
            <CardTitle>Claims</CardTitle>
            <CardDescription>All claims under this organization's policies.</CardDescription>
          </CardHeader>
          <CardContent>
            {claimsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : claims.length === 0 ? (
              <p className="text-sm text-muted-foreground">No claims filed yet.</p>
            ) : (
              <div className="space-y-2" data-testid="list-claims">
                {claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="flex items-center justify-between border rounded-md p-3"
                    data-testid={`claim-row-${claim.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {statusBadge(claim.status)}
                        <span className="font-mono text-sm text-muted-foreground">#{claim.id}</span>
                      </div>
                      <p className="text-sm mt-1 truncate" title={claim.claimReason ?? ""}>
                        {claim.claimReason || "—"}
                      </p>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-mono font-semibold">{formatCents(claim.amountClaimedCents)}</p>
                      {claim.amountPaidCents != null && claim.status === "approved" && (
                        <p className="text-xs text-emerald-600 font-mono">paid {formatCents(claim.amountPaidCents)}</p>
                      )}
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
