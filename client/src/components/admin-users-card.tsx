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

function displayName(u: User): string {
  if (u.firstName || u.lastName) return [u.firstName, u.lastName].filter(Boolean).join(" ");
  return u.email ?? u.id;
}

export function AdminUsersCard() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: QUERY_KEY,
    enabled: me?.role === "admin",
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "user" | "admin" }) => {
      await apiRequest("POST", `/api/admin/users/${id}/role`, { role });
    },
    onSuccess: (_data, { role }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // The caller may have changed their own role; refresh the session user.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: role === "admin" ? "Promoted to admin" : "Admin role revoked" });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't update role", description: err.message, variant: "destructive" }),
  });

  // The card is only rendered inside the admin-gated page, but guard anyway so
  // a non-admin render doesn't show an empty "No users yet" table for a query
  // that was never allowed to run.
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
                  const isSelf = u.id === me?.id;
                  const isAdmin = u.role === "admin";
                  const pending = setRole.isPending && setRole.variables?.id === u.id;
                  return (
                    <tr key={u.id} data-testid={`row-admin-user-${u.id}`}>
                      <td className="py-2 font-medium">
                        {displayName(u)}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{u.email ?? "—"}</td>
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
                          // An admin can't demote themselves (server enforces this too).
                          disabled={pending || (isAdmin && isSelf)}
                          onClick={() =>
                            setRole.mutate({ id: u.id, role: isAdmin ? "user" : "admin" })
                          }
                          title={isAdmin && isSelf ? "You can't revoke your own admin role" : undefined}
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
