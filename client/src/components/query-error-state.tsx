// Inline error UI for failed React Query loads.
//
// Until now, marketplace + orders + most other listing pages collapsed
// a query failure into the same empty-state UI that means "you have
// nothing yet". That's actively misleading: a 500 from the API renders
// as "No orders yet — go buy your first lead", which makes the user
// think their orders disappeared.
//
// This component is the destructive counterpart to EmptyState. Same
// visual rhythm (rounded badge + heading + copy + CTA) so the page
// shape stays stable across loading → error → success transitions,
// but the colour treatment + icon make it unambiguously a fault state.

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface QueryErrorStateProps {
  /** Optional icon override. Defaults to AlertTriangle. */
  icon?: LucideIcon;
  /** Short heading. e.g. "Couldn't load orders" */
  title: string;
  /** Optional one-line context. The actual error message (if you choose
   *  to expose it) goes in `details`. */
  description?: string;
  /** Optional raw error message. Rendered in a muted secondary line so
   *  callers don't have to choose between hiding it and shouting it. */
  details?: string;
  /** Retry handler — typically the refetch() returned by useQuery. */
  onRetry?: () => void;
  /** Defaults to "Try again". */
  retryLabel?: string;
  /** Compact mode for nested error states inside Cards. */
  compact?: boolean;
  /** Forwarded for E2E selectors. */
  "data-testid"?: string;
}

export function QueryErrorState({
  icon: Icon = AlertTriangle,
  title,
  description,
  details,
  onRetry,
  retryLabel = "Try again",
  compact,
  "data-testid": testId,
}: QueryErrorStateProps) {
  return (
    <div
      className={`text-center px-6 border border-dashed border-destructive/40 rounded-xl bg-destructive/5 ${compact ? "py-10" : "py-16"}`}
      data-testid={testId}
      role="alert"
    >
      <div className={`inline-flex rounded-full bg-background border border-destructive/30 items-center justify-center mb-3 ${compact ? "h-12 w-12" : "h-14 w-14"}`}>
        <Icon className={`text-destructive ${compact ? "h-5 w-5" : "h-6 w-6"}`} />
      </div>
      <h3 className={`font-bold mb-1 ${compact ? "text-base" : "text-lg"}`}>{title}</h3>
      {description && (
        <p className={`text-muted-foreground mx-auto ${compact ? "text-sm max-w-sm mb-3" : "mb-4 max-w-md"}`}>
          {description}
        </p>
      )}
      {details && (
        <p className="text-xs text-muted-foreground/80 font-mono break-words max-w-md mx-auto mb-4">
          {details}
        </p>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={onRetry}
          data-testid={testId ? `${testId}-retry` : undefined}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
