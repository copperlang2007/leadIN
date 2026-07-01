import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

interface UserNotification {
  id: number;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  isRead: boolean;
  createdAt: string;
}

const DOT_COLOR: Record<UserNotification["type"], string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

const QUERY_KEY = ["/api/notifications"] as const;

export function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Poll on a light interval so the unread badge stays roughly live without a
  // socket. The list also refetches whenever the popover is opened.
  const { data: notifications = [], isLoading } = useQuery<UserNotification[]>({
    queryKey: QUERY_KEY,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: Error) =>
      toast({ title: "Couldn't update notification", description: err.message, variant: "destructive" }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: Error) =>
      toast({ title: "Couldn't update notifications", description: err.message, variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center text-[0.65rem] font-semibold text-destructive-foreground bg-destructive rounded-full border-2 border-card"
              data-testid="text-notification-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="button-mark-all-read"
            >
              {markAllRead.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground" data-testid="text-notifications-empty">
            You're all caught up.
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => !n.isRead && markRead.mutate(n.id)}
                    className={`w-full text-left px-4 py-3 flex gap-3 transition-colors hover:bg-muted/50 ${
                      n.isRead ? "opacity-70" : ""
                    }`}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? "bg-transparent" : DOT_COLOR[n.type] ?? DOT_COLOR.info}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{n.title}</span>
                        {!n.isRead && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </span>
                      <span className="block text-sm text-muted-foreground">{n.message}</span>
                      <span className="block mt-0.5 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
