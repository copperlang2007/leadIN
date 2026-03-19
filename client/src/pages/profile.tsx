import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { User, MapPin, Shield, Activity, Save, Loader2 } from "lucide-react";
import type { UserProfile } from "@/lib/types";

const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const LEAD_TYPES = ["Medicare Advantage", "Medicare Supplement", "Final Expense"];

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [preferredTypes, setPreferredTypes] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setLicensedStates(profile.licensedStates || []);
      setPreferredTypes(profile.preferredTypes || []);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licensedStates, preferredTypes }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save profile");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile saved!", description: "Your license settings have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleState = (state: string) => {
    setLicensedStates(prev =>
      prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]
    );
  };

  const toggleType = (type: string) => {
    setPreferredTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const hasChanges =
    JSON.stringify([...licensedStates].sort()) !== JSON.stringify([...(profile?.licensedStates || [])].sort()) ||
    JSON.stringify([...preferredTypes].sort()) !== JSON.stringify([...(profile?.preferredTypes || [])].sort());

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
            <User className="h-7 w-7 text-primary" />
            Profile & Licenses
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your license portfolio and preferred lead types. Your compatibility scores update instantly.
          </p>
        </div>

        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Account Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Name</p>
              <p className="font-medium">
                {user?.firstName && user?.lastName
                  ? `${user.firstName} ${user.lastName}`
                  : user?.email || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Email</p>
              <p className="font-medium">{user?.email || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Account Balance</p>
              <p className="font-mono font-bold text-primary text-lg">
                ${user?.balance ? parseFloat(user.balance).toFixed(2) : "0.00"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Licensed States</p>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-success" />
                <span className="font-semibold">{licensedStates.length} state{licensedStates.length !== 1 ? "s" : ""}</span>
                {licensedStates.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {licensedStates.slice(0, 4).map(s => (
                      <Badge key={s} variant="secondary" className="text-[10px] py-0 px-1">{s}</Badge>
                    ))}
                    {licensedStates.length > 4 && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1">+{licensedStates.length - 4}</Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preferred Lead Types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preferred Lead Types</CardTitle>
            <CardDescription>
              Leads matching your preferred types will rank higher in your feed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex gap-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-40" />)}
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {LEAD_TYPES.map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Checkbox
                      id={`type-${type}`}
                      checked={preferredTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                      data-testid={`checkbox-type-${type}`}
                    />
                    <Label htmlFor={`type-${type}`} className="cursor-pointer font-normal">
                      {type}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Licensed States */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" /> Licensed States
            </CardTitle>
            <CardDescription>
              Select all states where you hold an active insurance license. These determine which leads show as a "License Match."
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-3">
                {[...Array(20)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLicensedStates(ALL_STATES)}
                    data-testid="button-select-all-states"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLicensedStates([])}
                    data-testid="button-clear-states"
                  >
                    Clear All
                  </Button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {licensedStates.length} / {ALL_STATES.length} selected
                  </span>
                </div>
                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {ALL_STATES.map((state) => {
                    const isSelected = licensedStates.includes(state);
                    return (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        data-testid={`button-state-${state}`}
                        className={`text-xs font-medium py-1.5 rounded border transition-colors cursor-pointer
                          ${isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-muted/40"
                          }`}
                      >
                        {state}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          {hasChanges && (
            <p className="text-xs text-muted-foreground self-center">You have unsaved changes.</p>
          )}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !hasChanges}
            className="gap-2"
            data-testid="button-save-profile"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4" /> Save Profile</>
            )}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
