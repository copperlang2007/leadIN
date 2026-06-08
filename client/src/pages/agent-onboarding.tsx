import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, MapPin, FileBadge, Building2, Loader2, Save, ShieldCheck, AlertTriangle } from "lucide-react";

const ALL_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const CARRIER_OPTIONS = [
  "UnitedHealthcare","Humana","Aetna","Cigna","Anthem BCBS","Mutual of Omaha","Wellcare","Devoted Health",
];

interface AgentProfile {
  id: number;
  userId: string;
  orgId: string;
  licensedStates: string[];
  appointedCarriers: string[];
  territoryZips: string[];
  territoryCounties: string[];
  licenseNumber: string | null;
  licenseDocumentUrl: string | null;
  verificationStatus: string;
  capacityLimit: number;
  // Wave 7 (T4): NIPR/DOI auto-verification cache.
  niprVerifiedAt: string | null;
  niprLicenseExpiry: string | null;
  niprLastError: string | null;
}

interface OrgList {
  activeOrgId: string | null;
  memberships: { orgId: string; role: string; org: { id: string; name: string; slug: string } }[];
}

export default function AgentOnboarding() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery<OrgList>({ queryKey: ["/api/orgs"] });
  const { data: profile, isLoading } = useQuery<AgentProfile | null>({
    queryKey: ["/api/agent/profile"],
    // Wave 7 (T4): poll while NIPR verification is pending (we have a
    // license number but no verifiedAt and no error yet) so the badge
    // refreshes once the background verify lands. ~5s feels responsive
    // without hammering the API.
    refetchInterval: (q) => {
      const p = q.state.data as AgentProfile | null | undefined;
      if (!p) return false;
      const pending = !!p.licenseNumber && !p.niprVerifiedAt && !p.niprLastError;
      return pending ? 5000 : false;
    },
  });

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [appointedCarriers, setAppointedCarriers] = useState<string[]>([]);
  const [territoryZips, setTerritoryZips] = useState("");
  const [territoryCounties, setTerritoryCounties] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseDocumentUrl, setLicenseDocumentUrl] = useState("");
  const [capacityLimit, setCapacityLimit] = useState(25);

  useEffect(() => {
    if (profile) {
      setLicensedStates(profile.licensedStates || []);
      setAppointedCarriers(profile.appointedCarriers || []);
      setTerritoryZips((profile.territoryZips || []).join(", "));
      setTerritoryCounties((profile.territoryCounties || []).join(", "));
      setLicenseNumber(profile.licenseNumber || "");
      setLicenseDocumentUrl(profile.licenseDocumentUrl || "");
      setCapacityLimit(profile.capacityLimit || 25);
    }
  }, [profile]);

  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/orgs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName, slug: orgSlug }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to create");
      return res.json();
    },
    onSuccess: async (org: { id: string }) => {
      await fetch(`/api/orgs/${org.id}/activate`, { method: "POST", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Organization created", description: `${orgName} is now your active org.` });
    },
    onError: (e: Error) => toast({ title: "Could not create org", description: e.message, variant: "destructive" }),
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        licensedStates,
        appointedCarriers,
        territoryZips: territoryZips.split(",").map(s => s.trim()).filter(Boolean),
        territoryCounties: territoryCounties.split(",").map(s => s.trim()).filter(Boolean),
        licenseNumber: licenseNumber.trim() || undefined,
        licenseDocumentUrl: licenseDocumentUrl.trim() || undefined,
        capacityLimit,
      };
      const res = await fetch("/api/agent/onboard", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "Agent profile saved", description: "Your onboarding info is being verified." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (arr: string[], v: string, setter: (a: string[]) => void) =>
    setter(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const hasActiveOrg = !!orgs?.activeOrgId;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Briefcase className="h-7 w-7 text-primary" /> Agent Onboarding
          </h1>
          <p className="text-muted-foreground mt-1">
            Set up your licensing, carrier appointments, and territory so the routing engine can match you with leads.
          </p>
        </div>

        {!hasActiveOrg && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Create your agency</CardTitle>
              <CardDescription>
                Every agent must belong to an organization. This scopes your leads and billing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="org-name">Agency name</Label>
                <Input id="org-name" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Sunset Insurance Group" />
              </div>
              <div>
                <Label htmlFor="org-slug">URL slug</Label>
                <Input id="org-slug" value={orgSlug} onChange={e => setOrgSlug(e.target.value.toLowerCase())} placeholder="sunset-insurance" />
              </div>
              <Button
                disabled={!orgName || !orgSlug || createOrgMutation.isPending}
                onClick={() => createOrgMutation.mutate()}
              >
                {createOrgMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create organization
              </Button>
            </CardContent>
          </Card>
        )}

        {hasActiveOrg && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileBadge className="h-5 w-5" /> Licensing</CardTitle>
                <CardDescription>Select every state where you hold an active resident or non-resident license.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                    {ALL_STATES.map(s => (
                      <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <Checkbox checked={licensedStates.includes(s)} onCheckedChange={() => toggle(licensedStates, s, setLicensedStates)} />
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="license-num">License number</Label>
                    <Input id="license-num" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="license-url">License document URL</Label>
                    <Input id="license-url" value={licenseDocumentUrl} onChange={e => setLicenseDocumentUrl(e.target.value)} placeholder="https://..." />
                  </div>
                </div>
                {profile && (
                  <div className="flex items-center gap-2 flex-wrap" data-testid="status-row">
                    <span className="text-sm text-muted-foreground">Verification status:</span>
                    <Badge
                      variant={profile.verificationStatus === "verified" ? "default" : "outline"}
                      className={
                        profile.verificationStatus === "verified" ? "bg-emerald-600" :
                        profile.verificationStatus === "rejected" ? "bg-destructive text-destructive-foreground" : ""
                      }
                    >
                      {profile.verificationStatus}
                    </Badge>
                    {/* Wave 7 (T4): NIPR/DOI auto-verification badge.
                        Three visual states: verified (green w/ expiry),
                        error (red), pending (spinner while we wait for the
                        background NIPR call to land). */}
                    {profile.licenseNumber && (
                      profile.niprVerifiedAt ? (
                        <Badge
                          className="bg-emerald-600 flex items-center gap-1"
                          data-testid="badge-nipr-verified"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          NIPR verified
                          {profile.niprLicenseExpiry && (
                            <span className="opacity-90 ml-1">
                              · expires {new Date(profile.niprLicenseExpiry).toISOString().slice(0, 10)}
                            </span>
                          )}
                        </Badge>
                      ) : profile.niprLastError ? (
                        <Badge
                          variant="outline"
                          className="bg-destructive text-destructive-foreground flex items-center gap-1"
                          data-testid="badge-nipr-error"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          NIPR error
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="flex items-center gap-1" data-testid="badge-nipr-pending">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Verifying license…
                        </Badge>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Carrier appointments</CardTitle>
                <CardDescription>Which carriers are you contracted to write for?</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {CARRIER_OPTIONS.map(c => (
                    <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={appointedCarriers.includes(c)} onCheckedChange={() => toggle(appointedCarriers, c, setAppointedCarriers)} />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Territory</CardTitle>
                <CardDescription>
                  ZIP codes and counties you cover. Leave blank to receive any lead in your licensed states.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="zips">Territory ZIP codes (comma-separated)</Label>
                  <Input id="zips" value={territoryZips} onChange={e => setTerritoryZips(e.target.value)} placeholder="33101, 33102, 33180" />
                </div>
                <div>
                  <Label htmlFor="counties">Territory counties (comma-separated)</Label>
                  <Input id="counties" value={territoryCounties} onChange={e => setTerritoryCounties(e.target.value)} placeholder="Miami-Dade, Broward" />
                </div>
                <div>
                  <Label htmlFor="cap">Maximum simultaneous open leads</Label>
                  <Input id="cap" type="number" min={1} max={500} value={capacityLimit} onChange={e => setCapacityLimit(parseInt(e.target.value) || 25)} />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending}>
                {saveProfileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save profile
              </Button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
