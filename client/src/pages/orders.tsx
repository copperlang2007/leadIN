import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  ShoppingBag,
  Calendar,
  MapPin,
  Building2,
  AlertCircle,
  Download,
  Phone,
  AtSign,
  User,
  ShieldAlert,
  Loader2,
  RefreshCcw,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import type { Order } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type OrderWithLead = Order & {
  lead: {
    id: number;
    type: string;
    state: string;
    zipCode: string;
    exclusivity: string;
    source: string;
    consumerAge: number;
    compatibilityScore: number;
    consumerName: string | null;
    consumerPhone: string | null;
    consumerEmail: string | null;
    consumerAddress: string | null;
    vendor: { id: number; name: string; rating: string; verified: boolean };
  };
};

type DisputeReason = "bad_contact" | "duplicate" | "fraud" | "not_as_described" | "other";

interface Dispute {
  id: number;
  orderId: number;
  status: "open" | "approved" | "denied";
  reason: DisputeReason;
  refundCents: number | null;
}

interface TradeInCredit {
  id: number;
  orderId: number;
  agentUserId: string;
  creditCents: number;
  reason: string | null;
  status: "issued" | "redeemed" | "expired";
  redeemedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

interface CheckReplacementResponse {
  issued: boolean;
  reason: string;
  creditCents?: number;
  credit?: TradeInCredit;
  verdict?: "bad" | "ok" | "insufficient";
}

const REASON_LABELS: Record<DisputeReason, string> = {
  bad_contact: "Bad contact info",
  duplicate: "Duplicate",
  fraud: "Fraud",
  not_as_described: "Not as described",
  other: "Other",
};

const NOTES_MAX = 2000;

export default function Orders() {
  const { data: orders = [], isLoading } = useQuery<OrderWithLead[]>({
    queryKey: ["/api/orders"],
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dispute dialog state. We track the order being acted on plus the form.
  const [disputeOrder, setDisputeOrder] = useState<OrderWithLead | null>(null);
  const [reason, setReason] = useState<DisputeReason>("bad_contact");
  const [notes, setNotes] = useState("");

  // Fetch dispute status for every order. useQueries handles N parallel
  // queries cleanly; we tolerate the 404 by treating missing as "no dispute".
  const disputeQueries = useQueries({
    queries: orders.map(o => ({
      queryKey: [`/api/orders/${o.id}/dispute`],
      queryFn: async () => {
        const res = await fetch(`/api/orders/${o.id}/dispute`, { credentials: "include" });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to load dispute");
        return (await res.json()) as Dispute;
      },
      // Avoid hammering the server on focus.
      staleTime: 30_000,
    })),
  });
  const disputesByOrderId = new Map<number, Dispute | null>();
  orders.forEach((o, i) => {
    disputesByOrderId.set(o.id, disputeQueries[i]?.data ?? null);
  });

  // Trade-in credits (Wave 7 / T1). One row per order at most; we list all
  // credits the user has accumulated and surface a "Check replacement" CTA
  // per order so the agent can request the auto-issue flow.
  const { data: credits = [] } = useQuery<TradeInCredit[]>({
    queryKey: ["/api/tradein/credits"],
  });

  const checkReplacement = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/check-replacement`, {});
      return (await res.json()) as CheckReplacementResponse;
    },
    onSuccess: (result) => {
      if (result.issued) {
        toast({
          title: "Replacement credit issued",
          description: `You earned a $${((result.creditCents ?? 0) / 100).toFixed(2)} credit toward your next lead.`,
        });
      } else if (result.reason === "already_credited") {
        toast({
          title: "Already credited",
          description: "This order already has an active trade-in credit.",
        });
      } else if (result.reason === "verdict_ok") {
        toast({
          title: "Not eligible",
          description: "This lead shows successful contact — no replacement is warranted.",
        });
      } else if (result.reason === "verdict_insufficient") {
        toast({
          title: "Not enough signal",
          description: "Try again after a few more dial attempts (3+ failed calls trigger eligibility).",
        });
      } else if (result.reason === "order_too_old") {
        toast({
          title: "Outside replacement window",
          description: "Auto-replacement only applies to orders less than 14 days old.",
        });
      } else {
        toast({
          title: "Not eligible",
          description: result.reason,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/tradein/credits"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Replacement check failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const fileDispute = useMutation({
    mutationFn: async (input: { orderId: number; reason: DisputeReason; notes: string }) => {
      const res = await apiRequest("POST", `/api/orders/${input.orderId}/dispute`, {
        reason: input.reason,
        notes: input.notes || undefined,
      });
      return (await res.json()) as Dispute;
    },
    onSuccess: (dispute) => {
      toast({
        title: "Dispute filed",
        description: "An admin will review your dispute shortly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${dispute.orderId}/dispute`] });
      setDisputeOrder(null);
      setReason("bad_contact");
      setNotes("");
    },
    onError: (err: Error) => {
      toast({
        title: "Could not file dispute",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.price), 0);

  const handleExportCSV = async () => {
    try {
      const response = await fetch("/api/orders/export", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export successful",
        description: "Your orders have been downloaded as a CSV file.",
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Could not export orders. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="h-7 w-7 text-primary" />
              Order History
            </h1>
            <p className="text-muted-foreground mt-1">All leads you have purchased — with full consumer contact information.</p>
          </div>
          <div className="flex items-center gap-3">
            {orders.length > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Spent</p>
                <p className="text-2xl font-bold font-mono text-primary">${totalSpent.toFixed(2)}</p>
              </div>
            )}
            {orders.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleExportCSV}
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        {orders.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium">Total Orders</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">{orders.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium">Avg. Cost Per Lead</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold">${(totalSpent / orders.length).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground font-medium">Most Recent</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-sm font-semibold truncate">
                  {orders[0]?.createdAt ? format(new Date(orders[0].createdAt), "MMM d, yyyy") : "—"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trade-in credits banner (Wave 7 / T1) */}
        {credits.filter(c => c.status === "issued").length > 0 && (
          <Card className="border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900" data-testid="card-tradein-credits">
            <CardContent className="p-4 flex items-center gap-3">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  Available trade-in credits
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                  Apply at checkout to discount your next lead purchase.
                </p>
              </div>
              <span className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300" data-testid="text-tradein-total">
                ${(
                  credits
                    .filter(c => c.status === "issued")
                    .reduce((s, c) => s + c.creditCents, 0) / 100
                ).toFixed(2)}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Orders List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-24 border border-dashed rounded-lg">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold">No orders yet</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Head to the marketplace to purchase your first lead.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const dispute = disputesByOrderId.get(order.id) ?? null;
              const orderCredit = credits.find(c => c.orderId === order.id) ?? null;
              return (
                <Card key={order.id} className="hover:shadow-sm transition-shadow" data-testid={`card-order-${order.id}`}>
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      {/* Lead Type + Status */}
                      <div className="flex items-start gap-3 flex-1">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold" data-testid={`text-order-type-${order.id}`}>
                              {order.lead.type}
                            </span>
                            <Badge variant="outline" className="text-[10px]">{order.lead.exclusivity}</Badge>
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/20 text-[10px]">
                              {order.status}
                            </Badge>
                            <DisputeBadge dispute={dispute} />
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {order.lead.state} {order.lead.zipCode}
                            </span>
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" /> {order.lead.vendor.name}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {order.createdAt ? format(new Date(order.createdAt), "MMM d, yyyy 'at' h:mm a") : "—"}
                            </span>
                          </div>

                          {/* PII Section - revealed since purchased */}
                          {(order.lead.consumerName || order.lead.consumerPhone || order.lead.consumerEmail) && (
                            <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-100 dark:border-emerald-900 space-y-1">
                              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 mb-2">Consumer Information</p>
                              {order.lead.consumerName && (
                                <div className="flex items-center gap-2 text-xs">
                                  <User className="h-3 w-3 text-emerald-600" />
                                  <span className="font-medium">{order.lead.consumerName}</span>
                                </div>
                              )}
                              {order.lead.consumerPhone && (
                                <div className="flex items-center gap-2 text-xs">
                                  <Phone className="h-3 w-3 text-emerald-600" />
                                  <span className="font-medium">{order.lead.consumerPhone}</span>
                                </div>
                              )}
                              {order.lead.consumerEmail && (
                                <div className="flex items-center gap-2 text-xs">
                                  <AtSign className="h-3 w-3 text-emerald-600" />
                                  <span className="font-medium">{order.lead.consumerEmail}</span>
                                </div>
                              )}
                              {order.lead.consumerAddress && (
                                <div className="flex items-center gap-2 text-xs">
                                  <MapPin className="h-3 w-3 text-emerald-600" />
                                  <span className="font-medium">{order.lead.consumerAddress}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Meta */}
                      <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-1 flex-shrink-0">
                        <span className="text-xl font-bold font-mono text-primary" data-testid={`text-order-price-${order.id}`}>
                          ${parseFloat(order.price).toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground">Lead #{order.leadId}</span>
                        {!dispute && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs"
                            onClick={() => {
                              setDisputeOrder(order);
                              setReason("bad_contact");
                              setNotes("");
                            }}
                            data-testid={`button-dispute-${order.id}`}
                          >
                            <ShieldAlert className="h-3 w-3" /> File a dispute
                          </Button>
                        )}
                        {!orderCredit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs"
                            onClick={() => checkReplacement.mutate(order.id)}
                            disabled={checkReplacement.isPending}
                            data-testid={`button-check-replacement-${order.id}`}
                          >
                            {checkReplacement.isPending && checkReplacement.variables === order.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCcw className="h-3 w-3" />
                            )}
                            Check replacement eligibility
                          </Button>
                        )}
                        {orderCredit && orderCredit.status === "issued" && (
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/20 text-[10px]" data-testid={`badge-credit-${order.id}`}>
                            Credit ${(orderCredit.creditCents / 100).toFixed(2)}
                          </Badge>
                        )}
                        {orderCredit && orderCredit.status === "redeemed" && (
                          <Badge variant="outline" className="text-muted-foreground text-[10px]" data-testid={`badge-credit-redeemed-${order.id}`}>
                            Credit redeemed
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Additional attributes */}
                    <div className="mt-4 pt-3 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>Age: <strong className="text-foreground">{order.lead.consumerAge}</strong></span>
                      <span>Source: <strong className="text-foreground">{order.lead.source}</strong></span>
                      <span>Match: <strong className="text-foreground">{order.lead.compatibilityScore}%</strong></span>
                      <span>Vendor Rating: <strong className="text-foreground">{order.lead.vendor.rating}/5.0</strong></span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Dispute dialog */}
      <Dialog
        open={!!disputeOrder}
        onOpenChange={(open) => {
          if (!open) setDisputeOrder(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>File a dispute</DialogTitle>
            <DialogDescription>
              Tell us what went wrong with lead #{disputeOrder?.leadId}. An admin will review your submission.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dispute-reason">Reason</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as DisputeReason)}
              >
                <SelectTrigger id="dispute-reason" data-testid="select-dispute-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REASON_LABELS) as DisputeReason[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {REASON_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dispute-notes">Notes (optional)</Label>
              <Textarea
                id="dispute-notes"
                placeholder="Share any details that will help us evaluate this dispute."
                value={notes}
                maxLength={NOTES_MAX}
                onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
                rows={4}
                data-testid="textarea-dispute-notes"
              />
              <p className="text-xs text-muted-foreground text-right">
                {notes.length}/{NOTES_MAX}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDisputeOrder(null)}
              disabled={fileDispute.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!disputeOrder) return;
                fileDispute.mutate({ orderId: disputeOrder.id, reason, notes });
              }}
              disabled={fileDispute.isPending}
              data-testid="button-submit-dispute"
            >
              {fileDispute.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Submit dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function DisputeBadge({ dispute }: { dispute: Dispute | null }) {
  if (!dispute) return null;
  if (dispute.status === "open") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/20 text-[10px]" data-testid="badge-dispute-open">
        Dispute open
      </Badge>
    );
  }
  if (dispute.status === "approved") {
    const refund = ((dispute.refundCents ?? 0) / 100).toFixed(2);
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/20 text-[10px]" data-testid="badge-dispute-approved">
        Dispute approved (refund ${refund})
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-[10px]" data-testid="badge-dispute-denied">
      Dispute denied
    </Badge>
  );
}
