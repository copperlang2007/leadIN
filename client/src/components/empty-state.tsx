// Shared empty-state component.
//
// Every page that lists a collection (marketplace leads, orders,
// org-admin agents, org-admin vendors, agent dashboard assigned-leads)
// renders a "nothing here yet" panel. They all converged on the same
// shape: rounded icon badge, bold heading, helpful copy, optional CTA.
//
// This component is the single source of truth so future tweaks
// (spacing, color, typography) land everywhere at once.

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional primary action. Use onClick instead of wrapping in a <Link>
   *  to avoid nested interactive elements. */
  action?: {
    label: string;
    onClick: () => void;
    /** Defaults to "default" — set "outline" for secondary contexts. */
    variant?: "default" | "outline";
    testId?: string;
    /** Optional GA conversion-tracking id. Becomes `data-track-cta` on
     *  the rendered button. */
    trackCta?: string;
  };
  /** Optional secondary action — renders next to the primary. */
  secondaryAction?: {
    label: string;
    onClick: () => void;
    testId?: string;
    trackCta?: string;
  };
  /** Compact mode for nested empty states (smaller padding, smaller icon).
   *  Use inside Cards; the default size suits page-level empty states. */
  compact?: boolean;
  /** Forwarded to the outer div for E2E selectors. */
  "data-testid"?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  compact,
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      className={`text-center px-6 border border-dashed rounded-xl bg-muted/20 ${compact ? "py-10" : "py-20"}`}
      data-testid={testId}
    >
      <div className={`inline-flex rounded-full bg-background border items-center justify-center mb-${compact ? "3" : "4"} ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
        <Icon className={`text-primary ${compact ? "h-5 w-5" : "h-7 w-7"}`} />
      </div>
      <h3 className={`font-bold mb-${compact ? "1" : "2"} ${compact ? "text-base" : "text-xl"}`}>{title}</h3>
      {description && (
        <p className={`text-muted-foreground mx-auto ${compact ? "text-sm max-w-sm mb-4" : "mb-6 max-w-md"}`}>
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {action && (
            <Button
              variant={action.variant ?? "default"}
              size={compact ? "sm" : "default"}
              onClick={action.onClick}
              data-testid={action.testId}
              data-track-cta={action.trackCta}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              onClick={secondaryAction.onClick}
              data-testid={secondaryAction.testId}
              data-track-cta={secondaryAction.trackCta}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
