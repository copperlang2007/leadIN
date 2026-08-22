// Neon Auth sign-in surface. Renders the Stack SDK's sign-in UI, and after a
// successful sign-in exchanges the access token for the first-party server
// session (POST /api/auth/session) that the rest of the app authenticates
// with. Also hosts the /handler/* routes the SDK uses for OAuth callbacks,
// email verification, and password reset.
//
// The StackProvider is scoped to this page (not the app root) so the main
// bundle and every other route render identically whether or not Neon Auth
// is configured.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { SignIn, StackHandler, StackProvider, StackTheme, useUser } from "@stackframe/react";
import { stackClientApp } from "@/lib/stack";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function SessionBridge() {
  const user = useUser();
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const exchanging = useRef(false);

  const signout = new URLSearchParams(window.location.search).has("signout");

  useEffect(() => {
    if (!user || exchanging.current) return;
    exchanging.current = true;

    if (signout) {
      // Server session is already destroyed (/api/logout); clear the Stack
      // SDK's cookies too so revisiting this page doesn't silently re-login.
      void user
        .signOut()
        .catch(() => {})
        .finally(() => {
          exchanging.current = false;
          window.history.replaceState(null, "", "/auth");
        });
      return;
    }

    void (async () => {
      const token = await user.getAccessToken();
      if (!token) throw new Error("No access token from Neon Auth");
      await apiRequest("POST", "/api/auth/session", { accessToken: token });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      navigate("/");
    })().catch((e: unknown) => {
      exchanging.current = false;
      setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
    });
  }, [user, signout, navigate]);

  if (error) {
    return (
      <p className="text-sm text-destructive text-center mb-4" data-testid="auth-error">
        {error}
      </p>
    );
  }
  return null;
}

export default function AuthPage() {
  const [location] = useLocation();

  if (!stackClientApp) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sign-in unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Neon Auth is not configured in this environment. Set
            {" "}<code>VITE_STACK_PROJECT_ID</code> and{" "}
            <code>VITE_STACK_PUBLISHABLE_CLIENT_KEY</code>, then rebuild.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <StackProvider app={stackClientApp}>
      <StackTheme>
        {location.startsWith("/handler") ? (
          <StackHandler location={location} fullPage />
        ) : (
          <div className="min-h-screen flex flex-col items-center justify-center p-6">
            <SessionBridge />
            <SignIn />
          </div>
        )}
      </StackTheme>
    </StackProvider>
  );
}
