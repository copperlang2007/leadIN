import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Building2, ShieldCheck, ShieldX, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface OrgList {
  activeOrgId: string | null;
  memberships: { orgId: string; role: string; org: { id: string; name: string; slug: string; subscriptionStatus: string; billingMode: string } }[];
}

interface OrgAgent {
  userId: string;
  orgId: string;
  licensedStates: string[];
  appointedCarriers: string[];
  capacityLimit: number;
  verificationStatus: string;
  acceptingLeads: boolean;
  licenseNumber: string | null;
  licenseDocumentUrl: string | null;
  openLeads: number;
  user: { id: string; email: string | null; firstName: string | null; lastName: string | null };
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
                {agents.map(a => (
                  <div key={a.userId} className="border rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {a.user.firstName} {a.user.lastName} · {a.user.email}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.licensedStates.length} states · {a.appointedCarriers.length} carriers · capacity {a.openLeads}/{a.capacityLimit} · {a.licenseNumber || "no license #"}
                      </div>
                      {a.licenseDocumentUrl && (
                        <a href={a.licenseDocumentUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-primary underline">
                          View document
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
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
                ))}
              </div>
            )}
            {verifyMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Updating...
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
