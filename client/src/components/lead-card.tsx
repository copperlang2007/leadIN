import type { Lead } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Clock, MapPin, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import verifiedIcon from "@assets/generated_images/verified_trust_shield_icon.png";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface LeadCardProps {
  lead: Lead;
  licensedStates: string[];
  onCompare: (lead: Lead) => void;
  onViewDetails: (lead: Lead) => void;
  isSelectedForCompare: boolean;
}

export function LeadCard({ lead, licensedStates, onCompare, onViewDetails, isSelectedForCompare }: LeadCardProps) {
  const isStateMatch = licensedStates.includes(lead.state);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Determine card border color based on compatibility
  const compatibilityColor = lead.compatibilityScore > 85 ? "border-l-success" : lead.compatibilityScore > 65 ? "border-l-warning" : "border-l-muted";

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/leads/${lead.id}/purchase`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Purchase failed');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Purchase successful!",
        description: `You've purchased lead #${lead.id} for $${lead.price}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Purchase failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card className={`group relative overflow-hidden transition-all duration-200 hover:shadow-md border-l-4 ${compatibilityColor}`}>
      {/* Compatibility Badge - Absolute Positioned */}
      {isStateMatch && (
        <div className="absolute top-0 right-0 bg-success/10 text-success-foreground px-2 py-1 rounded-bl-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> License Match
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
            <span className="text-muted-foreground">Generated</span>
            <div className="flex items-center gap-1 text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span>{lead.createdAt ? formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true }) : 'Recently'}</span>
            </div>
          </div>
          
          {/* Compatibility Advisor Mini-Section */}
          <div className="col-span-2 mt-2 bg-muted/30 rounded-md p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className={`h-4 w-4 ${lead.compatibilityScore > 80 ? "text-success" : "text-warning"}`} />
              <span className="text-xs font-medium text-muted-foreground">Compatibility</span>
            </div>
            <span className={`text-sm font-bold ${lead.compatibilityScore > 80 ? "text-success" : "text-warning"}`}>
              {lead.compatibilityScore}%
            </span>
          </div>
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
        <Button 
          size="sm" 
          className="flex-[2] text-xs font-semibold shadow-sm"
          onClick={() => purchaseMutation.mutate()}
          disabled={purchaseMutation.isPending}
          data-testid={`button-purchase-${lead.id}`}
        >
          {purchaseMutation.isPending ? "Processing..." : "Purchase Lead"}
        </Button>
      </CardFooter>
    </Card>
  );
}
