import type { Lead } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Shield, Lock, Eye, Mail, FileText, User, Calendar, Phone, AtSign, MapPin, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { setTrackerLeadId } from "@/lib/tracker";

interface LeadDetailsDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPurchased?: boolean;
  onPurchase?: () => void;
  isPurchasing?: boolean;
}

const VERIFICATION_LAYERS = [
  {
    label: "Layer 1",
    name: "Data Quality Check",
    color: "bg-blue-500/15 text-blue-700 border-blue-500/25 dark:text-blue-300",
    dotColor: "border-blue-500",
    description: "Consumer form completeness, field validation, and demographic integrity verified.",
  },
  {
    label: "Layer 2",
    name: "TCPA / Behavioral Verification",
    color: "bg-violet-500/15 text-violet-700 border-violet-500/25 dark:text-violet-300",
    dotColor: "border-violet-500",
    description: "TrustedForm visual playback captured, IP validated, and TCPA consent timestamp recorded.",
  },
  {
    label: "Layer 3",
    name: "Compliance & Security Audit",
    color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
    dotColor: "border-emerald-500",
    description: "Quality scrub completed — duplicate check, fraud signals cleared, and state compliance confirmed.",
  },
];

function PIIField({ label, value, icon: Icon }: { label: string; value: string | null; icon: any }) {
  if (value) {
    return (
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <Icon className="h-4 w-4" /> {label}
        </span>
        <span className="font-medium text-sm">{value}</span>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground flex items-center gap-2">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <div className="flex items-center gap-1.5 bg-muted/60 border border-dashed rounded px-2 py-0.5">
        <Lock className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Purchase to reveal</span>
      </div>
    </div>
  );
}

export function LeadDetailsDialog({ lead, open, onOpenChange, isPurchased, onPurchase, isPurchasing }: LeadDetailsDialogProps) {
  const { data: revealedLead, isLoading: isRevealing } = useQuery<Lead>({
    queryKey: [`/api/leads/${lead?.id}/reveal`],
    enabled: !!lead?.id && isPurchased,
    retry: false,
  });

  const { data: mediscore } = useQuery<{
    score: number;
    activeSignalCount: number;
    signals: { key: string; label: string; weight: number; hit: boolean }[];
  }>({
    queryKey: [`/api/leads/${lead?.id}/mediscore`],
    enabled: !!lead?.id && open,
  });

  // Scope behavioral events to this lead while the dialog is open.
  useEffect(() => {
    if (open && lead?.id) {
      setTrackerLeadId(lead.id);
      return () => setTrackerLeadId(undefined);
    }
  }, [open, lead?.id]);

  if (!lead) return null;

  const displayLead = (isPurchased && revealedLead) ? revealedLead : lead;
  const hasPII = !!(displayLead.consumerName || displayLead.consumerPhone || displayLead.consumerEmail || displayLead.consumerAddress);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline">{lead.type}</Badge>
            {lead.verified && (
              <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Verified & Compliant
              </Badge>
            )}
            {isPurchased && (
              <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Purchased
              </Badge>
            )}
            {mediscore && (
              <Badge
                className="bg-primary/15 text-primary border-primary/30"
                data-testid="badge-mediscore"
                data-track-tool={`mediscore-badge-${lead.id}`}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                MediScore {mediscore.score} · {mediscore.activeSignalCount} active signals
              </Badge>
            )}
            {lead.dncFlagged && (
              <Badge className="bg-destructive/15 text-destructive border-destructive/30">
                <AlertTriangle className="h-3 w-3 mr-1" /> DNC flagged
              </Badge>
            )}
          </div>
          <DialogTitle className="text-2xl font-display font-bold flex items-center justify-between">
            <span>Lead #{lead.id}</span>
            <span className="text-primary">${lead.price}</span>
          </DialogTitle>
          <DialogDescription>
            Generated via {lead.source} in {lead.state} • {lead.exclusivity}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">

            {/* Left Column: Attributes */}
            <div className="space-y-6">
              {/* PII Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Consumer Contact</h4>
                  {isPurchased && isRevealing && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="bg-muted/30 rounded-lg p-4 space-y-3 border border-border/50">
                  <PIIField label="Full Name" value={displayLead.consumerName} icon={User} />
                  <PIIField label="Phone" value={displayLead.consumerPhone} icon={Phone} />
                  <PIIField label="Email" value={displayLead.consumerEmail} icon={AtSign} />
                  <PIIField label="Address" value={displayLead.consumerAddress} icon={MapPin} />
                </div>

                {!isPurchased && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      Purchase this lead to reveal full consumer contact information
                    </p>
                  </div>
                )}
              </div>

              {/* Consumer Profile */}
              <div>
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">Consumer Profile</h4>
                <div className="bg-muted/30 rounded-lg p-4 space-y-3 border border-border/50">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <User className="h-4 w-4" /> Age
                    </span>
                    <span className="font-medium">{lead.consumerAge}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Income Bracket
                    </span>
                    <span className="font-medium">{lead.income || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Gender
                    </span>
                    <span className="font-medium">{lead.gender === "M" ? "Male" : lead.gender === "F" ? "Female" : "N/A"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Smoker Status
                    </span>
                    <span className="font-medium">{lead.smoker ? "Smoker" : "Non-Smoker"}</span>
                  </div>
                </div>
              </div>

              {/* Compatibility */}
              <div>
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">Compatibility Analysis</h4>
                <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-100 dark:border-blue-900">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-2xl font-bold text-primary">{lead.compatibilityScore}%</div>
                    <div className="text-sm font-medium text-primary/80">Match Score</div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This lead matches your licensed state ({lead.state}) and preferred product type ({lead.type}).
                    Historical conversion data suggests a high probability of contact.
                  </p>
                </div>
              </div>

              {mediscore && (
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">
                    MediScore Signals ({mediscore.activeSignalCount}/{mediscore.signals.length} active)
                  </h4>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border/50 max-h-48 overflow-y-auto">
                    <ul className="grid grid-cols-1 gap-1 text-xs">
                      {mediscore.signals.map(s => (
                        <li
                          key={s.key}
                          className={`flex items-center justify-between px-2 py-1 rounded ${s.hit ? "text-foreground" : "text-muted-foreground/60 line-through"}`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${s.hit ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                            {s.label}
                          </span>
                          <span className="font-mono">+{s.weight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {!isPurchased && onPurchase && (
                <Button
                  className="w-full gap-2"
                  onClick={onPurchase}
                  disabled={isPurchasing}
                  data-testid={`button-purchase-dialog-${lead.id}`}
                  data-track-cta={`purchase-lead-${lead.id}`}
                >
                  {isPurchasing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4" /> Purchase for ${parseFloat(lead.price).toFixed(2)}</>
                  )}
                </Button>
              )}
            </div>

            {/* Right Column: Tri-Layer Provenance Log */}
            <div>
              <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-1">
                Tri-Layer Verification Protocol
              </h4>
              <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
                Each lead passes three deterministic verification layers before listing. No lead is published until all three layers clear.
              </p>

              <div className="relative border-l-2 border-muted ml-3 space-y-7 py-2">
                {lead.provenance.map((step, index) => {
                  const layer = VERIFICATION_LAYERS[index] ?? VERIFICATION_LAYERS[VERIFICATION_LAYERS.length - 1];
                  return (
                    <div key={index} className="relative pl-8" data-testid={`provenance-step-${index}`}>
                      <div className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full bg-background border-2 ${layer.dotColor} flex items-center justify-center`}>
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                      </div>

                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Badge className={`text-[10px] px-1.5 py-0 border ${layer.color}`}>
                            {layer.label}
                          </Badge>
                          <span className="text-xs font-semibold">{layer.name}</span>
                          <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/15 text-emerald-700 border border-emerald-500/25 dark:text-emerald-300 ml-auto">
                            ✓ PASS
                          </Badge>
                        </div>

                        <span className="font-medium text-sm">{step.action}</span>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 w-fit px-2 py-1 rounded">
                          {step.icon === 'check' && <CheckCircle2 className="h-3 w-3 text-blue-500" />}
                          {step.icon === 'lock' && <Lock className="h-3 w-3 text-violet-500" />}
                          {step.icon === 'eye' && <Eye className="h-3 w-3 text-emerald-500" />}
                          {step.icon === 'mail' && <Mail className="h-3 w-3" />}
                          <span>by {step.actor}</span>
                          <span className="font-mono opacity-70">
                            · {format(new Date(step.date), "MMM d, HH:mm")}
                          </span>
                        </div>

                        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                          {layer.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded border border-emerald-100 dark:border-emerald-900 flex gap-3">
                <Shield className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-800 dark:text-emerald-200">
                  <span className="font-semibold">TrustedForm Certified:</span> This lead includes a visual playback of the consumer interaction, IP validation, and TCPA consent proof. All three verification layers passed.
                </div>
              </div>
            </div>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
