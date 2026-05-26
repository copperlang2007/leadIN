import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { WebSocketProvider } from "@/hooks/useWebSocketContext";
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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return (
      <Switch>
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/" component={Landing} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Marketplace} />
      <Route path="/architect" component={ArchitectBlueprint} />
      <Route path="/orders" component={Orders} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin" component={Admin} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/agent" component={AgentDashboard} />
      <Route path="/agent/onboarding" component={AgentOnboarding} />
      <Route path="/org-admin" component={OrgAdmin} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug" component={BlogPost} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <WebSocketProvider>
          <Router />
        </WebSocketProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
