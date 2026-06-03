import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { Lead } from "@/lib/types";

interface SavedList {
  id: number;
  name: string;
  orgId: string | null;
  ownerUserId: string;
  itemCount: number;
  createdAt: string;
}

interface SaveToListPopoverProps {
  leadId: number;
}

export function SaveToListPopover({ leadId }: SaveToListPopoverProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pendingListId, setPendingListId] = useState<number | null>(null);

  // Fetch list of saved lists (cheap; cached by react-query)
  const { data: lists = [], isLoading: listsLoading } = useQuery<SavedList[]>({
    queryKey: ["/api/saved-lists"],
    enabled: open,
  });

  // Lazily fetch the saved lists' contents only when the popover is opened
  // so we can show the "already saved" check next to each list. We use a
  // single aggregated query per list rather than N queries to keep things
  // simple — react-query handles caching automatically.
  const { data: membership = {}, isLoading: membershipLoading } = useQuery<
    Record<number, boolean>
  >({
    queryKey: ["/api/saved-lists/membership", leadId, lists.map((l) => l.id).join(",")],
    enabled: open && lists.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        lists.map(async (l) => {
          const res = await fetch(`/api/saved-lists/${l.id}`, {
            credentials: "include",
          });
          if (!res.ok) return [l.id, false] as const;
          const data: { list: SavedList; leads: Lead[] } = await res.json();
          return [l.id, data.leads.some((ld) => ld.id === leadId)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (listId: number) => {
      await apiRequest("POST", `/api/saved-lists/${listId}/items`, { leadId });
      return listId;
    },
    onMutate: (listId) => setPendingListId(listId),
    onSuccess: (listId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists/membership"] });
      queryClient.invalidateQueries({ queryKey: [`/api/saved-lists/${listId}`] });
      toast({ title: "Saved to list" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
    onSettled: () => setPendingListId(null),
  });

  const unsaveMutation = useMutation({
    mutationFn: async (listId: number) => {
      await apiRequest("DELETE", `/api/saved-lists/${listId}/items/${leadId}`);
      return listId;
    },
    onMutate: (listId) => setPendingListId(listId),
    onSuccess: (listId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists/membership"] });
      queryClient.invalidateQueries({ queryKey: [`/api/saved-lists/${listId}`] });
      toast({ title: "Removed from list" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
    onSettled: () => setPendingListId(null),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/saved-lists", { name: newName });
      const created: SavedList = await res.json();
      await apiRequest("POST", `/api/saved-lists/${created.id}/items`, { leadId });
      return created;
    },
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-lists/membership"] });
      toast({ title: "List created and lead saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create list", description: e.message, variant: "destructive" }),
  });

  if (!user) return null;

  const toggle = (list: SavedList) => {
    if (saveMutation.isPending || unsaveMutation.isPending) return;
    if (membership[list.id]) {
      unsaveMutation.mutate(list.id);
    } else {
      saveMutation.mutate(list.id);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-testid="button-save-to-list"
        >
          <Bookmark className="h-3.5 w-3.5" />
          Save
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-3 py-2 border-b">
          <div className="text-sm font-semibold">Save to list</div>
        </div>

        <div className="max-h-60 overflow-y-auto py-1">
          {listsLoading ? (
            <div className="px-3 py-4 flex items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading lists…
            </div>
          ) : lists.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No lists yet — create one below.
            </div>
          ) : (
            lists.map((list) => {
              const isSaved = !!membership[list.id];
              const isPending = pendingListId === list.id;
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => toggle(list)}
                  disabled={isPending || membershipLoading}
                  data-testid={`list-row-${list.id}`}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span className="truncate text-left">{list.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{list.itemCount}</span>
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isSaved ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t p-2 flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New list name"
            className="h-8 text-sm"
            data-testid="input-new-list-name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim() && !createMutation.isPending) {
                createMutation.mutate();
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
            data-testid="button-create-list"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
