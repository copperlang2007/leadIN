import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Funnel, Users, MousePointerClick, ShoppingCart, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { PermissionRequired } from "@/components/permission-required";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

interface FunnelSnapshot {
  windowStart: string;
  windowEnd: string;
  uniqueSessions: number;
  uniqueAuthenticatedUsers: number;
  pageViews: number;
  marketplaceVisitors: number;
  deepScrollers: number;
  toolInteractors: number;
  ctaClickers: number;
  purchasers: number;
  newOrgs: number;
  newAgents: number;
  verifiedAgents: number;
  ordersCount: number;
  revenueUsd: string;
  visitorToCtaPct: number;
  ctaToPurchasePct: number;
  visitorToPurchasePct: number;
}

interface LeadAnalytics {
  topMediscoreBucket: { bucket: string; count: number }[];
  dncRate: { flagged: number; clean: number; pct: number };
  conversionByType: { type: string; available: number; sold: number; pct: number }[];
}

function FunnelStep({ label, value, pct, icon: Icon }: { label: string; value: number; pct?: number; icon: any }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-md border bg-card">
      <Icon className="h-5 w-5 text-primary" />
      <div className="flex-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      </div>
      {pct !== undefined && (
        <Badge variant="outline" className="text-xs">
          {pct}%
        </Badge>
      )}
    </div>
  );
}

export default function Analytics() {
  useDocumentTitle("Analytics");
  const [days, setDays] = useState(7);

  const { data: funnel, isLoading: fl, error: funnelError } = useQuery<FunnelSnapshot>({
    queryKey: [`/api/admin/analytics/funnel?days=${days}`],
  });

  const { data: leadStats, isLoading: ll, error: leadStatsError } = useQuery<LeadAnalytics>({
    queryKey: ["/api/admin/analytics/leads"],
  });

  const is403 =
    funnelError?.message?.startsWith("403:") ||
    leadStatsError?.message?.startsWith("403:");

  if (is403) {
    return (
      <PermissionRequired
        description="Product analytics are restricted to platform administrators. Please contact your organization owner if you believe this is a mistake."
      />
    );
  }

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-7 w-7 text-primary" /> Product analytics
            </h1>
            <p className="text-muted-foreground mt-1">
              Funnel from page-view → CTA → purchase, plus lead-quality distribution.
            </p>
          </div>
          <div className="flex gap-1">
            {[1, 7, 30, 90].map(d => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? "default" : "outline"}
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Funnel className="h-5 w-5" /> Acquisition → conversion funnel</CardTitle>
            <CardDescription>
              {funnel && `${new Date(funnel.windowStart).toLocaleDateString()} → ${new Date(funnel.windowEnd).toLocaleDateString()}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fl || !funnel ? (
              <Skeleton className="h-48" />
            ) : (
              <div className="space-y-2">
                <FunnelStep label="Unique sessions" value={funnel.uniqueSessions} icon={Users} />
                <FunnelStep label="Marketplace visitors" value={funnel.marketplaceVisitors} icon={Users} />
                <FunnelStep label="Deep scrollers (≥75%)" value={funnel.deepScrollers} icon={MousePointerClick} />
                <FunnelStep label="Tool interactors" value={funnel.toolInteractors} icon={MousePointerClick} />
                <FunnelStep label="CTA clickers" value={funnel.ctaClickers} pct={funnel.visitorToCtaPct} icon={MousePointerClick} />
                <FunnelStep label="Purchasers" value={funnel.purchasers} pct={funnel.ctaToPurchasePct} icon={ShoppingCart} />
                <div className="grid grid-cols-3 gap-2 pt-3 border-t">
                  <div><div className="text-xs text-muted-foreground">Visitor → CTA</div><div className="font-bold">{funnel.visitorToCtaPct}%</div></div>
                  <div><div className="text-xs text-muted-foreground">CTA → Purchase</div><div className="font-bold">{funnel.ctaToPurchasePct}%</div></div>
                  <div><div className="text-xs text-muted-foreground">Visitor → Purchase</div><div className="font-bold">{funnel.visitorToPurchasePct}%</div></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Activation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">New orgs</span><span className="font-bold">{funnel?.newOrgs ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">New agents</span><span className="font-bold">{funnel?.newAgents ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">Verified agents</span><span className="font-bold">{funnel?.verifiedAgents ?? "—"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Revenue ({days}d)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${parseFloat(funnel?.revenueUsd ?? "0").toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">{funnel?.ordersCount ?? 0} orders</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> DNC compliance</CardTitle>
            </CardHeader>
            <CardContent>
              {ll || !leadStats ? <Skeleton className="h-12" /> : (
                <>
                  <div className="text-2xl font-bold">{leadStats.dncRate.pct}%</div>
                  <div className="text-xs text-muted-foreground">{leadStats.dncRate.flagged} flagged / {leadStats.dncRate.clean} clean</div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MediScore distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {ll || !leadStats ? <Skeleton className="h-24" /> : (
                <div className="space-y-2">
                  {leadStats.topMediscoreBucket.map(b => (
                    <div key={b.bucket} className="flex items-center gap-3">
                      <div className="text-xs w-12 text-muted-foreground">{b.bucket}</div>
                      <div className="flex-1 h-2 bg-muted rounded">
                        <div className="h-full bg-primary rounded" style={{ width: `${Math.min(100, b.count)}%` }} />
                      </div>
                      <div className="text-xs font-mono w-12 text-right">{b.count}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sell-through by type</CardTitle>
            </CardHeader>
            <CardContent>
              {ll || !leadStats ? <Skeleton className="h-24" /> : (
                <div className="space-y-2">
                  {leadStats.conversionByType.map(t => (
                    <div key={t.type} className="flex items-center justify-between text-sm">
                      <span>{t.type}</span>
                      <span className="font-mono">{t.sold}/{t.sold + t.available} <span className="text-muted-foreground">({t.pct}%)</span></span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
