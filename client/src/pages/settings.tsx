import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  Settings,
  Wallet,
  User,
  Shield,
  Bell,
  LogOut,
  Plus,
  CreditCard,
  CheckCircle,
  Loader2,
  ChevronRight,
  Mail,
  Calendar,
  BadgeCheck,
  Trash2,
  Plug,
} from "lucide-react";

interface OrgList {
  activeOrgId: string | null;
  memberships: { orgId: string; role: string; org: { id: string; name: string; slug: string } }[];
}

interface CrmConnection {
  id: number;
  provider: string;
  status: string;
  createdAt: string | null;
  externalAccountId: string | null;
}

interface CrmConnectionsResponse {
  connections: CrmConnection[];
  providers: string[];
}

const PROVIDER_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  ghl: "GoHighLevel",
  pipedrive: "Pipedrive",
};

const FUND_AMOUNTS = [25, 50, 100, 250];

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fundingAmount, setFundingAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");

  const balance = parseFloat(user?.balance || "0");

  const checkoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create checkout session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "Checkout unavailable", description: "Stripe is not configured. Please contact support.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const notificationMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/profile/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update notification setting");
      return res.json();
    },
    onSuccess: (_, enabled) => {
      toast({
        title: enabled ? "Notifications enabled" : "Notifications disabled",
        description: enabled
          ? "You'll receive email alerts for new matching leads."
          : "Email notifications have been turned off.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  // CRM Integrations (Wave 6 K4) — scoped to the user's active org.
  const { data: orgs } = useQuery<OrgList>({ queryKey: ["/api/orgs"] });
  const activeOrgId = orgs?.activeOrgId ?? null;
  const activeMembership = orgs?.memberships.find(m => m.orgId === activeOrgId);
  const canManageCrm = !!activeMembership && (activeMembership.role === "owner" || activeMembership.role === "admin");

  const { data: crm } = useQuery<CrmConnectionsResponse>({
    queryKey: [`/api/orgs/${activeOrgId}/crm-connections`],
    enabled: !!activeOrgId,
  });

  const connectCrmMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/orgs/${activeOrgId}/crm-connections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Dev stub: send a placeholder token. The real OAuth flow will
        // POST back the exchanged access token instead.
        body: JSON.stringify({ provider, accessToken: `dev-token-${provider}-${Date.now()}` }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Connect failed");
      return res.json();
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${activeOrgId}/crm-connections`] });
      toast({ title: `${PROVIDER_LABELS[provider] ?? provider} connected` });
    },
    onError: (e: Error) => toast({ title: "Connect failed", description: e.message, variant: "destructive" }),
  });

  const disconnectCrmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/orgs/${activeOrgId}/crm-connections/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Disconnect failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orgs/${activeOrgId}/crm-connections`] });
      toast({ title: "CRM disconnected" });
    },
    onError: (e: Error) => toast({ title: "Disconnect failed", description: e.message, variant: "destructive" }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (confirmEmail: string) => {
      const res = await fetch("/api/account", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to delete account");
      }
      return res.json();
    },
    onSuccess: () => {
      // Server already destroyed the session; bounce through the logout redirect (also clears the Neon Auth client cookies).
      window.location.href = "/api/logout";
    },
    onError: (err: Error) => {
      toast({
        title: "Account deletion failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFund = () => {
    const amount = fundingAmount ?? (customAmount ? parseFloat(customAmount) : null);
    if (!amount || amount < 5) {
      toast({ title: "Minimum $5.00 required", variant: "destructive" });
      return;
    }
    if (amount > 10000) {
      toast({ title: "Maximum $10,000 per transaction", variant: "destructive" });
      return;
    }
    checkoutMutation.mutate(amount);
  };

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "—";

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "—";

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-7 w-7 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your wallet, account details, and preferences.
          </p>
        </div>

        {/* Wallet & Billing */}
        <Card data-testid="card-wallet">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Wallet & Billing
            </CardTitle>
            <CardDescription>
              Your lead-purchase balance. Fund your account securely via Stripe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Balance */}
            <div className="flex items-center justify-between rounded-lg bg-muted/50 border px-4 py-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Available Balance</p>
                <p
                  className="text-3xl font-mono font-bold text-primary"
                  data-testid="text-wallet-balance"
                >
                  ${balance.toFixed(2)}
                </p>
              </div>
              {balance > 0 && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  Active
                </Badge>
              )}
            </div>

            {/* Preset amounts */}
            <div>
              <p className="text-sm font-medium mb-2">Add Funds</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {FUND_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    data-testid={`button-fund-${amt}`}
                    onClick={() => {
                      setFundingAmount(amt);
                      setCustomAmount("");
                    }}
                    className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors
                      ${fundingAmount === amt
                        ? "border-primary bg-primary text-primary-foreground shadow"
                        : "border-border hover:border-primary/60 hover:bg-muted/40"
                      }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <input
                    type="number"
                    min="5"
                    max="10000"
                    step="1"
                    placeholder="Custom amount"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setFundingAmount(null);
                    }}
                    data-testid="input-custom-amount"
                    className="w-full pl-7 pr-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <Button
                  onClick={handleFund}
                  disabled={checkoutMutation.isPending || (!fundingAmount && !customAmount)}
                  className="gap-2 shrink-0"
                  data-testid="button-fund-account"
                >
                  {checkoutMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                  ) : (
                    <><Plus className="h-4 w-4" /> Add Funds</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <CreditCard className="h-3 w-3" />
                Payments are processed securely via Stripe. Funds are credited instantly upon completion.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Account */}
        <Card data-testid="card-account">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Account
            </CardTitle>
            <CardDescription>
              Your account details are managed via Neon Auth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  Name
                </div>
                <span
                  className="font-medium text-sm"
                  data-testid="text-account-name"
                >
                  {displayName}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </div>
                <span
                  className="font-medium text-sm"
                  data-testid="text-account-email"
                >
                  {user?.email || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Role
                </div>
                <Badge
                  variant={user?.role === "admin" ? "default" : "secondary"}
                  className="capitalize text-xs"
                  data-testid="badge-account-role"
                >
                  {user?.role || "buyer"}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Member Since
                </div>
                <span
                  className="text-sm text-foreground"
                  data-testid="text-member-since"
                >
                  {memberSince}
                </span>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card data-testid="card-notifications">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notifications
            </CardTitle>
            <CardDescription>
              Control how and when LeadMarket contacts you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">New Lead Alerts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Email me when new leads match my licensed states and preferred types.
                </p>
              </div>
              <Switch
                checked={user?.notificationsEnabled ?? true}
                onCheckedChange={(val) => notificationMutation.mutate(val)}
                disabled={notificationMutation.isPending}
                data-testid="switch-notifications"
              />
            </div>
            <Separator />
            <a
              href="/profile"
              className="flex items-center justify-between text-sm text-primary hover:underline"
              data-testid="link-manage-licenses"
            >
              <span>Manage licensed states & lead type preferences</span>
              <ChevronRight className="h-4 w-4" />
            </a>
          </CardContent>
        </Card>

        {/* Security */}
        <Card data-testid="card-security">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Security
            </CardTitle>
            <CardDescription>
              Manage your session and account access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30">
              <div>
                <p className="text-sm font-medium">Current Session</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Authenticated via Neon Auth — session is encrypted and server-side.
                </p>
              </div>
              <Badge variant="secondary" className="gap-1 text-xs shrink-0">
                <CheckCircle className="h-3 w-3 text-green-500" />
                Active
              </Badge>
            </div>
            <a
              href="/api/logout"
              data-testid="link-sign-out"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </a>
          </CardContent>
        </Card>

        {/* CRM Integrations (Wave 6 K4) */}
        {activeOrgId && (
          <Card data-testid="card-crm-integrations">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" />
                CRM Integrations
              </CardTitle>
              <CardDescription>
                Auto-sync purchased leads to your CRM as contacts + deals. Deal-close
                events flow back to update agent reputation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(crm?.providers ?? ["hubspot", "salesforce", "ghl", "pipedrive"]).map((provider) => {
                const connected = crm?.connections.find(c => c.provider === provider);
                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                    data-testid={`row-crm-${provider}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {PROVIDER_LABELS[provider] ?? provider}
                      </span>
                      {connected && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          Connected
                        </Badge>
                      )}
                    </div>
                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canManageCrm || disconnectCrmMutation.isPending}
                        onClick={() => disconnectCrmMutation.mutate(connected.id)}
                        data-testid={`button-disconnect-${provider}`}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!canManageCrm || connectCrmMutation.isPending}
                        onClick={() => connectCrmMutation.mutate(provider)}
                        data-testid={`button-connect-${provider}`}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
              {!canManageCrm && (
                <p className="text-xs text-muted-foreground">
                  Only org owners and admins can manage CRM connections.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Delete Account */}
        <Card className="border-destructive/30" data-testid="card-delete-account">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete account
            </CardTitle>
            <CardDescription>
              Permanently delete your account, agent profile, saved lists, and behavioral data.
              Purchased leads will be retained for audit but their consumer PII is wiped.
              This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                setDeleteDialogOpen(open);
                if (!open) setDeleteConfirmEmail("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-delete-account">
                  Delete my account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes your profile, saved lists, behavioral data, and
                    organization memberships. Consumer PII on leads you purchased will be wiped
                    while the order rows remain for audit. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <label
                    htmlFor="delete-confirm-email"
                    className="text-sm font-medium"
                  >
                    Type your email to confirm
                  </label>
                  <Input
                    id="delete-confirm-email"
                    type="email"
                    autoComplete="off"
                    placeholder={user?.email ?? ""}
                    value={deleteConfirmEmail}
                    onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                    data-testid="input-delete-confirm-email"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-delete-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={
                      deleteAccountMutation.isPending ||
                      !user?.email ||
                      deleteConfirmEmail.trim().toLowerCase() !==
                        user.email.trim().toLowerCase()
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      deleteAccountMutation.mutate(deleteConfirmEmail);
                    }}
                    data-testid="button-delete-confirm"
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteAccountMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Deleting…
                      </>
                    ) : (
                      "Permanently delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
