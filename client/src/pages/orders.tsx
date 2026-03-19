import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ShoppingBag, Calendar, MapPin, Building2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import type { Order } from "@/lib/types";

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
    vendor: { id: number; name: string; rating: string; verified: boolean };
  };
};

export default function Orders() {
  const { data: orders = [], isLoading } = useQuery<OrderWithLead[]>({
    queryKey: ["/api/orders"],
  });

  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.price), 0);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6 pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="h-7 w-7 text-primary" />
              Order History
            </h1>
            <p className="text-muted-foreground mt-1">All leads you have purchased.</p>
          </div>
          {orders.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-2xl font-bold font-mono text-primary">${totalSpent.toFixed(2)}</p>
            </div>
          )}
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
            {orders.map((order) => (
              <Card key={order.id} className="hover:shadow-sm transition-shadow" data-testid={`card-order-${order.id}`}>
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Lead Type + Status */}
                    <div className="flex items-center gap-3 flex-1">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold" data-testid={`text-order-type-${order.id}`}>
                            {order.lead.type}
                          </span>
                          <Badge variant="outline" className="text-[10px]">{order.lead.exclusivity}</Badge>
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/20 text-[10px]">
                            {order.status}
                          </Badge>
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
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="flex sm:flex-col items-center sm:items-end gap-4 sm:gap-1 flex-shrink-0">
                      <span className="text-xl font-bold font-mono text-primary" data-testid={`text-order-price-${order.id}`}>
                        ${parseFloat(order.price).toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground">Lead #{order.leadId}</span>
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
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
