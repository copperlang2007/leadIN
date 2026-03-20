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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return (
      <Switch>
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
