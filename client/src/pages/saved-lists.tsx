import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { FileText, Plus, Trash2, Loader2, Bookmark } from "lucide-react";
import type { Lead } from "@/lib/types";

interface SavedList {
  id: number;
  name: string;
  orgId: string | null;
  ownerUserId: string;
  itemCount: number;
  createdAt: string;
}

export default function SavedLists() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [openListId, setOpenListId] = useState<number | null>(null);

  const { data: lists = [], isLoading } = useQuery<SavedList[]>({ queryKey: ["/api/saved-lists"] });
  const { data: openList } = useQuery<{ list: SavedList; leads: Lead[] }>({
    queryKey: [`/api/saved-lists/${openListId}`],
    enabled: openListId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/saved-lists", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
      toast({ title: "List created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/saved-lists/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
    },
    onSuccess: () => {
      setOpenListId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: async ({ listId, leadId }: { listId: number; leadId: number }) => {
      const res = await fetch(`/api/saved-lists/${listId}/items/${leadId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/saved-lists/${openListId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
    },
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-7 w-7 text-primary" /> Saved lists
          </h1>
          <p className="text-muted-foreground mt-1">
            Bookmark leads to revisit. Lists are visible to other members of your active organization.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New list</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Florida priority Q1"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newName) createMutation.mutate(); }}
              />
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !newName}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Create
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading ? (
            // Skeleton cards match the SavedList card footprint so the
            // page shape stays stable while data streams in.
            <>
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            </>
          ) : lists.length === 0 ? (
            <div className="col-span-2">
              <EmptyState
                icon={Bookmark}
                title="No saved lists yet"
                description="Bookmark interesting leads from the marketplace and group them here. Useful for tracking warm prospects across multiple sessions."
                compact
                data-testid="saved-lists-empty"
              />
            </div>
          ) : (
            lists.map(l => (
              <Card key={l.id} className={openListId === l.id ? "ring-2 ring-primary" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{l.name}</span>
                    <Badge variant="outline">{l.itemCount}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {new Date(l.createdAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setOpenListId(openListId === l.id ? null : l.id)}>
                    {openListId === l.id ? "Close" : "Open"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate(l.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {openList && (
          <Card>
            <CardHeader>
              <CardTitle>{openList.list.name}</CardTitle>
              <CardDescription>{openList.leads.length} leads</CardDescription>
            </CardHeader>
            <CardContent>
              {openList.leads.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 px-4 text-center border border-dashed rounded-lg bg-muted/10" data-testid="open-list-empty">
                  <p className="mb-1 font-medium text-foreground">No leads in this list yet</p>
                  <p>From the marketplace, open any lead and click the bookmark icon to save it here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {openList.leads.map(lead => (
                    <div key={lead.id} className="flex items-center justify-between border rounded p-2 text-sm">
                      <div>
                        <div className="font-medium">Lead #{lead.id} · {lead.type}</div>
                        <div className="text-xs text-muted-foreground">{lead.state} {lead.zipCode} · ${lead.price}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeItem.mutate({ listId: openList.list.id, leadId: lead.id })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
