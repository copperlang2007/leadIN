import type { Lead, VendorTrustStats, VendorTrustTier } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Clock, MapPin, Activity, Lock, AlertTriangle, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import verifiedIcon from "@assets/generated_images/verified_trust_shield_icon.png";

interface LeadCardProps {
  lead: Lead;
  licensedStates: string[];
  onCompare: (lead: Lead) => void;
  onViewDetails: (lead: Lead) => void;
  // Defer the purchase call upward so the marketplace can route every
  // "Buy" click through the same confirm + insufficient-balance recovery
  // flow. Previously each card owned its own mutation and bypassed both.
  onRequestPurchase: (leadId: number, price: string) => void;
  isSelectedForCompare: boolean;
  isPurchased?: boolean;
  isNew?: boolean;
  // Aggregate trust signal for this lead's vendor (dispute rate + volume).
  // Undefined while the batch trust-stats request is in flight.
  trust?: VendorTrustStats;
}

// Per-tier presentation for the vendor trust badge. Dot color + short label;
// the numeric rate lives in the tooltip so the card stays uncluttered.
const TRUST_TIER_UI: Record<VendorTrustTier, { label: string; dot: string; text: string }> = {
  excellent: { label: "Excellent", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  good: { label: "Good", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  watch: { label: "Watch", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  new: { label: "New vendor", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

function VendorTrustBadge({ trust }: { trust?: VendorTrustStats }) {
  if (!trust) return null;
  const ui = TRUST_TIER_UI[trust.tier];
  const ratePct =
    trust.disputeRate === null ? null : `${(trust.disputeRate * 100).toFixed(trust.disputeRate < 0.1 ? 1 : 0)}%`;
  const title =
    trust.tier === "new" || ratePct === null
      ? "New vendor — not enough sales yet to rate"
      : `Dispute rate ${ratePct} across ${trust.soldCount} sale${trust.soldCount === 1 ? "" : "s"}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-medium ${ui.text}`}
          data-testid={`vendor-trust-${trust.tier}`}
          aria-label={title}
        >
          <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
          {ui.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{title}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function LeadCard({ lead, licensedStates, onCompare, onViewDetails, onRequestPurchase, isSelectedForCompare, isPurchased, isNew, trust }: LeadCardProps) {
  const isStateMatch = licensedStates.includes(lead.state);

  const compatibilityColor = lead.compatibilityScore > 85 ? "border-l-success" : lead.compatibilityScore > 65 ? "border-l-warning" : "border-l-muted";

  return (
    <Card className={`group relative overflow-hidden transition-all duration-200 hover:shadow-md border-l-4 ${compatibilityColor} ${isNew ? "ring-2 ring-emerald-500 animate-in fade-in slide-in-from-top-4 duration-500" : ""}`}>
      {/* License Match Badge */}
      {isStateMatch && (
        <div className="absolute top-0 right-0 bg-success/10 text-success-foreground px-2 py-1 rounded-bl-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> License Match
        </div>
      )}

      {/* Purchased Badge */}
      {isPurchased && (
        <div className="absolute top-0 left-0 bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-br-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Owned
        </div>
      )}

      {isNew && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-2 py-0.5 rounded-b-lg text-[10px] font-bold uppercase tracking-wider">
          New
        </div>
      )}

      <CardHeader className="p-4 pb-2 space-y-2 cursor-pointer" onClick={() => onViewDetails(lead)}>
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-medium bg-background group-hover:bg-muted transition-colors">
                {lead.type}
              </Badge>
              {lead.verified && (
                <Tooltip>
                  <TooltipTrigger>
                    <img src={verifiedIcon} alt="Verified" className="h-5 w-5 object-contain" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Verified Source & TCPA Compliant</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{lead.state}</span>
              <span>•</span>
              <span>{lead.zipCode}</span>
            </div>
            {/* Vendor + trust signal: buyers judge reliability before purchase. */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground truncate max-w-[120px]" data-testid={`vendor-name-${lead.id}`}>
                {lead.vendor?.name ?? "Vendor"}
              </span>
              <VendorTrustBadge trust={trust} />
            </div>
          </div>
          <div className="text-right">
            <span className="block text-2xl font-bold font-display text-primary">${lead.price}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">{lead.exclusivity}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 cursor-pointer" onClick={() => onViewDetails(lead)}>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm mt-2">
          <div className="col-span-2 flex items-center justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Consumer Age</span>
            <span className="font-medium">{lead.consumerAge} yrs</span>
          </div>
          <div className="col-span-2 flex items-center justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Source</span>
            <span className="font-medium truncate max-w-[120px]">{lead.source}</span>
          </div>
          <div className="col-span-2 flex items-center justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Consumer Info</span>
            {isPurchased ? (
              <span className="text-emerald-600 text-xs font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Revealed
              </span>
            ) : (
              <span className="text-muted-foreground text-xs flex items-center gap-1">
                <Lock className="h-3 w-3" /> Hidden
              </span>
            )}
          </div>
          <div className="col-span-2 flex items-center justify-between py-1 border-b border-border/50">
            <span className="text-muted-foreground">Generated</span>
            <div className="flex items-center gap-1 text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span>{lead.createdAt ? formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true }) : 'Recently'}</span>
            </div>
          </div>

          {/* MediScore is the headline number (22 signals). Compatibility
              is shown as a small annotation only when the user has a
              licensed-states profile that drives it. */}
          {typeof lead.mediscore === "number" && lead.mediscore > 0 ? (
            <div className="col-span-2 mt-2 bg-primary/5 rounded-md p-2 flex items-center justify-between border border-primary/15">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-primary">MediScore</span>
              </div>
              <span className="text-sm font-bold text-primary">{lead.mediscore}</span>
            </div>
          ) : (
            <div className="col-span-2 mt-2 bg-muted/30 rounded-md p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className={`h-4 w-4 ${lead.compatibilityScore > 80 ? "text-success" : "text-warning"}`} />
                <span className="text-xs font-medium text-muted-foreground">Compatibility</span>
              </div>
              <span className={`text-sm font-bold ${lead.compatibilityScore > 80 ? "text-success" : "text-warning"}`}>
                {lead.compatibilityScore}%
              </span>
            </div>
          )}

          {licensedStates.length > 0 && typeof lead.mediscore === "number" && lead.mediscore > 0 && (
            <div className="col-span-2 -mt-1 text-[10px] text-muted-foreground text-right">
              Compatibility {lead.compatibilityScore}%
            </div>
          )}

          {lead.dncFlagged && (
            <div className="col-span-2 bg-destructive/10 rounded-md p-2 flex items-center gap-2 text-destructive border border-destructive/20">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">On DNC list — review before contacting</span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex gap-2">
        <Button
          variant={isSelectedForCompare ? "secondary" : "outline"}
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onCompare(lead)}
          data-testid={`button-compare-${lead.id}`}
        >
          {isSelectedForCompare ? "Remove" : "Compare"}
        </Button>

        {isPurchased ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-[2] text-xs font-semibold border-blue-200 text-blue-700 hover:bg-blue-50 dark:text-blue-300"
            onClick={() => onViewDetails(lead)}
            data-testid={`button-view-purchased-${lead.id}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> View Full Lead
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-[2] text-xs font-semibold shadow-sm"
            onClick={() => onRequestPurchase(lead.id, lead.price)}
            data-testid={`button-purchase-${lead.id}`}
          >
            Purchase Lead
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
