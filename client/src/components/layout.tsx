import { Link, useLocation } from "wouter";
import { Search, Bell, Menu, ShieldCheck, User, LayoutGrid, FileText, BarChart3, Settings, LogOut, WifiOff, Loader2, Plus, DollarSign, BookOpen, Briefcase, TrendingUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocketContext } from "@/hooks/useWebSocketContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface AddFundsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddFundsDialog({ open, onOpenChange }: AddFundsDialogProps) {
  const [amount, setAmount] = useState("100");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const PRESET_AMOUNTS = [50, 100, 250, 500];

  const handleCheckout = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 10) {
      toast({ title: "Invalid amount", description: "Minimum deposit is $10", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numAmount }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create checkout session");
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      toast({
        title: "Checkout failed",
        description: err.message,
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* w-[95vw] keeps the dialog inside the viewport on 320px-wide phones;
          max-h-[90vh]+overflow-y-auto ensures the "Proceed to Checkout" CTA
          remains reachable when the iOS keyboard pushes the input upward. */}
      <DialogContent className="max-w-md w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> Add Funds to Wallet
          </DialogTitle>
          <DialogDescription>
            Securely deposit funds via Stripe. Your balance will be credited instantly after payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-2">Quick amounts</p>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map(preset => (
                <Button
                  key={preset}
                  variant={amount === preset.toString() ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAmount(preset.toString())}
                  data-testid={`button-preset-${preset}`}
                >
                  ${preset}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Custom amount</p>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input
                type="number"
                min="10"
                max="10000"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7"
                placeholder="Enter amount"
                data-testid="input-custom-amount"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Minimum $10 · Maximum $10,000</p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Deposit amount</span>
              <span className="font-semibold">${parseFloat(amount || "0").toFixed(2)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">Processing fee</span>
              <span className="text-emerald-600 font-medium">Free</span>
            </div>
          </div>

          <Button
            className="w-full gap-2"
            onClick={handleCheckout}
            disabled={isLoading || !amount || parseFloat(amount) < 10}
            data-testid="button-proceed-checkout"
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><Plus className="h-4 w-4" /> Proceed to Checkout</>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Secured by <span className="font-semibold">Stripe</span> · SSL encrypted
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
  const [newLeadFlash, setNewLeadFlash] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { status: wsStatus, subscribeToNewLeads } = useWebSocketContext();

  useEffect(() => {
    const unsubscribe = subscribeToNewLeads((lead: any) => {
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 3000);

      // Predicate-based invalidation to match parameterized lead queries
      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/leads") });

      toast({
        title: "New Lead Available",
        description: `${lead.type} in ${lead.state} — $${parseFloat(lead.price).toFixed(2)}`,
      });
    });
    return unsubscribe;
  }, [subscribeToNewLeads, queryClient, toast]);

  // Check for Stripe success redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get("stripe");
    const sessionId = params.get("session_id");

    if (stripeStatus === "success" && sessionId) {
      // Poll for session status and refresh user balance
      const checkSession = async () => {
        try {
          const res = await fetch(`/api/stripe/session/${sessionId}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            if (data.status === "completed") {
              toast({
                title: "Funds added!",
                description: `$${parseFloat(data.amount).toFixed(2)} has been added to your wallet.`,
              });
              queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            }
          }
        } catch {}
      };
      checkSession();

      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", url.toString());
    } else if (stripeStatus === "cancelled") {
      toast({
        title: "Payment cancelled",
        description: "Your deposit was not processed.",
        variant: "destructive",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      window.history.replaceState({}, "", url.toString());
    } else if (stripeStatus === "sub_success") {
      toast({
        title: "Subscription active!",
        description: "Your organization is now on the new tier.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      url.searchParams.delete("org");
      window.history.replaceState({}, "", url.toString());
    } else if (stripeStatus === "sub_cancelled") {
      toast({
        title: "Subscription cancelled",
        description: "No charge was made.",
        variant: "destructive",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const NavItem = ({ href, icon: Icon, label }: { href: string, icon: any, label: string }) => {
    const isActive = location === href;
    return (
      // aria-current="page" goes on the <Link> (rendered as <a>) so
      // it lands on the actual interactive element screen readers
      // announce — not on a nested presentational <div>. Without it,
      // the colour-only highlight conveys nothing to assistive tech.
      <Link href={href} aria-current={isActive ? "page" : undefined}>
        <div
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer
          ${isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </div>
      </Link>
    );
  };

  const isAdmin = user?.role === "admin";

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      <div className="p-6 flex items-center gap-2 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-display font-bold text-xl text-sidebar-foreground">LeadMarket</span>
      </div>

      {/* aria-label disambiguates this nav from other nav landmarks
          (public header, footer) in screen-reader rotors. "Sidebar
          navigation" is concrete enough to tell the user which one
          they're entering when they jump via the landmarks menu. */}
      <nav aria-label="Sidebar navigation" className="flex-1 py-6 px-4 space-y-1">
        <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Marketplace
        </div>
        <NavItem href="/" icon={LayoutGrid} label="Browse Leads" />
        <NavItem href="/architect" icon={ShieldCheck} label="Platform Status" />
        <NavItem href="/blog" icon={BookOpen} label="Industry Blog" />
        <NavItem href="/saved" icon={FileText} label="Saved Lists" />
        <NavItem href="/orders" icon={BarChart3} label="Order History" />

        <div className="px-3 mt-8 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Agent
        </div>
        <NavItem href="/agent" icon={Briefcase} label="Agent Dashboard" />
        <NavItem href="/agent/onboarding" icon={ShieldCheck} label="Agent Onboarding" />
        <NavItem href="/org-admin" icon={ShieldCheck} label="Org Admin" />
        <NavItem href="/tcpa" icon={ShieldCheck} label="TCPA Defense" />
        <NavItem href="/smart-match" icon={Sparkles} label="Smart Match" />

        <div className="px-3 mt-8 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Account
        </div>
        <NavItem href="/profile" icon={User} label="Profile & Licenses" />
        <NavItem href="/settings" icon={Settings} label="Settings" />

        {isAdmin && (
          <>
            <div className="px-3 mt-8 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Admin
            </div>
            <NavItem href="/admin" icon={ShieldCheck} label="Admin Panel" />
            <NavItem href="/analytics" icon={TrendingUp} label="Analytics" />
          </>
        )}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border overflow-hidden">
            {user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-medium">
                {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-sidebar-foreground">
              {user?.firstName && user?.lastName
                ? `${user.firstName} ${user.lastName}`
                : user?.email || 'User'}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
          </div>
          <button
            onClick={() => window.location.href = '/api/logout'}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  const LiveFeedIndicator = () => {
    if (wsStatus === "connected") {
      return (
        <div className={`hidden md:flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5 rounded-full border transition-all
          ${newLeadFlash
            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
            : "bg-muted/50 border-border/50"
          }`}
          data-testid="indicator-live-feed"
        >
          <span className={`w-2 h-2 rounded-full ${newLeadFlash ? "bg-emerald-500 animate-ping" : "bg-success animate-pulse"}`}></span>
          {newLeadFlash ? "New Lead!" : "Live Feed: Connected"}
        </div>
      );
    }
    if (wsStatus === "connecting") {
      return (
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border border-border/50">
          <Loader2 className="w-3 h-3 animate-spin" />
          Live Feed: Connecting...
        </div>
      );
    }
    return (
      <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border border-border/50">
        <WifiOff className="w-3 h-3 text-destructive" />
        Live Feed: Offline
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-64 fixed inset-y-0 z-50">
        <SidebarContent />
      </div>

      {/* Main Content */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="h-16 border-b bg-card px-6 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
              <SheetTrigger asChild>
                {/* iOS Safari + accessibility: tap targets should be >= 44x44px.
                    size="icon" is 36px which fails Apple HIG; bump to h-11 w-11
                    (44px) on the mobile-only trigger. */}
                <Button variant="ghost" size="icon" className="md:hidden h-11 w-11">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64">
                <SidebarContent />
              </SheetContent>
            </Sheet>

            <div className="relative w-96 hidden md:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by state, type, or ID..."
                className="pl-9 bg-background border-none shadow-sm focus-visible:ring-1 w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <LiveFeedIndicator />

            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="absolute top-2 right-2 h-2 w-2 bg-destructive rounded-full border-2 border-card"></span>
            </Button>

            <div className="h-8 w-px bg-border mx-1"></div>

            <div className="flex flex-col items-end mr-2 hidden sm:block">
              <span className="text-xs font-medium text-muted-foreground">Balance</span>
              <span className="text-sm font-bold font-mono" data-testid="text-balance">
                ${user?.balance ? parseFloat(user.balance).toFixed(2) : '0.00'}
              </span>
            </div>

            <Button
              size="sm"
              className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              onClick={() => setIsAddFundsOpen(true)}
              data-testid="button-add-funds"
            >
              Add Funds
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>

      <AddFundsDialog open={isAddFundsOpen} onOpenChange={setIsAddFundsOpen} />
    </div>
  );
}
