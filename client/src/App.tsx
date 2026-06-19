import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { WebSocketProvider } from "@/hooks/useWebSocketContext";
import { ErrorBoundary } from "@/components/error-boundary";
import { SkipLink } from "@/components/skip-link";
import NotFound from "@/pages/not-found";
import Marketplace from "@/pages/marketplace";
import Landing from "@/pages/landing";
import ArchitectBlueprint from "@/pages/architect-blueprint";
import Orders from "@/pages/orders";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import Blog from "@/pages/blog";
import BlogPost from "@/pages/blog-post";
import SettingsPage from "@/pages/settings";
import AgentDashboard from "@/pages/agent-dashboard";
import AgentOnboarding from "@/pages/agent-onboarding";
import OrgAdmin from "@/pages/org-admin";
import Analytics from "@/pages/analytics";
import Pricing from "@/pages/pricing";
import PrivacyPolicy from "@/pages/privacy";
import TermsOfService from "@/pages/terms";
import CookiePolicy from "@/pages/cookies";
import TcpaCompliance from "@/pages/tcpa-compliance";
import SavedLists from "@/pages/saved-lists";
import TcpaPage from "@/pages/tcpa";
import VendorScorecard from "@/pages/vendor-scorecard";
import SmartMatchPage from "@/pages/smart-match";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return (
      <Switch>
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/pricing" component={Pricing} />
        {/* Public legal surface. The Stripe live-mode application + most
            B2B procurement checklists require these be reachable without
            an account, so they live in the unauthenticated tree. */}
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/cookies" component={CookiePolicy} />
        <Route path="/tcpa-compliance" component={TcpaCompliance} />
        <Route path="/" component={Landing} />
        {/* Unknown routes should render NotFound, not silently fall back to
            Landing. A guest hitting a stale link previously got a confusing
            'why am I on the marketing page?' moment. */}
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Marketplace} />
      {/* /marketplace as an alias for the home route so external links,
          empty-state CTAs, and bookmarked URLs all resolve to the same
          page. Without this, links to '/marketplace' would hit NotFound. */}
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/architect" component={ArchitectBlueprint} />
      <Route path="/orders" component={Orders} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin" component={Admin} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/agent" component={AgentDashboard} />
      <Route path="/agent/onboarding" component={AgentOnboarding} />
      <Route path="/org-admin" component={OrgAdmin} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/saved" component={SavedLists} />
      <Route path="/tcpa" component={TcpaPage} />
      <Route path="/admin/vendor-scorecard" component={VendorScorecard} />
      <Route path="/smart-match" component={SmartMatchPage} />
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug" component={BlogPost} />
      {/* Mirror the legal pages into the authenticated tree so signed-in
          users following a footer link don't bounce through the
          unauthenticated tree. */}
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/cookies" component={CookiePolicy} />
      {/* Public TCPA compliance is distinct from /tcpa (the authenticated
          TCPA Defense Insurance product above). Footer links here. */}
      <Route path="/tcpa-compliance" component={TcpaCompliance} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* WCAG 2.4.1 — visible-on-focus skip link must be the FIRST
            focusable element on the page so Tab from the URL bar
            lands here. The anchor target id="main-content" is on
            the wrapper around the route tree below. */}
        <SkipLink />
        <Toaster />
        <ErrorBoundary>
          <WebSocketProvider>
            {/* tabIndex={-1} lets a click on the skip link move focus
                onto this element programmatically — without it,
                browsers vary on whether non-form elements can receive
                keyboard focus from a fragment-link click. */}
            <div id="main-content" tabIndex={-1}>
              <Router />
            </div>
          </WebSocketProvider>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
