import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ShieldCheck, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User } from "@/lib/types";

const QUERY_KEY = ["/api/admin/users"] as const;

// This app's assignable platform roles. Anything else (legacy "owner"/"agent"
// from the leadmarket migration, etc.) is shown read-only.
const KNOWN_ROLES = new Set(["user", "admin"]);

function displayName(u: User): string {
  const first = u.firstName?.trim();
  const last = u.lastName?.trim();
  if (first || last) return [first, last].filter(Boolean).join(" ");
  // `??` wouldn't coerce an empty-string email (a real DB state), so use `||`.
  return u.email?.trim() || u.id;
}

// The apiRequest error message is `"<status>: <body>"`; strip the status prefix
// and any HTML so a 500 error page or offline failure doesn't dump into a toast.
function friendlyError(message: string): string {
  const stripped = /^\d+:\s*/.test(message)
    ? message.replace(/^\d+:\s*/, "")
    : "Network error — please try again.";
  return stripped.replace(/<[^>]+>/g, "").trim().slice(0, 200) || "Please try again.";
}

export function AdminUsersCard() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Track in-flight role changes per user id. React Query's single-mutation
  // `variables` is replaced on the next mutate(), so it can't back a per-row
  // spinner reliably under rapid clicks — a local Set can.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: QUERY_KEY,
    enabled: me?.role === "admin",
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "user" | "admin" }) => {
      setInFlight((s) => new Set(s).add(id));
      try {
        // Encode the id: OIDC subjects can contain '/', '?', '#', '|'
        // (Auth0/Cognito/SAML) which would otherwise break the route.
        await apiRequest("POST", `/api/admin/users/${encodeURIComponent(id)}/role`, { role });
      } finally {
        setInFlight((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    onSuccess: (_data, { role }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // The caller may have changed their own role; refresh the session user.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: role === "admin" ? "Promoted to admin" : "Admin role revoked" });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't update role", description: friendlyError(err.message), variant: "destructive" }),
  });

  // The card is only rendered inside the admin-gated page, but guard anyway so
  // a non-admin (or not-yet-loaded) render doesn't show data. Because `me` is
  // required here, the per-row `isSelf` check below is always reliable.
  if (me?.role !== "admin") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> User Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center" data-testid="admin-no-users">
            No users yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">User</th>
                  <th className="pb-2 font-medium text-muted-foreground">Email</th>
                  <th className="pb-2 font-medium text-muted-foreground">Role</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => {
                  // Fail closed: if identity is somehow unknown, treat as self.
                  const isSelf = !me || u.id === me.id;
                  const isAdmin = u.role === "admin";
                  const isKnownRole = KNOWN_ROLES.has(u.role);
                  const pending = inFlight.has(u.id);
                  const blockSelf = isAdmin && isSelf;
                  return (
                    <tr key={u.id} data-testid={`row-admin-user-${u.id}`}>
                      <td className="py-2 font-medium">
                        {displayName(u)}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{u.email?.trim() || "—"}</td>
                      <td className="py-2">
                        <Badge variant={isAdmin ? "default" : "outline"} className="text-[10px] gap-1">
                          {isAdmin && <ShieldCheck className="h-3 w-3" />}
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant={isAdmin ? "outline" : "default"}
                          size="sm"
                          className="h-7 text-xs"
                          // Can't demote self; can't act on an unrecognized role.
                          disabled={pending || blockSelf || !isKnownRole}
                          onClick={() =>
                            setRole.mutate({ id: u.id, role: isAdmin ? "user" : "admin" })
                          }
                          title={
                            !isKnownRole
                              ? `Unrecognized role "${u.role}" — contact a platform admin`
                              : blockSelf
                                ? "You can't revoke your own admin role"
                                : undefined
                          }
                          data-testid={`button-role-${u.id}`}
                        >
                          {pending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : isAdmin ? (
                            "Revoke admin"
                          ) : (
                            "Make admin"
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
