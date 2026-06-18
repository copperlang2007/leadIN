import { useState, useEffect } from "react";
import { useLocation } from "wouter";
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
import { Briefcase, MapPin, FileBadge, Building2, Loader2, Save, ShieldCheck, AlertTriangle, Check, ArrowRight, Sparkles } from "lucide-react";

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
  const [, navigate] = useLocation();

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
  // TCPA attestation — required before Save. Acknowledges the agent
  // understands they're contracting outreach under the consumer's
  // existing consent and is responsible for ongoing DNC + revocation
  // compliance. Documented in /tcpa-compliance.
  const [tcpaAttested, setTcpaAttested] = useState(false);

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
      // Front-end gate — Save is also disabled when this is false,
      // but a belt-and-suspenders check here covers callsites we might
      // add later. Backend records the timestamp for legal-defensibility.
      if (!tcpaAttested) {
        throw new Error("Please confirm the TCPA attestation before saving.");
      }
      const payload = {
        licensedStates,
        appointedCarriers,
        territoryZips: territoryZips.split(",").map(s => s.trim()).filter(Boolean),
        territoryCounties: territoryCounties.split(",").map(s => s.trim()).filter(Boolean),
        licenseNumber: licenseNumber.trim() || undefined,
        licenseDocumentUrl: licenseDocumentUrl.trim() || undefined,
        capacityLimit,
        tcpaAttested: true,
        tcpaAttestedAt: new Date().toISOString(),
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

  // Derive completion of each onboarding step so the stepper updates as
  // the user fills in fields. We use the in-flight local state, not the
  // server-side profile, so the progress bar moves before the user hits Save.
  const steps = [
    { key: "org", label: "Create agency", done: hasActiveOrg, icon: Building2 },
    {
      key: "license",
      label: "Add licensing",
      done: hasActiveOrg && licensedStates.length > 0 && licenseNumber.trim().length > 0,
      icon: FileBadge,
    },
    {
      key: "carriers",
      label: "Carrier appointments",
      done: hasActiveOrg && appointedCarriers.length > 0,
      icon: ShieldCheck,
    },
    {
      key: "territory",
      label: "Territory",
      done: hasActiveOrg && (territoryZips.trim().length > 0 || territoryCounties.trim().length > 0 || licensedStates.length > 0),
      icon: MapPin,
    },
  ];
  const completedCount = steps.filter((s) => s.done).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);
  const allComplete = completedCount === steps.length;

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

        {/* Progress stepper — always visible so the user knows where
            they are. Tiles wrap on mobile, stay horizontal on desktop. */}
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">
                {allComplete ? "All set — you're live in the marketplace" : `Step ${completedCount + 1} of ${steps.length}`}
              </span>
              <span className="text-sm text-muted-foreground" data-testid="onboarding-progress-pct">
                {progressPct}%
              </span>
            </div>
            <div className="h-2 bg-background rounded-full overflow-hidden mb-4">
              {/* transition-[width] is narrower than transition-all — only
                  the width animates, which is all that ever changes here. */}
              <div
                className="h-full bg-primary transition-[width] duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {steps.map((s) => (
                <div
                  key={s.key}
                  className={`flex items-center gap-2 text-sm p-2 rounded-lg ${
                    s.done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                      s.done ? "bg-emerald-500 text-white" : "bg-background border"
                    }`}
                  >
                    {s.done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                  </div>
                  <span className="font-medium truncate">{s.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

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

            {/* TCPA attestation — required gate on Save. The attestation
                + timestamp ride along with the profile payload so we have
                a recorded acknowledgement for legal defensibility if a
                consumer complaint surfaces months later. Full posture
                explanation lives at /tcpa-compliance. */}
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/10">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="tcpa-attestation"
                    checked={tcpaAttested}
                    onCheckedChange={(v) => setTcpaAttested(v === true)}
                    className="mt-0.5"
                    data-testid="checkbox-tcpa-attestation"
                  />
                  <label htmlFor="tcpa-attestation" className="text-sm leading-relaxed cursor-pointer select-none">
                    I confirm that any leads I purchase through LeadMarket
                    will be contacted within the bounds of the consumer's
                    TCPA consent for the licensed product and state matching
                    each lead. I will maintain my own DNC scrub list, honor
                    revocation requests promptly, and operate within
                    state-mandated calling windows. I have read the{" "}
                    <a
                      href="/tcpa-compliance"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                      data-testid="link-tcpa-compliance"
                    >
                      TCPA compliance summary
                    </a>
                    .
                  </label>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button
                onClick={() => saveProfileMutation.mutate()}
                disabled={saveProfileMutation.isPending || !tcpaAttested}
                data-testid="button-save-profile"
                title={!tcpaAttested ? "Confirm the TCPA attestation above to save" : undefined}
              >
                {saveProfileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save profile
              </Button>
            </div>

            {/* Show a 'next step' card once every onboarding step is
                done. Sends the user straight to the marketplace —
                eliminates the dead-end at the bottom of the form. */}
            {allComplete && (
              <Card className="bg-gradient-to-br from-emerald-50 to-primary/5 dark:from-emerald-950/30 dark:to-primary/10 border-emerald-200 dark:border-emerald-900">
                <CardContent className="pt-6 flex flex-col md:flex-row items-start md:items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                    <Sparkles className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold mb-1">You're set — let's find you leads</h3>
                    <p className="text-sm text-muted-foreground">
                      Routing is now scoring incoming leads against your profile. Head to the marketplace to see what's available.
                    </p>
                  </div>
                  <Button onClick={() => navigate("/marketplace")} data-testid="onboarding-complete-cta">
                    Open marketplace
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
