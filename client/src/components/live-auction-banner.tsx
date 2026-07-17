import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { invalidatePrefix } from "@/lib/queryClient";

export interface LiveAuctionBannerProps {
  leadId: number;
  /** ISO string when the window closes. */
  closesAt: string;
  /** Optional callback fired when the window expires client-side. */
  onExpired?: () => void;
}

/**
 * 10-second countdown banner shown when an `auction_opened` WS event
 * arrives for an eligible lead. Clicking "Claim" hits
 * `POST /api/auctions/:leadId/claim`. The banner self-dismisses when
 * the countdown reaches zero or the claim succeeds.
 */
export function LiveAuctionBanner({ leadId, closesAt, onExpired }: LiveAuctionBannerProps) {
  const { toast } = useToast();
  const closesAtMs = useMemo(() => new Date(closesAt).getTime(), [closesAt]);
  const [now, setNow] = useState(() => Date.now());
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);

  const remainingMs = Math.max(0, closesAtMs - now);
  const remainingSec = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    if (remainingMs === 0 && onExpired) onExpired();
  }, [remainingMs, onExpired]);

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/auctions/${leadId}/claim`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Claim failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setClaimed(true);
      toast({
        title: "Claim submitted",
        description: `You're in the running for lead #${leadId}. Winner will be announced in a moment.`,
      });
      invalidatePrefix("/api/leads");
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't claim",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (remainingMs === 0) return null;

  return (
    <div
      role="status"
      data-testid={`auction-banner-${leadId}`}
      className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm dark:border-amber-700 dark:bg-amber-950"
    >
      <div className="flex items-center gap-3">
        <Zap className="h-5 w-5 text-amber-600" aria-hidden />
        <div>
          <div className="font-semibold text-amber-900 dark:text-amber-100">
            High-value lead live: #{leadId}
          </div>
          <div className="text-sm text-amber-800 dark:text-amber-200">
            First valid claim wins. Closes in&nbsp;
            <span className="font-mono font-semibold">{remainingSec}s</span>.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {remainingSec}s
        </Badge>
        {claimed ? (
          <Button disabled variant="outline" data-testid={`auction-claimed-${leadId}`}>
            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
            Claimed
          </Button>
        ) : (
          <Button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            data-testid={`auction-claim-${leadId}`}
          >
            {claimMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Claiming…
              </>
            ) : (
              "Claim"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
